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
