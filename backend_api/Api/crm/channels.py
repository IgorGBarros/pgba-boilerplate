"""
Serviços de integração de canais de entrada de leads.

Cada canal tem:
  - parse_incoming: extrai (channel_ref, nome, texto) do payload bruto do provider
  - send_reply: envia uma mensagem de volta ao lead pelo mesmo canal

Fluxo comum (handle_incoming_message):
  1. Achar ou criar Lead pelo channel_ref + tenant
  2. Salvar mensagem do usuário (LeadMessage.Role.USER)
  3. Chamar qualify_lead (agente RAG)
  4. Enviar resposta de volta pelo canal

Segue o padrão do boilerplate:
  - Nunca HTTP direto a um provedor de IA — usa harness/providers.py
  - Falha de envio de resposta não derruba o lead criado — loga e segue
  - channel_ref é o identificador externo único por canal (número, chat_id…)
"""
import hashlib
import hmac
import logging
from datetime import datetime, time
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from crm.models import ChannelConfig, Lead, LeadMessage, Pipeline
from crm.services import qualify_lead, seed_default_pipeline

logger = logging.getLogger(__name__)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_or_create_lead(
    tenant_id,
    channel: str,
    channel_ref: str,
    nome: str,
    telefone: str = "",
    config: Optional[ChannelConfig] = None,
) -> tuple[Lead, bool]:
    """Retorna (lead, created). Reaproveita lead existente pelo channel_ref."""
    lead, created = Lead.objects.get_or_create(
        tenant_id=tenant_id,
        channel_ref=channel_ref,
        defaults={
            "nome": nome or channel_ref,
            "telefone": telefone,
            "origem": channel,
        },
    )

    if created:
        # Coloca no primeiro stage do pipeline padrão
        pipeline = None
        if config and config.target_pipeline_id:
            pipeline = config.target_pipeline
        else:
            pipeline = Pipeline.objects.filter(
                tenant_id=tenant_id, is_default=True
            ).first() or seed_default_pipeline(tenant_id)

        first_stage = pipeline.stages.filter(main_stage="lead").order_by("position").first()
        if first_stage:
            lead.pipeline = pipeline
            lead.stage = first_stage
            lead.save(update_fields=["pipeline", "stage"])

        LeadMessage.objects.create(
            tenant_id=tenant_id,
            lead=lead,
            role=LeadMessage.Role.SYSTEM,
            content=f"Lead criado via {channel} ({channel_ref})",
        )

    return lead, created


# ─── WhatsApp via Evolution API ────────────────────────────────────────────────

def parse_whatsapp_evolution(payload: dict) -> Optional[tuple[str, str, str]]:
    """
    Extrai (channel_ref, nome, texto) de um webhook da Evolution API.

    Formato esperado do body da Evolution API v2:
    {
      "event": "messages.upsert",
      "data": {
        "key": {"remoteJid": "5511999999999@s.whatsapp.net", "fromMe": false},
        "pushName": "João",
        "message": {"conversation": "Olá, quero saber sobre seus serviços"}
      }
    }
    """
    try:
        data = payload.get("data", {})
        key = data.get("key", {})

        # Ignora mensagens enviadas pelo próprio bot
        if key.get("fromMe"):
            return None

        remote_jid: str = key.get("remoteJid", "")

        # Ignora mensagens de grupos (@g.us) — só processa contatos individuais (@s.whatsapp.net)
        if remote_jid.endswith("@g.us"):
            return None

        # Remove o sufixo @s.whatsapp.net e fica só com o número
        channel_ref = remote_jid.split("@")[0]
        nome = data.get("pushName", channel_ref)

        msg = data.get("message", {})
        texto = (
            msg.get("conversation")
            or msg.get("extendedTextMessage", {}).get("text")
            or msg.get("imageMessage", {}).get("caption")
            or ""
        )

        if not texto:
            return None

        return channel_ref, nome, texto
    except Exception as exc:
        logger.warning("parse_whatsapp_evolution: payload inválido (%s)", exc)
        return None


def send_whatsapp_reply(config: ChannelConfig, channel_ref: str, text: str) -> None:
    """Envia mensagem de volta via Evolution API."""
    server_url = config.config.get("server_url", "").rstrip("/")
    instance = config.config.get("instance", "")
    api_key = config.api_key

    if not all([server_url, instance, api_key]):
        logger.warning("WhatsApp send_reply: configuração incompleta (server_url/instance/api_key).")
        return

    url = f"{server_url}/message/sendText/{instance}"
    try:
        resp = httpx.post(
            url,
            json={"number": channel_ref, "text": text},
            headers={"apikey": api_key},
            timeout=10,
        )
        resp.raise_for_status()
    except Exception as exc:
        logger.error("WhatsApp send_reply falhou para %s: %s", channel_ref, exc)


# ─── Telegram Bot ─────────────────────────────────────────────────────────────

def parse_telegram(payload: dict) -> Optional[tuple[str, str, str]]:
    """
    Extrai (channel_ref, nome, texto) de um webhook do Telegram Bot API.

    Formato:
    {
      "message": {
        "chat": {"id": 123456789, "first_name": "João"},
        "text": "Olá"
      }
    }
    """
    try:
        msg = payload.get("message") or payload.get("edited_message")
        if not msg:
            return None

        chat = msg.get("chat", {})
        channel_ref = str(chat.get("id", ""))
        nome = " ".join(filter(None, [
            chat.get("first_name", ""),
            chat.get("last_name", ""),
        ])) or channel_ref

        texto = msg.get("text", "")
        if not texto:
            return None

        return channel_ref, nome, texto
    except Exception as exc:
        logger.warning("parse_telegram: payload inválido (%s)", exc)
        return None


def send_telegram_reply(config: ChannelConfig, channel_ref: str, text: str) -> None:
    """Envia mensagem de volta via Telegram Bot API."""
    bot_token = config.api_key
    if not bot_token:
        logger.warning("Telegram send_reply: bot_token não configurado.")
        return

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    try:
        resp = httpx.post(
            url,
            json={"chat_id": channel_ref, "text": text, "parse_mode": "Markdown"},
            timeout=10,
        )
        resp.raise_for_status()
    except Exception as exc:
        logger.error("Telegram send_reply falhou para %s: %s", channel_ref, exc)


def verify_telegram_token(request_token: str, config: ChannelConfig) -> bool:
    """Valida X-Telegram-Bot-Api-Secret-Token enviado pelo Telegram."""
    expected = config.webhook_secret
    if not expected:
        return True  # sem secret configurado, aceita tudo
    return hmac.compare_digest(request_token, expected)


# ─── Meta Lead Ads ────────────────────────────────────────────────────────────

def verify_meta_signature(body: bytes, signature_header: str, config: ChannelConfig) -> bool:
    """Valida assinatura HMAC-SHA256 do webhook do Meta."""
    secret = config.webhook_secret
    if not secret:
        return True

    sig = signature_header.removeprefix("sha256=")
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


def parse_meta_ads_lead(payload: dict) -> list[dict]:
    """
    Extrai lista de leads de um webhook de Meta Lead Ads.

    Formato:
    {
      "entry": [{
        "changes": [{
          "field": "leadgen",
          "value": {
            "leadgen_id": "...",
            "form_id": "...",
            "field_data": [
              {"name": "full_name", "values": ["João Silva"]},
              {"name": "email", "values": ["joao@email.com"]},
              {"name": "phone_number", "values": ["+5511999999"]},
              {"name": "company_name", "values": ["Empresa"]}
            ]
          }
        }]
      }]
    }
    """
    leads = []
    try:
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                if change.get("field") != "leadgen":
                    continue
                value = change.get("value", {})
                fields = {f["name"]: f["values"][0] for f in value.get("field_data", []) if f.get("values")}

                leads.append({
                    "channel_ref": value.get("leadgen_id", ""),
                    "nome": fields.get("full_name") or fields.get("nome_completo") or "Lead Meta Ads",
                    "email": fields.get("email", ""),
                    "telefone": fields.get("phone_number") or fields.get("telefone", ""),
                    "empresa": fields.get("company_name") or fields.get("empresa", ""),
                })
    except Exception as exc:
        logger.warning("parse_meta_ads_lead: payload inválido (%s)", exc)
    return leads


# ─── Handler central ──────────────────────────────────────────────────────────

def _matches_trigger_phrases(texto: str, phrases: list) -> bool:
    """Retorna True se o texto contém ao menos uma das frases (case-insensitive)."""
    texto_lower = texto.lower()
    return any(phrase.lower() in texto_lower for phrase in phrases if phrase.strip())


_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]


def _is_within_business_hours(config: ChannelConfig) -> bool:
    """Retorna True se estiver dentro do horário de funcionamento configurado."""
    bh = config.business_hours
    if not bh or not bh.get("enabled"):
        return True  # sem configuração = sempre aberto

    tz_name = bh.get("timezone", "America/Sao_Paulo")
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, KeyError):
        tz = ZoneInfo("America/Sao_Paulo")

    now = datetime.now(tz)
    day_key = _DAY_KEYS[now.weekday() % 7]  # weekday() 0=mon; _DAY_KEYS[0]="sun"
    # Adjust: Python weekday 0=Monday, but _DAY_KEYS[0]="sun"; map correctly
    # weekday(): Mon=0 → index 1 in _DAY_KEYS; Sun=6 → index 0
    day_key = _DAY_KEYS[(now.weekday() + 1) % 7]

    schedule = bh.get("schedule", {})
    day_config = schedule.get(day_key, {})
    if not day_config.get("open", True):
        return False

    start_str = day_config.get("start", "00:00")
    end_str = day_config.get("end", "23:59")
    try:
        start_h, start_m = (int(x) for x in start_str.split(":"))
        end_h, end_m = (int(x) for x in end_str.split(":"))
    except (ValueError, AttributeError):
        return True

    current_time = now.time()
    return time(start_h, start_m) <= current_time <= time(end_h, end_m)


def handle_incoming_message(
    tenant_id,
    channel: str,
    channel_ref: str,
    nome: str,
    texto: str,
    config: Optional[ChannelConfig] = None,
    telefone: str = "",
    auto_reply: bool = True,
) -> Optional[Lead]:
    """
    Processa mensagem recebida de qualquer canal:
    1. Verifica se o canal está pausado.
    2. Verifica horário de funcionamento — responde fora do horário e encerra.
    3. Se trigger_phrases configuradas e contato não existe ainda, só cria lead
       se a mensagem contiver alguma dessas frases.
    4. Qualifica via agente.
    5. Envia resposta de volta (se auto_reply e canal suportar).
    6. Agenda task de encerramento de sessão por inatividade.

    Retorna None quando a mensagem foi ignorada.
    """
    # Canal pausado — ignora silenciosamente
    if config and config.is_paused:
        logger.info("handle_incoming_message: canal %s pausado, mensagem de %s ignorada.", channel, channel_ref)
        return None

    # Fora do horário de funcionamento
    if config and not _is_within_business_hours(config):
        if auto_reply and config.out_of_hours_message:
            if channel == "whatsapp":
                send_whatsapp_reply(config, channel_ref, config.out_of_hours_message)
            elif channel == "telegram":
                send_telegram_reply(config, channel_ref, config.out_of_hours_message)
        logger.info("handle_incoming_message: fora do horário de funcionamento, mensagem de %s ignorada.", channel_ref)
        return None

    # Verifica se o contato já é lead antes de aplicar o filtro
    trigger_phrases = (config.trigger_phrases or []) if config else []
    if trigger_phrases:
        already_exists = Lead.objects.filter(
            tenant_id=tenant_id, channel_ref=channel_ref
        ).exists()
        if not already_exists and not _matches_trigger_phrases(texto, trigger_phrases):
            logger.info(
                "handle_incoming_message: mensagem de %s ignorada (trigger_phrases não bateram).",
                channel_ref,
            )
            return None

    lead, created = _get_or_create_lead(tenant_id, channel, channel_ref, nome, telefone, config)

    # Primeiro contato: envia boas-vindas + sugestões antes de qualificar
    if created and auto_reply and config and config.welcome_message:
        welcome = config.welcome_message
        quick_replies = config.quick_replies or []
        if quick_replies:
            options = "\n".join(f"{i+1}. {opt}" for i, opt in enumerate(quick_replies))
            welcome = f"{welcome}\n\n{options}"
        if channel == "whatsapp":
            send_whatsapp_reply(config, channel_ref, welcome)
        elif channel == "telegram":
            send_telegram_reply(config, channel_ref, welcome)

    result = qualify_lead(lead.id, texto, tenant_id)

    if auto_reply and config and result.get("response"):
        reply_text = result["response"]
        if channel == "whatsapp":
            send_whatsapp_reply(config, channel_ref, reply_text)
        elif channel == "telegram":
            send_telegram_reply(config, channel_ref, reply_text)

    # Agenda encerramento de sessão por inatividade
    if config and config.session_timeout_minutes > 0:
        from crm.tasks import close_inactive_session
        close_inactive_session.apply_async(
            args=[lead.id, config.id],
            countdown=config.session_timeout_minutes * 60,
        )

    # Sincroniza histórico da conversa com o vault Obsidian
    from crm.tasks import sync_lead_to_obsidian
    sync_lead_to_obsidian.delay(lead.id, tenant_id)

    return lead
