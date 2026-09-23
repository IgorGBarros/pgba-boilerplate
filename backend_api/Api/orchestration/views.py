# backend_api/Api/orchestration/views.py
from rest_framework import serializers, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import TenantContextMixin
from orchestration.models import QueryLog
from orchestration.services import answer_question


class QueryLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = QueryLog
        fields = [
            "id", "question", "model_category", "model_name",
            "function_called", "function_params", "function_result",
            "answer", "status", "error_message", "latency_ms",
            "tokens_prompt", "tokens_completion", "cost_estimated_usd",
            "created_at",
        ]
        read_only_fields = fields


class QueryLogViewSet(TenantContextMixin, viewsets.ReadOnlyModelViewSet):
    """
    GET /api/v1/orchestration/query-logs/
    Retorna o histórico de interações de IA do tenant atual (auditoria).
    """
    serializer_class = QueryLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tenant_id = getattr(self.request, "tenant_id", None)
        if not tenant_id:
            return QueryLog.objects.none()
        return QueryLog.objects.filter(tenant_id=tenant_id)


class AskSerializer(serializers.Serializer):
    question = serializers.CharField(max_length=2000)
    use_rag_context = serializers.BooleanField(required=False, default=True)

    def validate_question(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("question não pode ser vazio.")
        return value


class AskView(TenantContextMixin, APIView):
    """
    POST /api/v1/orchestration/ask/
    {"question": "quantas unidades do produto X temos em estoque?"}

    Responde perguntas sobre dado estruturado do tenant atual, usando
    somente funções pré-aprovadas (ver orchestration/registry.py) — nunca
    SQL gerado pela IA.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)

        serializer = AskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        result = answer_question(
            tenant_id=request.tenant_id,
            question=data["question"],
            user=request.user,
            use_rag_context=data["use_rag_context"],
        )
        http_status = status.HTTP_200_OK if result["status"] == "ok" else status.HTTP_502_BAD_GATEWAY
        return Response(result, status=http_status)
