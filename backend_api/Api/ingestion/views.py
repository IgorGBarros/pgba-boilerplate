# backend_api/Api/ingestion/views.py
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import TenantContextMixin
from ingestion.models import KnowledgeSource, Document
from ingestion.serializers import (
    KnowledgeSourceSerializer,
    DocumentSerializer,
    DocumentUploadSerializer,
    RAGQuerySerializer,
)
from ingestion.services import (
    semantic_search,
    build_context_prompt,
    generate_answer,
    EmbeddingError,
)
from ingestion.tasks import (
    process_document_task,
    sync_obsidian_source_task,
)


class TenantScopedMixin:
    """Toda queryset deste app é obrigatoriamente filtrada por tenant."""

    def get_queryset(self):
        tenant_id = getattr(self.request, "tenant_id", None)
        if not tenant_id:
            return self.queryset.none()
        return self.queryset.filter(tenant_id=tenant_id)

    def perform_create(self, serializer):
        serializer.save(tenant_id=self.request.tenant_id)


class KnowledgeSourceViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = KnowledgeSource.objects.all()
    serializer_class = KnowledgeSourceSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=True, methods=["post"])
    def sync(self, request, pk=None):
        """Dispara (assíncrono) a sincronização de uma fonte Obsidian/URL/API."""
        source = self.get_object()
        if source.source_type != KnowledgeSource.SourceType.OBSIDIAN:
            return Response(
                {"detail": "Sync automático hoje só é suportado para source_type=obsidian."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        sync_obsidian_source_task.delay(source.id)
        return Response({"detail": "Sincronização enfileirada."}, status=202)


class DocumentViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    permission_classes = [IsAuthenticated]


class DocumentUploadView(TenantContextMixin, APIView):
    """Upload manual de um documento avulso, fora do fluxo Obsidian."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)

        serializer = DocumentUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            source = KnowledgeSource.objects.get(
                id=data["source_id"], tenant_id=request.tenant_id
            )
        except KnowledgeSource.DoesNotExist:
            return Response(
                {"detail": "source_id inválido para este tenant."},
                status=status.HTTP_404_NOT_FOUND,
            )

        document = Document.objects.create(
            tenant_id=request.tenant_id,
            source=source,
            external_id=f"upload:{timezone.now().timestamp()}",
            title=data["title"],
            content=data["content"],
            metadata=data.get("metadata", {}),
            status=Document.Status.PENDING,
        )
        process_document_task.delay(document.id)

        return Response(
            DocumentSerializer(document).data, status=status.HTTP_202_ACCEPTED
        )


class RAGQueryView(TenantContextMixin, APIView):
    """
    Endpoint principal de consulta RAG.

    Sempre retorna os chunks recuperados (com fonte e distância) — nunca
    apenas a resposta gerada. Isso é o que dá auditabilidade ao "Cérebro
    Corporativo": qualquer resposta pode ser rastreada até a nota do
    Obsidian (ou documento) que a originou.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)

        serializer = RAGQuerySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            chunks = semantic_search(
                data["query"], tenant_id=request.tenant_id, top_k=data["top_k"]
            )
        except EmbeddingError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        result = {
            "query": data["query"],
            "sources": [
                {
                    "document_title": c.document_title,
                    "source_name": c.source_name,
                    "content": c.content,
                    "distance": c.distance,
                }
                for c in chunks
            ],
        }

        if data["generate_answer"] and chunks:
            try:
                context = build_context_prompt(chunks)
                result["answer"] = generate_answer(data["query"], context, tenant_id=request.tenant_id)
            except EmbeddingError as exc:
                result["answer"] = None
                result["answer_error"] = str(exc)

        return Response(result)
