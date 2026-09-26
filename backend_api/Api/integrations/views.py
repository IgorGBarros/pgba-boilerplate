# backend_api/Api/integrations/views.py
"""
API do painel administrativo — integrações de infraestrutura/comunicação:
credenciais (GitHub, n8n, Hostinger...), servidores (VPS), caixas de e-mail
dos setores e e-mails de saída. Toda view é do tenant do usuário.
"""
from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import SoftDeleteViewMixin, TenantContextMixin
from integrations import n8n, hostinger
from integrations.email import (
    PRESETS,
    EmailError,
    account_for_sector,
    fetch_inbox,
    test_account,
)
from integrations.models import (
    EmailAccount,
    InboundEmail,
    OutboundEmail,
    ServerConnection,
    ServiceCredential,
)
from integrations.serializers import (
    EmailAccountSerializer,
    InboundEmailSerializer,
    OutboundEmailSerializer,
    ServerConnectionSerializer,
    ServiceCredentialSerializer,
)
from integrations.servers import check_server


def _require_tenant(request):
    if not getattr(request, "tenant_id", None):
        return Response({"detail": "Acesso requer tenant válido"}, status=403)
    return None


class MailPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class _TenantViewSet(TenantContextMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return self.queryset.filter(tenant_id=self.request.tenant_id)

    def perform_create(self, serializer):
        serializer.save(tenant_id=self.request.tenant_id)


# ─── Credenciais (GitHub, n8n, Hostinger, ...) ──────────────────────────────

TESTERS = {
    "n8n": n8n.test_connection,
    "hostinger": hostinger.test_connection,
}


class CredentialListView(TenantContextMixin, APIView):
    """GET lista por provedor; POST cria/substitui a credencial ativa do provedor."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if denied := _require_tenant(request):
            return denied
        qs = ServiceCredential.objects.filter(tenant_id=request.tenant_id, is_active=True)
        return Response(ServiceCredentialSerializer(qs, many=True).data)

    def post(self, request):
        if denied := _require_tenant(request):
            return denied
        provider = request.data.get("provider")
        if provider not in ServiceCredential.Provider.values:
            return Response({"provider": "Provedor inválido."}, status=400)
        current = ServiceCredential.objects.filter(
            tenant_id=request.tenant_id, provider=provider, is_active=True
        ).first()
        ser = ServiceCredentialSerializer(current, data=request.data, partial=bool(current))
        ser.is_valid(raise_exception=True)
        token = ser.validated_data.pop("token", None)
        if current is None and not token:
            return Response({"token": "Informe o token / API key."}, status=400)
        cred = current or ServiceCredential(tenant_id=request.tenant_id, provider=provider)
        for k, v in ser.validated_data.items():
            setattr(cred, k, v)
        if token and not token.startswith("••••"):
            try:
                cred.token = token
            except Exception:
                return Response(
                    {"token": "Defina ENCRYPTION_KEY no servidor para guardar tokens."}, status=400
                )
        cred.save()
        return Response(
            ServiceCredentialSerializer(cred).data, status=201 if current is None else 200
        )


class CredentialDetailView(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, provider):
        ServiceCredential.objects.filter(
            tenant_id=request.tenant_id, provider=provider, is_active=True
        ).update(is_active=False)
        return Response(status=204)


class CredentialTestView(TenantContextMixin, APIView):
    """Chamada real ao serviço — nunca "salvo" fingindo que testou."""

    permission_classes = [IsAuthenticated]

    def post(self, request, provider):
        if denied := _require_tenant(request):
            return denied
        tester = TESTERS.get(provider)
        if tester is None:
            if provider == "github":
                from integrations.github import GitHubError
                from integrations.services import IntegrationConfigError, get_credential
                import httpx

                try:
                    cred = get_credential(request.tenant_id, "github")
                    resp = httpx.get(
                        "https://api.github.com/user",
                        headers={"Authorization": f"Bearer {cred.token}"},
                        timeout=15,
                    )
                    if resp.status_code != 200:
                        raise GitHubError(f"GitHub respondeu {resp.status_code}.")
                    return Response(
                        {"ok": True, "detail": f"Conectou como {resp.json().get('login')}."}
                    )
                except (IntegrationConfigError, GitHubError, httpx.HTTPError) as exc:
                    return Response({"ok": False, "detail": str(exc)}, status=400)
            return Response({"ok": False, "detail": "Sem teste para este provedor."}, status=400)
        try:
            return Response({"ok": True, "detail": tester(request.tenant_id)})
        except (n8n.N8nError, hostinger.HostingerError) as exc:
            return Response({"ok": False, "detail": str(exc)}, status=400)


# ─── n8n ─────────────────────────────────────────────────────────────────────


class N8nOverviewView(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if denied := _require_tenant(request):
            return denied
        try:
            return Response(n8n.overview(request.tenant_id))
        except n8n.N8nError as exc:
            return Response({"detail": str(exc)}, status=400)


class N8nExecutionsView(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if denied := _require_tenant(request):
            return denied
        try:
            rows = n8n.list_executions(
                request.tenant_id,
                workflow_id=request.query_params.get("workflow"),
                status=request.query_params.get("status"),
                limit=min(int(request.query_params.get("limit", 50) or 50), 250),
            )
        except (n8n.N8nError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(rows)


class N8nWorkflowActiveView(TenantContextMixin, APIView):
    """Liga/desliga um workflow — ação de pessoa, pelo painel."""

    permission_classes = [IsAuthenticated]

    def post(self, request, workflow_id):
        if denied := _require_tenant(request):
            return denied
        try:
            return Response(
                n8n.set_active(request.tenant_id, workflow_id, bool(request.data.get("active")))
            )
        except n8n.N8nError as exc:
            return Response({"detail": str(exc)}, status=400)


# ─── Hostinger ───────────────────────────────────────────────────────────────


class HostingerOverviewView(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if denied := _require_tenant(request):
            return denied
        out = {"vps": [], "domains": [], "errors": []}
        for key, fn in (("vps", hostinger.list_vps), ("domains", hostinger.list_domains)):
            try:
                out[key] = fn(request.tenant_id)
            except hostinger.HostingerError as exc:
                out["errors"].append(f"{key}: {exc}")
        return Response(out)


# ─── Servidores (VPS) ────────────────────────────────────────────────────────


class ServerConnectionViewSet(SoftDeleteViewMixin, _TenantViewSet):
    queryset = ServerConnection.objects.all()
    serializer_class = ServerConnectionSerializer

    @action(detail=True, methods=["post"])
    def check(self, request, pk=None):
        server = self.get_object()
        msg = check_server(server)
        return Response(
            {"ok": bool(server.last_check_ok), "detail": msg, **self.get_serializer(server).data}
        )


# ─── Caixas de e-mail dos setores ────────────────────────────────────────────


class EmailAccountViewSet(SoftDeleteViewMixin, _TenantViewSet):
    queryset = EmailAccount.objects.select_related("sector")
    serializer_class = EmailAccountSerializer

    def perform_create(self, serializer):
        serializer.save()

    @action(detail=False, methods=["get"])
    def presets(self, request):
        return Response(PRESETS)

    @action(detail=False, methods=["get"])
    def overview(self, request):
        """Um item por setor (com a caixa, se tiver) + a caixa padrão da empresa."""
        from agency.models import Agent, Sector

        accounts = {a.sector_id: a for a in self.get_queryset()}
        sectors = Sector.objects.filter(tenant_id=request.tenant_id, is_active=True).order_by(
            "name"
        )
        drafts = {}
        for row in OutboundEmail.objects.filter(
            tenant_id=request.tenant_id, status=OutboundEmail.Status.DRAFT
        ).values_list("sector_id", flat=True):
            drafts[row] = drafts.get(row, 0) + 1
        unread = dict(
            InboundEmail.objects.filter(tenant_id=request.tenant_id, is_active=True, is_read=False)
            .values_list("sector_id")
            .annotate(n=Count("id"))
        )
        sent = dict(
            OutboundEmail.objects.filter(
                tenant_id=request.tenant_id, status=OutboundEmail.Status.SENT
            )
            .values_list("sector_id")
            .annotate(n=Count("id"))
        )
        rows = []
        for s in sectors:
            acc = accounts.get(s.id)
            rows.append(
                {
                    "sector": {"id": s.id, "name": s.name},
                    "agents": list(
                        Agent.objects.filter(sector=s, is_active=True).values_list(
                            "name", flat=True
                        )[:6]
                    ),
                    "account": EmailAccountSerializer(acc, context={"request": request}).data
                    if acc
                    else None,
                    "drafts": drafts.get(s.id, 0),
                    "unread": unread.get(s.id, 0),
                    "sent": sent.get(s.id, 0),
                }
            )
        default = accounts.get(None)
        return Response(
            {
                "default_account": EmailAccountSerializer(
                    default, context={"request": request}
                ).data
                if default
                else None,
                "sectors": rows,
            }
        )

    @action(detail=True, methods=["post"])
    def fetch(self, request, pk=None):
        """Busca os e-mails novos agora (IMAP, só leitura). O beat faz isso a cada 5 min."""
        account = self.get_object()
        try:
            created = fetch_inbox(account)
        except EmailError as exc:
            return Response({"ok": False, "detail": str(exc)}, status=400)
        return Response({"ok": True, "created": created, "detail": account.last_fetch_message})

    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        account = self.get_object()
        try:
            msg = test_account(account)
            ok = True
        except EmailError as exc:
            msg, ok = str(exc), False
        account.refresh_from_db()
        return Response(
            {"ok": ok, "detail": msg, "account": self.get_serializer(account).data},
            status=200 if ok else 400,
        )


# ─── E-mails de saída ────────────────────────────────────────────────────────


class OutboundEmailViewSet(_TenantViewSet):
    queryset = OutboundEmail.objects.select_related("sector", "account")
    serializer_class = OutboundEmailSerializer
    pagination_class = MailPagination
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("sector"):
            qs = qs.filter(sector_id=p["sector"])
        if p.get("origin"):
            qs = qs.filter(origin=p["origin"])
        return qs

    def perform_create(self, serializer):
        serializer.save(
            tenant_id=self.request.tenant_id, requested_by=self.request.user.email or ""
        )

    def perform_update(self, serializer):
        if serializer.instance.status not in (
            OutboundEmail.Status.DRAFT,
            OutboundEmail.Status.FAILED,
        ):
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"detail": "Só rascunho (ou envio que falhou) pode ser editado."})
        serializer.save()

    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        email = self.get_object()
        if email.status not in (OutboundEmail.Status.DRAFT, OutboundEmail.Status.FAILED):
            return Response({"detail": "Este e-mail não está pendente."}, status=400)
        if account_for_sector(request.tenant_id, email.sector_id) is None:
            return Response(
                {
                    "detail": "O setor não tem caixa de e-mail pronta (nem há caixa padrão da "
                    "empresa). Configure em Painel administrativo → E-mails; o rascunho "
                    "continua salvo."
                },
                status=400,
            )
        from integrations.tasks import send_outbound_task

        who = request.user.email or str(request.user.pk)
        try:
            send_outbound_task.delay(email.id, who)
            queued = True
        except Exception:  # sem broker: envia na hora
            send_outbound_task(email.id, who)
            queued = False
        email.refresh_from_db()
        return Response({"queued": queued, **self.get_serializer(email).data})

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        with transaction.atomic():
            email = self.get_queryset().select_for_update().get(pk=self.get_object().pk)
            if email.status not in (OutboundEmail.Status.DRAFT, OutboundEmail.Status.FAILED):
                return Response({"detail": "Só rascunho pode ser cancelado."}, status=400)
            email.status, email.updated_at = OutboundEmail.Status.CANCELLED, timezone.now()
            email.save()
        return Response(self.get_serializer(email).data, status=status.HTTP_200_OK)


# ─── E-mails recebidos ───────────────────────────────────────────────────────


class InboundEmailViewSet(SoftDeleteViewMixin, _TenantViewSet):
    """Caixa de entrada: lista (filtro por setor / não lidos), abrir, marcar lido, arquivar."""

    queryset = InboundEmail.objects.select_related("sector", "account").prefetch_related("replies")
    serializer_class = InboundEmailSerializer
    pagination_class = MailPagination
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("sector"):
            qs = qs.filter(sector_id=p["sector"])
        if p.get("unread") in ("1", "true"):
            qs = qs.filter(is_read=False)
        if p.get("search"):
            from django.db.models import Q

            term = p["search"][:100]
            qs = qs.filter(
                Q(subject__icontains=term)
                | Q(from_address__icontains=term)
                | Q(body__icontains=term)
            )
        return qs
