# backend_api/Api/ingestion/views.py
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser

from core.mixins import TenantContextMixin
from ingestion.models import KnowledgeSource, Document
from ingestion.serializers import (
    KnowledgeSourceSerializer,
    DocumentSerializer,
    DocumentUploadSerializer,
    DocumentFileUploadSerializer,
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

    @action(detail=True, methods=["post"], url_path="test-connection")
    def test_connection(self, request, pk=None):
        """Valida a configuração da fonte sem executar um sync completo."""
        source = self.get_object()
        cfg = source.config or {}

        REQUIRED_FIELDS = {
            "rest_api": ["url"],
            "url": ["url"],
            "sql": ["host", "database", "user"],
            "google_sheets": ["spreadsheet_id"],
            "slack": ["bot_token"],
            "webhook": [],
            "email": ["host", "user"],
            "notion": ["integration_token", "database_id"],
            "hubspot": ["api_key"],
            "salesforce": ["client_id", "client_secret", "instance_url"],
            "obsidian": ["vault_path"],
        }

        required = REQUIRED_FIELDS.get(source.source_type, [])
        missing = [f for f in required if not cfg.get(f)]
        if missing:
            return Response(
                {"ok": False, "message": f"Campos obrigatórios ausentes: {', '.join(missing)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Para tipos com URL, tenta um HEAD request simples
        if source.source_type in ("rest_api", "url") and cfg.get("url"):
            try:
                import urllib.request
                req = urllib.request.Request(cfg["url"], method="HEAD")
                headers = cfg.get("headers", {})
                auth_type = cfg.get("auth_type", "none")
                if auth_type == "bearer" and cfg.get("api_key"):
                    req.add_header("Authorization", f"Bearer {cfg['api_key']}")
                elif auth_type == "api_key" and cfg.get("api_key"):
                    header_name = cfg.get("api_key_header", "X-API-Key")
                    req.add_header(header_name, cfg["api_key"])
                for k, v in headers.items():
                    req.add_header(k, v)
                with urllib.request.urlopen(req, timeout=5):
                    pass
                return Response({"ok": True, "message": "Conexão estabelecida com sucesso."})
            except Exception as exc:
                return Response(
                    {"ok": False, "message": f"Falha na conexão: {exc}"},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

        return Response({"ok": True, "message": "Configuração salva. Conexão será verificada no primeiro sync."})


class DocumentViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        source_id = self.request.query_params.get("source")
        if source_id:
            qs = qs.filter(source_id=source_id)
        return qs.order_by("-updated_at")


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


def _extract_text_from_upload(uploaded_file) -> tuple[str, str]:
    """
    Retorna (texto_extraido, aviso). Aviso vazio = extração real
    aconteceu. PDF usa pypdf de verdade; qualquer outro tipo (imagem,
    .docx, planilha, etc.) NUNCA finge ter lido o conteúdo — grava um
    texto claro dizendo que não foi extraído, pra nunca virar contexto
    fabricado no RAG.
    """
    name = uploaded_file.name
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""

    if ext == "pdf":
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError

        try:
            reader = PdfReader(uploaded_file)
            pages_text = [page.extract_text() or "" for page in reader.pages]
            text = "\n\n".join(p for p in pages_text if p.strip())
            if not text.strip():
                return "", "PDF processado mas sem texto extraível (provavelmente PDF escaneado/imagem, sem OCR configurado)."
            return text, ""
        except PdfReadError as exc:
            return "", f"Falha ao ler o PDF: {exc}"

    if ext in ("txt", "md"):
        try:
            return uploaded_file.read().decode("utf-8"), ""
        except UnicodeDecodeError:
            return "", "Arquivo de texto não está em UTF-8 — não foi possível decodificar."

    return (
        f"[Arquivo anexado sem extração automática de texto: {name}]",
        f"Tipo '.{ext}' não tem extração automática ainda (só PDF/.txt/.md) — arquivo registrado, mas não pesquisável pelo RAG.",
    )


class DocumentFileUploadView(TenantContextMixin, APIView):
    """
    Upload de arquivo de verdade (PDF/imagem/documento) pra virar
    conhecimento de um setor — diferente de DocumentUploadView (que
    recebe texto já pronto). Reaproveita 100% do pipeline de indexação
    já testado (`process_document_task` → `index_document`), só muda
    de onde o texto vem.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)

        serializer = DocumentFileUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        uploaded_file = data["file"]

        try:
            source = KnowledgeSource.objects.get(id=data["source_id"], tenant_id=request.tenant_id)
        except KnowledgeSource.DoesNotExist:
            return Response({"detail": "source_id inválido para este tenant."}, status=status.HTTP_404_NOT_FOUND)

        content, warning = _extract_text_from_upload(uploaded_file)

        document = Document.objects.create(
            tenant_id=request.tenant_id,
            source=source,
            external_id=f"upload:{uploaded_file.name}:{timezone.now().timestamp()}",
            title=uploaded_file.name,
            content=content,
            metadata={"uploaded_filename": uploaded_file.name, "extraction_warning": warning},
            status=Document.Status.PENDING if content.strip() else Document.Status.ERROR,
        )
        if not content.strip():
            document.error_message = warning or "Sem conteúdo extraído."
            document.save(update_fields=["error_message"])
        else:
            process_document_task.delay(document.id)

        response_data = DocumentSerializer(document).data
        response_data["extraction_warning"] = warning
        return Response(response_data, status=status.HTTP_202_ACCEPTED)


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

        source_ids = data.get("source_ids") or None
        try:
            chunks = semantic_search(
                data["query"], tenant_id=request.tenant_id, top_k=data["top_k"],
                source_ids=source_ids,
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

class KnowledgeGraphView(TenantContextMixin, APIView):
    """
    Grafo das notas indexadas do tenant (o "Cérebro" do Escritório 3D):
    nós = Documents, arestas = `[[wikilinks]]` do Obsidian resolvidos.

    GET /api/v1/ingestion/graph/?source=<id>   (source opcional)

    Nunca devolve o conteúdo inteiro — só um trecho curto por nota
    (`excerpt`) pra prévia. Documento/fonte apagados (soft delete) ficam de
    fora. Limite de GRAPH_MAX_NODES notas (as mais recentes), com
    `truncated=true` quando cortou.
    """

    permission_classes = [IsAuthenticated]
    GRAPH_MAX_NODES = 2000

    def get(self, request):
        from ingestion.graph import build_knowledge_graph

        tenant_id = getattr(request, "tenant_id", None)
        if not tenant_id:
            return Response({"nodes": [], "edges": [], "unresolved": 0, "truncated": False})

        qs = Document.objects.filter(
            tenant_id=tenant_id, is_active=True, source__is_active=True,
        ).only(
            "id", "source_id", "title", "external_id", "content", "metadata",
            "status", "updated_at",
        ).order_by("-updated_at")

        source_id = request.query_params.get("source")
        if source_id:
            if not source_id.isdigit():
                return Response(
                    {"detail": "source deve ser um id numérico."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            qs = qs.filter(source_id=int(source_id))

        docs = list(qs[: self.GRAPH_MAX_NODES + 1])
        truncated = len(docs) > self.GRAPH_MAX_NODES
        graph = build_knowledge_graph(docs[: self.GRAPH_MAX_NODES])
        graph["truncated"] = truncated
        return Response(graph)
