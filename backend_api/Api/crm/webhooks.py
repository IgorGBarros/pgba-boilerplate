"""
Endpoints públicos (sem autenticação JWT) para receber leads de canais externos.

Cada view valida a autenticidade da requisição (HMAC, token ou webhook_secret)
e chama o handler de canal correspondente.

Roteamento em crm/urls.py — prefixo: /api/v1/crm/webhook/
"""
import json
import logging

from django.http import HttpResponse, JsonResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator

from crm.channels import (
    handle_incoming_message,
    parse_meta_ads_lead,
    parse_telegram,
    parse_whatsapp_evolution,
    verify_meta_signature,
    verify_telegram_token,
)
from crm.models import ChannelConfig, Lead, LeadMessage
from crm.services import seed_default_pipeline

logger = logging.getLogger(__name__)


def _get_active_config(tenant_id, channel: str) -> ChannelConfig | None:
    return ChannelConfig.objects.filter(
        tenant_id=tenant_id, channel=channel, is_active=True
    ).first()


# ─── WhatsApp — Evolution API ─────────────────────────────────────────────────

@method_decorator(csrf_exempt, name="dispatch")
class WhatsAppWebhookView(View):
    """
    POST /api/v1/crm/webhook/whatsapp/<tenant_id>/

    A URL contém o tenant_id para que um único servidor sirva múltiplos tenants.
    A Evolution API envia o evento como JSON no body.
    """

    def post(self, request, tenant_id):
        config = _get_active_config(tenant_id, "whatsapp")
        if not config:
            return HttpResponse(status=404)

        try:
            payload = json.loads(request.body)
        except json.JSONDecodeError:
            return HttpResponse(status=400)

        parsed = parse_whatsapp_evolution(payload)
        if not parsed:
            return HttpResponse(status=200)  # evento ignorado — ok para a Evolution API

        channel_ref, nome, texto = parsed
        try:
            handle_incoming_message(
                tenant_id=tenant_id,
                channel="whatsapp",
                channel_ref=channel_ref,
                nome=nome,
                texto=texto,
                config=config,
                telefone=channel_ref,
            )
        except Exception as exc:
            logger.error("WhatsApp webhook: erro ao processar mensagem (%s)", exc)

        return HttpResponse(status=200)


# ─── Telegram Bot ─────────────────────────────────────────────────────────────

@method_decorator(csrf_exempt, name="dispatch")
class TelegramWebhookView(View):
    """
    POST /api/v1/crm/webhook/telegram/<tenant_id>/

    Telegram envia X-Telegram-Bot-Api-Secret-Token para validação.
    """

    def post(self, request, tenant_id):
        config = _get_active_config(tenant_id, "telegram")
        if not config:
            return HttpResponse(status=404)

        token_header = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if not verify_telegram_token(token_header, config):
            return HttpResponse(status=403)

        try:
            payload = json.loads(request.body)
        except json.JSONDecodeError:
            return HttpResponse(status=400)

        parsed = parse_telegram(payload)
        if not parsed:
            return HttpResponse(status=200)

        channel_ref, nome, texto = parsed
        try:
            handle_incoming_message(
                tenant_id=tenant_id,
                channel="telegram",
                channel_ref=channel_ref,
                nome=nome,
                texto=texto,
                config=config,
            )
        except Exception as exc:
            logger.error("Telegram webhook: erro ao processar mensagem (%s)", exc)

        return HttpResponse(status=200)


# ─── Landing Page — captura pública de formulário ─────────────────────────────

@method_decorator(csrf_exempt, name="dispatch")
class LeadCaptureView(View):
    """
    POST /api/v1/crm/webhook/landing-page/<tenant_id>/

    Endpoint público para qualquer formulário HTML enviar leads.
    Aceita JSON ou form-urlencoded.

    Campos esperados (todos opcionais exceto nome):
      nome, email, telefone, empresa, cargo, mensagem, utm_source, utm_medium, utm_campaign
    """

    def post(self, request, tenant_id):
        config = _get_active_config(tenant_id, "landing_page")

        # Aceita mesmo sem configuração ativa — landing page não precisa de config obrigatória
        ct = request.content_type or ""
        if "application/json" in ct:
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                return JsonResponse({"error": "JSON inválido"}, status=400)
        else:
            data = request.POST.dict()

        nome = (data.get("nome") or data.get("name") or "").strip()
        if not nome:
            return JsonResponse({"error": "Campo 'nome' é obrigatório."}, status=400)

        email = data.get("email", "").strip()
        telefone = data.get("telefone") or data.get("phone", "")
        empresa = data.get("empresa") or data.get("company", "")
        mensagem = data.get("mensagem") or data.get("message") or data.get("observacoes", "")

        utm = " | ".join(filter(None, [
            data.get("utm_source", ""),
            data.get("utm_medium", ""),
            data.get("utm_campaign", ""),
        ]))
        obs = mensagem + (f"\nUTM: {utm}" if utm else "")

        try:
            pipeline = None
            if config and config.target_pipeline_id:
                pipeline = config.target_pipeline
            else:
                pipeline = seed_default_pipeline(tenant_id)

            first_stage = pipeline.stages.filter(main_stage="lead").order_by("position").first()

            lead = Lead.objects.create(
                tenant_id=tenant_id,
                nome=nome,
                email=email,
                telefone=telefone,
                empresa=empresa,
                origem="landing_page",
                observacoes=obs,
                pipeline=pipeline,
                stage=first_stage,
                channel_ref=email or telefone or nome,
            )

            LeadMessage.objects.create(
                tenant_id=tenant_id,
                lead=lead,
                role=LeadMessage.Role.SYSTEM,
                content=f"Lead capturado via Landing Page. Mensagem: {mensagem}" if mensagem else "Lead capturado via Landing Page.",
            )

            return JsonResponse({"success": True, "lead_id": lead.id}, status=201)

        except Exception as exc:
            logger.error("LeadCapture: erro ao criar lead (%s)", exc)
            return JsonResponse({"error": "Erro interno."}, status=500)

    def options(self, request, tenant_id):
        """CORS preflight — necessário para forms em domínios diferentes."""
        response = HttpResponse()
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        response["Access-Control-Allow-Headers"] = "Content-Type"
        return response


# ─── Meta Lead Ads (Facebook / Instagram) ────────────────────────────────────

@method_decorator(csrf_exempt, name="dispatch")
class MetaLeadAdsWebhookView(View):
    """
    GET  /api/v1/crm/webhook/meta-ads/<tenant_id>/  — verificação do webhook pelo Meta
    POST /api/v1/crm/webhook/meta-ads/<tenant_id>/  — recebe novos leads

    Fluxo de setup:
    1. Configure o App do Facebook com a URL deste endpoint
    2. O Meta chama GET com hub.challenge para verificação — retorna o challenge
    3. Após verificação, leads de anúncios chegam via POST
    """

    def get(self, request, tenant_id):
        """Verificação do webhook pelo Meta."""
        config = _get_active_config(tenant_id, "meta_ads")
        if not config:
            return HttpResponse(status=404)

        mode = request.GET.get("hub.mode")
        token = request.GET.get("hub.verify_token")
        challenge = request.GET.get("hub.challenge")

        verify_token = config.config.get("verify_token", "")
        if mode == "subscribe" and token == verify_token:
            return HttpResponse(challenge, content_type="text/plain")

        return HttpResponse(status=403)

    def post(self, request, tenant_id):
        """Recebe novos leads do Meta Lead Ads."""
        config = _get_active_config(tenant_id, "meta_ads")
        if not config:
            return HttpResponse(status=404)

        signature = request.headers.get("X-Hub-Signature-256", "")
        if not verify_meta_signature(request.body, signature, config):
            return HttpResponse(status=403)

        try:
            payload = json.loads(request.body)
        except json.JSONDecodeError:
            return HttpResponse(status=400)

        leads_data = parse_meta_ads_lead(payload)
        for ld in leads_data:
            try:
                pipeline = config.target_pipeline or seed_default_pipeline(tenant_id)
                first_stage = pipeline.stages.filter(main_stage="lead").order_by("position").first()

                lead, created = Lead.objects.get_or_create(
                    tenant_id=tenant_id,
                    channel_ref=ld["channel_ref"],
                    defaults={
                        "nome": ld["nome"],
                        "email": ld["email"],
                        "telefone": ld["telefone"],
                        "empresa": ld["empresa"],
                        "origem": "meta_ads",
                        "pipeline": pipeline,
                        "stage": first_stage,
                    },
                )

                if created:
                    LeadMessage.objects.create(
                        tenant_id=tenant_id,
                        lead=lead,
                        role=LeadMessage.Role.SYSTEM,
                        content=f"Lead capturado via Meta Lead Ads (leadgen_id: {ld['channel_ref']})",
                    )
            except Exception as exc:
                logger.error("MetaLeadAds: erro ao criar lead %s (%s)", ld.get("channel_ref"), exc)

        return HttpResponse(status=200)


# ─── API interna: CRUD de ChannelConfig ───────────────────────────────────────

from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from core.mixins import TenantContextMixin
from agency.views import TenantScopedMixin


class ChannelConfigSerializer(serializers.ModelSerializer):
    api_key = serializers.CharField(write_only=True, required=False, allow_blank=True)
    api_key_masked = serializers.SerializerMethodField(read_only=True)
    webhook_url = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = ChannelConfig
        fields = [
            "id", "channel", "is_active", "config", "webhook_secret",
            "welcome_message", "quick_replies",
            "target_pipeline", "api_key", "api_key_masked", "webhook_url",
            "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_api_key_masked(self, obj) -> str:
        if not obj._api_key:
            return ""
        key = obj.api_key
        if len(key) <= 8:
            return "****"
        return key[:4] + "****" + key[-4:]

    def get_webhook_url(self, obj) -> str:
        request = self.context.get("request")
        if not request:
            return ""
        base = request.build_absolute_uri("/")
        tid = obj.tenant_id
        mapping = {
            "whatsapp": f"{base}api/v1/crm/webhook/whatsapp/{tid}/",
            "telegram": f"{base}api/v1/crm/webhook/telegram/{tid}/",
            "landing_page": f"{base}api/v1/crm/webhook/landing-page/{tid}/",
            "meta_ads": f"{base}api/v1/crm/webhook/meta-ads/{tid}/",
        }
        return mapping.get(obj.channel, "")

    def create(self, validated_data):
        api_key = validated_data.pop("api_key", "")
        instance = super().create(validated_data)
        if api_key:
            instance.api_key = api_key
            instance.save(update_fields=["_api_key"])
        return instance

    def update(self, instance, validated_data):
        api_key = validated_data.pop("api_key", None)
        instance = super().update(instance, validated_data)
        if api_key is not None:
            instance.api_key = api_key
            instance.save(update_fields=["_api_key"])
        return instance


class ChannelConfigViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = ChannelConfig.objects.all()
    serializer_class = ChannelConfigSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=True, methods=["post"], url_path="test")
    def test_connection(self, request, pk=None):
        """Testa se as credenciais do canal estão corretas."""
        config = self.get_object()
        results = {"channel": config.channel, "ok": False, "message": ""}

        try:
            if config.channel == "whatsapp":
                import httpx as _httpx
                server_url = config.config.get("server_url", "").rstrip("/")
                instance = config.config.get("instance", "")
                api_key = config.api_key
                if not all([server_url, instance, api_key]):
                    results["message"] = "Preencha server_url, instance e api_key."
                else:
                    resp = _httpx.get(
                        f"{server_url}/instance/fetchInstances",
                        headers={"apikey": api_key},
                        timeout=8,
                    )
                    resp.raise_for_status()
                    results["ok"] = True
                    results["message"] = "Conectado à Evolution API com sucesso."

            elif config.channel == "telegram":
                import httpx as _httpx
                bot_token = config.api_key
                if not bot_token:
                    results["message"] = "bot_token não configurado."
                else:
                    resp = _httpx.get(
                        f"https://api.telegram.org/bot{bot_token}/getMe",
                        timeout=8,
                    )
                    data = resp.json()
                    if data.get("ok"):
                        username = data["result"].get("username", "")
                        results["ok"] = True
                        results["message"] = f"Bot @{username} conectado."
                    else:
                        results["message"] = data.get("description", "Token inválido.")

            else:
                results["ok"] = True
                results["message"] = "Webhook configurado. Aguardando requisições externas."

        except Exception as exc:
            results["message"] = str(exc)

        return Response(results, status=status.HTTP_200_OK)
