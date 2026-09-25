from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from core.mixins import TenantContextMixin
from agency.views import TenantScopedMixin
from crm.models import (
    Lead, Deal, Project, Contato, AtividadeCRM,
    Pipeline, Stage, LeadMessage,
    CustomFieldDefinition, CustomFieldValue,
)
from crm.serializers import (
    LeadSerializer, LeadMoveSerializer, LeadMessageSerializer, QualifyLeadSerializer,
    DealSerializer, DealMoveSerializer,
    ProjectSerializer, ProjectMoveSerializer,
    ContatoSerializer, AtividadeCRMSerializer,
    PipelineSerializer, StageSerializer,
    CustomFieldDefinitionSerializer, CustomFieldValueSerializer,
)
from crm.services import (
    move_lead_to_stage, convert_lead_to_deal, qualify_lead,
    move_deal_to_stage, set_deal_outcome,
    move_project_to_stage, set_project_outcome,
    seed_default_pipeline,
)


class PipelineViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Pipeline.objects.prefetch_related("stages").all()
    serializer_class = PipelineSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["post"], url_path="seed-default")
    def seed_default(self, request):
        pipeline = seed_default_pipeline(request.tenant_id)
        return Response(PipelineSerializer(pipeline).data, status=status.HTTP_200_OK)


class StageViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Stage.objects.all()
    serializer_class = StageSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["pipeline", "main_stage"]


# ─── Custom Fields ────────────────────────────────────────────────────────────

class CustomFieldDefinitionViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = CustomFieldDefinition.objects.filter(is_active=True)
    serializer_class = CustomFieldDefinitionSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["entity_type", "field_type"]

    def perform_create(self, serializer):
        serializer.save(tenant_id=self.request.tenant_id)


class CustomFieldValueViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = CustomFieldValue.objects.select_related("field_def").all()
    serializer_class = CustomFieldValueSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["entity_type", "entity_id", "field_def"]

    def perform_create(self, serializer):
        serializer.save(tenant_id=self.request.tenant_id)

    @action(detail=False, methods=["post"], url_path="bulk-upsert")
    def bulk_upsert(self, request):
        """Salva múltiplos valores de campos customizados de uma vez."""
        values = request.data.get("values", [])
        results = []
        for item in values:
            field_def_id = item.get("field_def")
            entity_type = item.get("entity_type")
            entity_id = item.get("entity_id")
            value = item.get("value")
            obj, _ = CustomFieldValue.objects.update_or_create(
                tenant_id=request.tenant_id,
                field_def_id=field_def_id,
                entity_type=entity_type,
                entity_id=entity_id,
                defaults={"value": value},
            )
            results.append(CustomFieldValueSerializer(obj).data)
        return Response(results, status=status.HTTP_200_OK)


# ─── Lead ─────────────────────────────────────────────────────────────────────

class LeadViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Lead.objects.select_related("stage").filter(is_active=True)
    serializer_class = LeadSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["stage", "pipeline", "responsavel", "origem", "outcome"]
    search_fields = ["nome", "empresa", "email"]
    ordering_fields = ["created_at", "valor_estimado", "position"]

    @action(detail=True, methods=["post"], url_path="move")
    def move(self, request, pk=None):
        lead = self.get_object()
        serializer = LeadMoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lead = move_lead_to_stage(lead.id, serializer.validated_data["stage_id"], request.tenant_id)
        return Response(LeadSerializer(lead).data)

    @action(detail=True, methods=["get"], url_path="messages")
    def messages(self, request, pk=None):
        lead = self.get_object()
        qs = LeadMessage.objects.filter(lead=lead, tenant_id=request.tenant_id).order_by("created_at")
        return Response(LeadMessageSerializer(qs, many=True).data)

    @action(detail=True, methods=["post"], url_path="qualify")
    def qualify(self, request, pk=None):
        lead = self.get_object()
        serializer = QualifyLeadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = qualify_lead(lead.id, serializer.validated_data["message"], request.tenant_id)
        return Response(result, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="set-outcome")
    def set_outcome(self, request, pk=None):
        lead = self.get_object()
        outcome = request.data.get("outcome", "")
        VALID = {"convertido", "perdido", "cancelado", ""}
        if outcome not in VALID:
            return Response({"detail": "outcome inválido."}, status=status.HTTP_400_BAD_REQUEST)
        lead.outcome = outcome
        lead.save(update_fields=["outcome"])
        return Response(LeadSerializer(lead).data)

    @action(detail=True, methods=["post"], url_path="convert-to-deal")
    def convert_to_deal(self, request, pk=None):
        """Converte o lead em Deal, criando o registro na tabela Deal."""
        lead = self.get_object()
        titulo = request.data.get("titulo", "")
        responsavel = request.data.get("responsavel", "")
        valor = request.data.get("valor")
        deal = convert_lead_to_deal(lead.id, request.tenant_id, titulo=titulo, responsavel=responsavel, valor=valor)
        return Response(DealSerializer(deal).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="token-usage")
    def token_usage(self, request, pk=None):
        """Retorna consumo de tokens e custo estimado das mensagens de IA deste lead."""
        from django.db.models import Sum, Count
        lead = self.get_object()
        qs = LeadMessage.objects.filter(
            lead=lead, tenant_id=request.tenant_id, role=LeadMessage.Role.AGENT
        )
        agg = qs.aggregate(
            total_tokens_in=Sum("tokens_in"),
            total_tokens_out=Sum("tokens_out"),
            total_cost=Sum("cost_estimated_usd"),
            messages=Count("id"),
        )
        return Response({
            "lead_id": lead.id,
            "nome": lead.nome,
            "tokens_in": agg["total_tokens_in"] or 0,
            "tokens_out": agg["total_tokens_out"] or 0,
            "total_tokens": (agg["total_tokens_in"] or 0) + (agg["total_tokens_out"] or 0),
            "cost_estimated_usd": float(agg["total_cost"] or 0),
            "ai_messages": agg["messages"] or 0,
        })

    @action(detail=True, methods=["get"], url_path="obsidian-note")
    def obsidian_note(self, request, pk=None):
        """Retorna o conteúdo da nota Obsidian do lead, se existir."""
        lead = self.get_object()
        from crm.obsidian import lead_note_path, render_lead_note
        from crm.models import LeadMessage

        path = lead_note_path(lead)
        if path is None:
            return Response(
                {"detail": "OBSIDIAN_VAULT_PATH não configurado.", "content": None, "exists": False},
                status=200,
            )
        if not path.exists():
            return Response({"detail": "Nota ainda não gerada.", "content": None, "exists": False}, status=200)

        content = path.read_text(encoding="utf-8")
        return Response({"content": content, "exists": True, "path": str(path)})


# ─── Deal ─────────────────────────────────────────────────────────────────────

class DealViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Deal.objects.select_related("stage", "lead").filter(is_active=True)
    serializer_class = DealSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["stage", "pipeline", "lead", "responsavel", "outcome"]
    search_fields = ["titulo", "empresa"]
    ordering_fields = ["created_at", "valor", "position"]

    @action(detail=True, methods=["post"], url_path="move")
    def move(self, request, pk=None):
        deal = self.get_object()
        serializer = DealMoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        deal = move_deal_to_stage(deal.id, serializer.validated_data["stage_id"], request.tenant_id)
        return Response(DealSerializer(deal).data)

    @action(detail=True, methods=["post"], url_path="set-outcome")
    def set_outcome(self, request, pk=None):
        deal = self.get_object()
        outcome = request.data.get("outcome", "")
        try:
            deal = set_deal_outcome(deal.id, outcome, request.tenant_id)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(DealSerializer(deal).data)

    @action(detail=True, methods=["post"], url_path="convert-to-project")
    def convert_to_project(self, request, pk=None):
        """Cria um Project a partir deste Deal (sem alterar o outcome automaticamente)."""
        deal = self.get_object()
        titulo = request.data.get("titulo", deal.titulo)
        first_stage = Stage.objects.filter(
            tenant_id=request.tenant_id,
            pipeline=deal.pipeline,
            main_stage="project",
        ).order_by("position").first()
        project = Project.objects.create(
            tenant_id=request.tenant_id,
            deal=deal,
            lead=deal.lead,
            pipeline=deal.pipeline,
            stage=first_stage,
            titulo=titulo,
            empresa=deal.empresa,
            responsavel=deal.responsavel,
        )
        return Response(ProjectSerializer(project).data, status=status.HTTP_201_CREATED)


# ─── Project ──────────────────────────────────────────────────────────────────

class ProjectViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Project.objects.select_related("stage", "deal", "lead").filter(is_active=True)
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["stage", "pipeline", "deal", "lead", "responsavel", "outcome"]
    search_fields = ["titulo", "empresa"]
    ordering_fields = ["created_at", "data_fim_previsto", "position"]

    @action(detail=True, methods=["post"], url_path="move")
    def move(self, request, pk=None):
        project = self.get_object()
        serializer = ProjectMoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = move_project_to_stage(project.id, serializer.validated_data["stage_id"], request.tenant_id)
        return Response(ProjectSerializer(project).data)

    @action(detail=True, methods=["post"], url_path="set-outcome")
    def set_outcome(self, request, pk=None):
        project = self.get_object()
        outcome = request.data.get("outcome", "")
        try:
            project = set_project_outcome(project.id, outcome, request.tenant_id)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(ProjectSerializer(project).data)


# ─── Contato e Atividade ──────────────────────────────────────────────────────

class ContatoViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Contato.objects.select_related("lead").filter(is_active=True)
    serializer_class = ContatoSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["lead"]
    search_fields = ["nome", "empresa", "email"]
    ordering_fields = ["nome", "created_at"]



class AtividadeCRMViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = AtividadeCRM.objects.select_related("lead").filter(is_active=True)
    serializer_class = AtividadeCRMSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["tipo", "lead", "responsavel"]
    search_fields = ["titulo", "responsavel"]
    ordering_fields = ["data_hora", "created_at"]


# ─── Token Usage Summary ──────────────────────────────────────────────────────

class TokenUsageSummaryView(TenantContextMixin, APIView):
    """
    GET /api/v1/crm/token-usage/

    Resumo agregado de tokens e custo estimado das interações de IA do CRM,
    agrupado por canal de origem do lead.

    Query params opcionais:
      - days: janela em dias (padrão: 30)
      - channel: filtrar por canal (whatsapp, telegram, landing_page, etc.)
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.db.models import Sum, Count, F
        from django.utils import timezone as tz
        import datetime

        tenant_id = getattr(request, "tenant_id", None)
        if not tenant_id:
            return Response({"detail": "Acesso requer tenant válido"}, status=403)

        days = int(request.query_params.get("days", 30))
        channel_filter = request.query_params.get("channel", "")
        since = tz.now() - datetime.timedelta(days=days)

        qs = LeadMessage.objects.filter(
            tenant_id=tenant_id,
            role=LeadMessage.Role.AGENT,
            created_at__gte=since,
        ).exclude(tokens_in=0, tokens_out=0)

        if channel_filter:
            qs = qs.filter(lead__origem=channel_filter)

        # Totais gerais
        totals = qs.aggregate(
            total_tokens_in=Sum("tokens_in"),
            total_tokens_out=Sum("tokens_out"),
            total_cost=Sum("cost_estimated_usd"),
            total_messages=Count("id"),
            total_leads=Count("lead", distinct=True),
        )

        # Por canal de origem
        by_channel = list(
            qs.values(channel=F("lead__origem"))
            .annotate(
                tokens_in=Sum("tokens_in"),
                tokens_out=Sum("tokens_out"),
                cost_usd=Sum("cost_estimated_usd"),
                messages=Count("id"),
                leads=Count("lead", distinct=True),
            )
            .order_by("-cost_usd")
        )
        for row in by_channel:
            row["total_tokens"] = (row["tokens_in"] or 0) + (row["tokens_out"] or 0)
            row["cost_usd"] = float(row["cost_usd"] or 0)

        # Top leads por consumo
        top_leads = list(
            qs.values("lead__id", "lead__nome", "lead__empresa", "lead__origem")
            .annotate(
                tokens=Sum("tokens_in") + Sum("tokens_out"),
                cost_usd=Sum("cost_estimated_usd"),
                messages=Count("id"),
            )
            .order_by("-cost_usd")[:10]
        )
        for row in top_leads:
            row["cost_usd"] = float(row["cost_usd"] or 0)

        return Response({
            "period_days": days,
            "totals": {
                "tokens_in": totals["total_tokens_in"] or 0,
                "tokens_out": totals["total_tokens_out"] or 0,
                "total_tokens": (totals["total_tokens_in"] or 0) + (totals["total_tokens_out"] or 0),
                "cost_estimated_usd": float(totals["total_cost"] or 0),
                "ai_messages": totals["total_messages"] or 0,
                "leads_with_ai": totals["total_leads"] or 0,
            },
            "by_channel": by_channel,
            "top_leads": top_leads,
        })
