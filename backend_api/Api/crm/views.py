from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend

from core.mixins import TenantContextMixin
from agency.views import TenantScopedMixin
from crm.models import Lead, Contato, Oportunidade, AtividadeCRM, Pipeline, Stage, LeadMessage
from crm.serializers import (
    LeadSerializer,
    LeadMoveSerializer,
    LeadMessageSerializer,
    QualifyLeadSerializer,
    ContatoSerializer,
    OportunidadeSerializer,
    AtividadeCRMSerializer,
    PipelineSerializer,
    StageSerializer,
)
from crm.services import move_lead_to_stage, qualify_lead, seed_default_pipeline


class PipelineViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Pipeline.objects.prefetch_related("stages").all()
    serializer_class = PipelineSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["post"], url_path="seed-default")
    def seed_default(self, request):
        """Cria o pipeline padrão com as etapas sugeridas genéricas."""
        pipeline = seed_default_pipeline(request.tenant_id)
        return Response(PipelineSerializer(pipeline).data, status=status.HTTP_200_OK)


class StageViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Stage.objects.all()
    serializer_class = StageSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["pipeline", "main_stage"]


class LeadViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Lead.objects.select_related("stage").all()
    serializer_class = LeadSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["stage", "pipeline", "responsavel", "origem"]
    search_fields = ["nome", "empresa", "email"]
    ordering_fields = ["created_at", "valor_estimado", "position"]

    @action(detail=True, methods=["post"], url_path="move")
    def move(self, request, pk=None):
        """Move o lead para uma nova etapa do kanban."""
        lead = self.get_object()
        serializer = LeadMoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lead = move_lead_to_stage(lead.id, serializer.validated_data["stage_id"], request.tenant_id)
        return Response(LeadSerializer(lead).data)

    @action(detail=True, methods=["get"], url_path="messages")
    def messages(self, request, pk=None):
        """Histórico de mensagens do agente para este lead."""
        lead = self.get_object()
        qs = LeadMessage.objects.filter(lead=lead, tenant_id=request.tenant_id).order_by("created_at")
        return Response(LeadMessageSerializer(qs, many=True).data)

    @action(detail=True, methods=["post"], url_path="qualify")
    def qualify(self, request, pk=None):
        """Envia uma mensagem para o agente comercial qualificador."""
        lead = self.get_object()
        serializer = QualifyLeadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = qualify_lead(lead.id, serializer.validated_data["message"], request.tenant_id)
        return Response(result, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="set-outcome")
    def set_outcome(self, request, pk=None):
        """
        Define o desfecho do lead e executa automação de transição de coluna:
          - Lead com outcome "vendido" ou "concluido" → move para o primeiro stage de Deal
          - Deal com outcome "contrato_assinado" ou "concluido" → move para o primeiro stage de Project
          - outcome "perdido" ou "cancelado" → apenas registra, sem mover
        """
        lead = self.get_object()
        outcome = request.data.get("outcome", "")

        VALID_OUTCOMES = {"vendido", "concluido", "perdido", "contrato_assinado", "cancelado"}
        if outcome and outcome not in VALID_OUTCOMES:
            return Response({"detail": "outcome inválido."}, status=status.HTTP_400_BAD_REQUEST)

        lead.outcome = outcome
        lead.save(update_fields=["outcome"])

        ADVANCE_MAP = {
            "lead": {
                "outcomes": {"vendido", "concluido"},
                "target": "deal",
            },
            "deal": {
                "outcomes": {"contrato_assinado", "concluido"},
                "target": "project",
            },
        }

        current_main = lead.stage.main_stage if lead.stage else None
        rule = ADVANCE_MAP.get(current_main)
        if rule and outcome in rule["outcomes"]:
            next_stage = Stage.objects.filter(
                tenant_id=request.tenant_id,
                pipeline=lead.pipeline,
                main_stage=rule["target"],
            ).order_by("position").first()
            if next_stage:
                lead = move_lead_to_stage(lead.id, next_stage.id, request.tenant_id)

        return Response(LeadSerializer(lead).data)


class ContatoViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Contato.objects.select_related("lead").all()
    serializer_class = ContatoSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["lead"]
    search_fields = ["nome", "empresa", "email"]
    ordering_fields = ["nome", "created_at"]


class OportunidadeViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Oportunidade.objects.select_related("lead").all()
    serializer_class = OportunidadeSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "lead"]
    search_fields = ["titulo"]
    ordering_fields = ["created_at", "valor", "data_fechamento_previsto"]


class AtividadeCRMViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = AtividadeCRM.objects.select_related("lead").all()
    serializer_class = AtividadeCRMSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["tipo", "lead", "responsavel"]
    search_fields = ["titulo", "responsavel"]
    ordering_fields = ["data_hora", "created_at"]
