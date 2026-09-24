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
from typing import Optional

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

def handle_incoming_message(
    tenant_id,
    channel: str,
    channel_ref: str,
    nome: str,
    texto: str,
    config: Optional[ChannelConfig] = None,
    telefone: str = "",
    auto_reply: bool = True,
) -> Lead:
    """
    Processa mensagem recebida de qualquer canal:
    1. Cria/atualiza lead
    2. Qualifica via agente
    3. Envia resposta de volta (se auto_reply e canal suportar)
    """
    lead, _ = _get_or_create_lead(tenant_id, channel, channel_ref, nome, telefone, config)

    result = qualify_lead(lead.id, texto, tenant_id)

    if auto_reply and config and result.get("response"):
        reply_text = result["response"]
        if channel == "whatsapp":
            send_whatsapp_reply(config, channel_ref, reply_text)
        elif channel == "telegram":
            send_telegram_reply(config, channel_ref, reply_text)

    return lead
