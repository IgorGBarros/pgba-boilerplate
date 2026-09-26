# backend_api/Api/ingestion/views.py
import hashlib
import hmac
import json
from types import SimpleNamespace

from django.db.models import Count, Q

from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser

from core.mixins import SoftDeleteViewMixin, TenantContextMixin
from ingestion.connectors import ConnectorError, get_connector, get_connector_class
from ingestion.models import Document, KnowledgeSource, SourceSyncRun
from ingestion.serializers import (
    KnowledgeSourceSerializer,
    DocumentSerializer,
    DocumentUploadSerializer,
    DocumentFileUploadSerializer,
    RAGQuerySerializer,
    SourceSyncRunSerializer,
)
from ingestion.sync import receive_webhook, sync_source
from ingestion.services import (
    semantic_search,
    build_context_prompt,
    generate_answer,
    EmbeddingError,
)
from ingestion.tasks import process_document_task, sync_source_task


class TenantScopedMixin:
    """Toda queryset deste app é obrigatoriamente filtrada por tenant."""

    def get_queryset(self):
        tenant_id = getattr(self.request, "tenant_id", None)
        if not tenant_id:
            return self.queryset.none()
        return self.queryset.filter(tenant_id=tenant_id)

    def perform_create(self, serializer):
        serializer.save(tenant_id=self.request.tenant_id)


class KnowledgeSourceViewSet(
    TenantContextMixin, SoftDeleteViewMixin, TenantScopedMixin, viewsets.ModelViewSet
):
    """
    Conectores. DELETE é exclusão lógica (a fonte e os documentos saem da busca
    dos agentes, o histórico fica). Ações: test-connection (chamada real),
    test-config (antes de salvar), sync, overview (painel) e run-query
    (prévia de uma consulta de banco/CRM).
    """

    queryset = KnowledgeSource.objects.annotate(
        active_documents=Count("documents", filter=Q(documents__is_active=True))
    )
    serializer_class = KnowledgeSourceSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=True, methods=["post"])
    def sync(self, request, pk=None):
        """Enfileira a sincronização (Celery); sem broker, roda aqui mesmo."""
        source = self.get_object()
        if source.source_type in (
            KnowledgeSource.SourceType.UPLOAD, KnowledgeSource.SourceType.MANUAL
        ):
            return Response(
                {"detail": "Esta fonte recebe arquivos por upload, não sincroniza."}, status=400
            )
        cls = get_connector_class(source.source_type)
        if cls is not None and cls.mode == "structured":
            return Response(
                {"detail": "Conector de consulta: nada a copiar — os agentes consultam na hora."},
                status=400,
            )
        try:
            sync_source_task.delay(source.id, SourceSyncRun.Trigger.MANUAL)
            return Response({"detail": "Sincronização enfileirada.", "queued": True}, status=202)
        except Exception:
            run = sync_source(source, trigger=SourceSyncRun.Trigger.MANUAL)
            return Response(
                {"detail": run.message, "queued": False, "run": SourceSyncRunSerializer(run).data}
            )

    def _test(self, source):
        if source.source_type == KnowledgeSource.SourceType.OBSIDIAN:
            path = (source.config or {}).get("vault_path") or ""
            from pathlib import Path

            if not path or not Path(path).is_dir():
                return Response(
                    {"ok": False, "message": "Pasta do vault não encontrada no servidor."},
                    status=400,
                )
            notes = sum(1 for _ in Path(path).rglob("*.md"))
            return Response({"ok": True, "message": f"Vault encontrado: {notes} nota(s)."})
        try:
            message = get_connector(source).test()
        except ConnectorError as exc:
            return Response({"ok": False, "message": str(exc)}, status=400)
        except Exception as exc:  # erro inesperado do conector nunca vira 500 mudo
            return Response({"ok": False, "message": f"Falha inesperada: {exc}"}, status=400)
        return Response({"ok": True, "message": message})

    @action(detail=True, methods=["post"], url_path="test-connection")
    def test_connection(self, request, pk=None):
        """Testa a conexão salva com uma chamada real e barata na fonte."""
        return self._test(self.get_object())

    @action(detail=False, methods=["post"], url_path="test-config")
    def test_config(self, request):
        """Testa uma configuração antes de salvar (segredos mascarados = os salvos)."""
        from ingestion.connectors.secrets import split_config

        source_type = request.data.get("source_type", "")
        config = request.data.get("config") or {}
        if source_type not in KnowledgeSource.SourceType.values or not isinstance(config, dict):
            return Response(
                {"ok": False, "message": "Tipo ou configuração inválidos."}, status=400
            )
        current = {}
        if request.data.get("id"):
            saved = self.get_queryset().filter(pk=request.data["id"]).first()
            if saved is not None:
                current = saved.full_config()
        public, secrets = split_config(source_type, config, current)
        transient = KnowledgeSource(
            tenant_id=request.tenant_id, name="teste", source_type=source_type, config=public
        )
        transient._plain_secrets = secrets
        return self._test(transient)

    @action(detail=True, methods=["get"])
    def overview(self, request, pk=None):
        """Painel "Dados do conector": o que veio, quando, erros e prévia."""
        source = self.get_object()
        docs = Document.objects.filter(source=source)
        by_status = dict(docs.filter(is_active=True).values_list("status").annotate(n=Count("id")))
        recent = docs.filter(is_active=True).order_by("-updated_at")[:8]
        runs = source.sync_runs.all()[:15]
        cls = get_connector_class(source.source_type)
        structured = cls is not None and cls.mode == "structured"
        consultas = ((source.config or {}).get("consultas") or []) if structured else []
        mcp_tools = None
        if source.source_type == KnowledgeSource.SourceType.MCP:
            from ingestion.connectors.mcp import McpConnector

            try:
                conn = McpConnector(source)
                consultas = conn.queries()
                liberadas = {t["nome"]: t["risco"] for t in conn.approved()}
                mcp_tools = [
                    {**t, "liberada": t["nome"] in liberadas, "risco": liberadas.get(t["nome"])}
                    for t in conn.available()
                ]
            except ConnectorError:
                consultas, mcp_tools = [], []
        return Response({
            "documents": {
                "active": sum(by_status.values()),
                "by_status": by_status,
                "removed": docs.filter(is_active=False).count(),
            },
            "recent_documents": [
                {
                    "id": d.id,
                    "title": d.title,
                    "status": d.status,
                    "updated_at": d.updated_at,
                    "excerpt": (d.metadata or {}).get("excerpt") or (d.content or "")[:280],
                    "error": d.error_message,
                }
                for d in recent
            ],
            "runs": SourceSyncRunSerializer(runs, many=True).data,
            "queries": consultas,
            "mcp_tools": mcp_tools,
        })

    def _mcp(self, request):
        from ingestion.connectors.mcp import McpConnector

        source = self.get_object()
        if source.source_type != KnowledgeSource.SourceType.MCP:
            return source, None
        return source, McpConnector(source)

    @action(detail=True, methods=["post"], url_path="mcp-discover")
    def mcp_discover(self, request, pk=None):
        """Lista as ferramentas do servidor MCP (chamada real) e guarda pra escolher."""
        source, conn = self._mcp(request)
        if conn is None:
            return Response({"detail": "Só conectores MCP."}, status=400)
        try:
            tools = conn.discover()
        except ConnectorError as exc:
            return Response({"detail": str(exc)}, status=400)
        source.config = {**(source.config or {}), "ferramentas_disponiveis": tools}
        source.save(update_fields=["config", "updated_at"])
        return Response({"tools": tools})

    @action(detail=True, methods=["post"], url_path="mcp-tools")
    def mcp_tools(self, request, pk=None):
        """Uma pessoa libera quais ferramentas os agentes podem usar (e o risco de cada)."""
        from ingestion.connectors.mcp import validate_tools

        source, conn = self._mcp(request)
        if conn is None:
            return Response({"detail": "Só conectores MCP."}, status=400)
        disponiveis = conn.available()
        nomes = {t["nome"] for t in disponiveis}
        try:
            ferramentas = validate_tools(request.data.get("ferramentas") or [], disponiveis)
        except ConnectorError as exc:
            return Response({"detail": str(exc)}, status=400)
        desconhecidas = [f["nome"] for f in ferramentas if f["nome"] not in nomes]
        if desconhecidas:
            return Response(
                {"detail": f"Ferramenta(s) que o servidor não oferece: {', '.join(desconhecidas)}."},
                status=400,
            )
        source.config = {**(source.config or {}), "ferramentas": ferramentas}
        source.save(update_fields=["config", "updated_at"])
        return Response({"ferramentas": ferramentas})

    @action(detail=True, methods=["post"], url_path="run-query")
    def run_query(self, request, pk=None):
        """Roda uma consulta cadastrada (prévia pra quem configura). Mesma trava da IA."""
        source = self.get_object()
        cls = get_connector_class(source.source_type)
        if cls is None or cls.mode != "structured":
            return Response({"detail": "Só conectores de banco/CRM têm consultas."}, status=400)
        params = request.data.get("params") or {}
        if not isinstance(params, dict):
            return Response({"detail": "params deve ser um objeto."}, status=400)
        try:
            return Response(cls(source).run(str(request.data.get("nome", "")), params))
        except ConnectorError as exc:
            return Response({"detail": str(exc)}, status=400)

    RECORDS_PAGE = 25

    @action(detail=True, methods=["get"])
    def records(self, request, pk=None):
        """Todos os registros que o conector trouxe (ativos), com busca e página."""
        source = self.get_object()
        docs = Document.objects.filter(source=source, is_active=True)
        search = (request.query_params.get("search") or "").strip()[:200]
        if search:
            docs = docs.filter(Q(title__icontains=search) | Q(content__icontains=search))
        total = docs.count()
        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except ValueError:
            page = 1
        start = (page - 1) * self.RECORDS_PAGE
        rows = docs.order_by("-updated_at")[start : start + self.RECORDS_PAGE]
        return Response(
            {
                "count": total,
                "page": page,
                "pages": max(1, -(-total // self.RECORDS_PAGE)),
                "results": [
                    {
                        "id": d.id,
                        "title": d.title,
                        "status": d.status,
                        "updated_at": d.updated_at,
                        "excerpt": (d.metadata or {}).get("excerpt") or (d.content or "")[:280],
                        "error": d.error_message,
                    }
                    for d in rows
                ],
            }
        )

    @action(detail=True, methods=["get"], url_path=r"records/(?P<doc_id>\d+)")
    def record(self, request, pk=None, doc_id=None):
        """Um registro inteiro, do jeito que os agentes leem (já com PII mascarada)."""
        source = self.get_object()
        doc = Document.objects.filter(source=source, is_active=True, pk=doc_id).first()
        if doc is None:
            return Response({"detail": "Registro não encontrado."}, status=404)
        meta = {k: v for k, v in (doc.metadata or {}).items() if k not in ("links", "excerpt")}
        return Response(
            {
                "id": doc.id,
                "external_id": doc.external_id,
                "title": doc.title,
                "status": doc.status,
                "error": doc.error_message,
                "content": doc.content,
                "metadata": meta,
                "chunks": doc.chunks.count(),
                "indexed_at": doc.indexed_at,
                "updated_at": doc.updated_at,
            }
        )

    @action(detail=True, methods=["post"], url_path="agent-preview")
    def agent_preview(self, request, pk=None):
        """
        "O que um agente encontra aqui?" — a MESMA busca semântica que o agente
        usa, restrita a este conector. Sem provedor de embeddings, cai numa
        busca por palavra e diz isso (nunca finge que foi a busca do agente).
        """
        source = self.get_object()
        question = str(request.data.get("question") or "").strip()[:500]
        if not question:
            return Response({"detail": "Escreva uma pergunta."}, status=400)
        try:
            chunks = semantic_search(
                question, tenant_id=request.tenant_id, top_k=5, source_ids=[source.id]
            )
            return Response(
                {
                    "mode": "semantica",
                    "notice": "",
                    "results": [
                        {
                            "document_id": c.document_id,
                            "title": c.document_title,
                            "excerpt": c.content[:600],
                            "score": round(max(0.0, 1 - c.distance), 3),
                        }
                        for c in chunks
                    ],
                }
            )
        except Exception as exc:  # embeddings fora do ar: prévia por palavra
            notice = (
                "A busca dos agentes não respondeu: o provedor de embeddings (EMBEDDING_PROVIDER, "
                "Ollama por padrão) está fora do ar ou sem configuração. Enquanto isso os agentes "
                "não encontram nada aqui; esta prévia usa busca por palavra. Detalhe: "
                f"{exc}"
            )[:500]
        words = [w for w in question.split() if len(w) >= 3][:8] or [question]
        cond = Q()
        for w in words:
            cond |= Q(title__icontains=w) | Q(content__icontains=w)
        docs = Document.objects.filter(source=source, is_active=True).filter(cond)[:50]
        scored = []
        for d in docs:
            text = f"{d.title}\n{d.content}".lower()
            hits = sum(1 for w in words if w.lower() in text)
            scored.append((hits / len(words), d))
        scored.sort(key=lambda t: t[0], reverse=True)
        return Response(
            {
                "mode": "texto",
                "notice": notice,
                "results": [
                    {
                        "document_id": d.id,
                        "title": d.title,
                        "excerpt": _snippet(d.content or "", words),
                        "score": round(score, 3),
                    }
                    for score, d in scored[:5]
                ],
            }
        )


def _snippet(text: str, words: list[str], size: int = 600) -> str:
    """Trecho em volta da primeira palavra encontrada (prévia por palavra)."""
    low = text.lower()
    pos = min((i for i in (low.find(w.lower()) for w in words) if i >= 0), default=0)
    start = max(0, pos - size // 3)
    return ("…" if start else "") + text[start : start + size]


class WebhookReceiveView(APIView):
    """
    POST /api/v1/ingestion/webhooks/<public_id>/ — sistemas externos mandam
    dados pra um conector do tipo webhook. Sem login (é máquina falando),
    então a prova é o segredo do conector: header `X-Webhook-Signature:
    sha256=<HMAC-SHA256 do corpo>` (preferido) ou `X-Webhook-Secret: <segredo>`.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "webhook"
    MAX_BODY = 1024 * 1024

    def post(self, request, public_id):
        source = KnowledgeSource.objects.filter(
            public_id=public_id, source_type=KnowledgeSource.SourceType.WEBHOOK, is_active=True
        ).first()
        if source is None:
            return Response({"detail": "Não encontrado."}, status=404)
        body = request.body
        if len(body) > self.MAX_BODY:
            return Response({"detail": "Corpo grande demais (1 MB)."}, status=413)
        secret = (source.full_config().get("secret") or "").encode()
        signature = request.headers.get("X-Webhook-Signature", "")
        plain = request.headers.get("X-Webhook-Secret", "")
        expected = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()
        valid = bool(secret) and (
            (signature and hmac.compare_digest(signature, expected))
            or (plain and hmac.compare_digest(plain.encode(), secret))
        )
        if not valid:
            return Response({"detail": "Assinatura inválida."}, status=401)
        try:
            payload = json.loads(body.decode() or "{}")
        except (ValueError, UnicodeDecodeError):
            payload = body.decode(errors="replace")
        try:
            document = receive_webhook(source, payload)
        except ConnectorError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"ok": True, "document_id": document.id}, status=202)


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

        # Sem `content`: links e trecho já vêm em metadata (index_document).
        qs = Document.objects.filter(
            tenant_id=tenant_id, is_active=True, source__is_active=True,
        ).only(
            "id", "source_id", "title", "external_id", "metadata", "status", "updated_at",
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
        docs = docs[: self.GRAPH_MAX_NODES]

        # Notas indexadas antes de existir metadata["links"]: busca o conteúdo
        # SÓ delas, numa query (nunca uma por nota, nem o vault inteiro).
        legacy = [d.id for d in docs if not {"links", "excerpt"} <= set((d.metadata or {}).keys())]
        content_by_id = dict(
            Document.objects.filter(tenant_id=tenant_id, id__in=legacy).values_list("id", "content")
        ) if legacy else {}
        nodes = [
            SimpleNamespace(
                id=d.id, source_id=d.source_id, title=d.title, external_id=d.external_id,
                metadata=d.metadata, status=d.status, updated_at=d.updated_at,
                content=content_by_id.get(d.id, ""),
            )
            for d in docs
        ]
        graph = build_knowledge_graph(nodes)
        graph["truncated"] = truncated
        return Response(graph)
