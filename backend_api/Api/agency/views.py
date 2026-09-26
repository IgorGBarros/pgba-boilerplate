# backend_api/Api/agency/views.py
from django.db.models import Count, Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from datetime import timedelta

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.mixins import TenantContextMixin
from agency.models import Sector, Agent, SectorMessage, Project, PendingApproval, PolicyRule, Task
from agency.serializers import (
    SectorSerializer, AgentSerializer, AskAsAgentSerializer,
    SectorMessageSerializer, RequestCrossSectorSerializer, RelayMessageSerializer,
    ProjectSerializer, CreateProjectSerializer, ImportProjectSerializer,
    PolicyRuleSerializer, PendingApprovalSerializer, DecidePendingApprovalSerializer,
    TaskSerializer, CreateTaskSerializer, InterruptTaskSerializer, AdaptTaskSerializer, ReportTaskResultSerializer,
    ApproveTaskSerializer, RejectTaskSerializer,
)
from agency.tasks import (
    create_task, interrupt_task, adapt_and_resume, approve_task, reject_task, report_task_result,
    start_external_task, TaskStateError,
)
from agency.services import (
    ask_as_agent,
    request_cross_sector_message,
    relay_message,
    create_project,
    import_project,
    decide_pending_approval,
    AccessDeniedError,
    get_overview,
    get_sector_metrics,
    get_agent_metrics,
    get_budget_status,
    knowledge_usage,
    knowledge_usage_summary,
    sector_ai_status,
    company_timeline,
    resolve_agent_llm,
)


class TenantScopedMixin:
    def get_queryset(self):
        tenant_id = getattr(self.request, "tenant_id", None)
        if not tenant_id:
            return self.queryset.none()
        return self.queryset.filter(tenant_id=tenant_id)

    def perform_create(self, serializer):
        serializer.save(tenant_id=self.request.tenant_id)


class SectorViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Sector.objects.all()
    serializer_class = SectorSerializer
    permission_classes = [IsAuthenticated]


class AgentViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Agent.objects.all()
    serializer_class = AgentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        from django.db.models import Max

        qs = super().get_queryset().annotate(last_active_at=Max("interactions__created_at"))
        sector_id = self.request.query_params.get("sector")
        if sector_id:
            qs = qs.filter(sector_id=sector_id)
        return qs

    @action(detail=True, methods=["post"])
    def ask(self, request, pk=None):
        """POST /api/v1/agency/agents/{id}/ask/ — pergunta via este agente."""
        agent = self.get_object()
        serializer = AskAsAgentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        result = ask_as_agent(
            tenant_id=request.tenant_id,
            agent_id=agent.id,
            question=data["question"],
            use_rag_context=data["use_rag_context"],
        )
        # Resultados que são respostas válidas (não falhas técnicas):
        #   "ok"               — respondeu normalmente
        #   "pending_approval" — Policy Engine bloqueou e criou PendingApproval
        #   "rejected"         — guardrail de grounding recusou (sem dados suficientes);
        #                        é uma resposta correta do sistema, não uma falha técnica
        # Falhas técnicas (upstream indisponível, parse error) → 502:
        #   "llm_error", "function_error"
        is_success = result["status"] in ("ok", "pending_approval", "rejected")
        http_status = status.HTTP_200_OK if is_success else status.HTTP_502_BAD_GATEWAY
        return Response(result, status=http_status)

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        """POST /api/v1/agency/agents/{id}/pause/ — pausa e preserva a tarefa no backlog."""
        agent = self.get_object()
        agent.pause()
        return Response(AgentSerializer(agent).data)


class SectorMessageViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    """
    Comunicação entre setores — sempre mediada. Um setor nunca fala com
    outro diretamente: cria um pedido aqui (`request/`) e um orquestrador
    (ou CEO) encaminha (`relay/`).
    """

    queryset = SectorMessage.objects.all()
    serializer_class = SectorMessageSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    @action(detail=False, methods=["post"], url_path="request")
    def request_message(self, request):
        """POST /api/v1/agency/sector-messages/request/ — pede envio para outro setor (fica pendente)."""
        serializer = RequestCrossSectorSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            message = request_cross_sector_message(
                tenant_id=request.tenant_id,
                from_agent_id=data["from_agent_id"],
                to_sector_id=data["to_sector_id"],
                content=data["content"],
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)

        return Response(SectorMessageSerializer(message).data, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=["post"])
    def relay(self, request, pk=None):
        """
        POST /api/v1/agency/sector-messages/{id}/relay/ — um orquestrador
        (ou CEO) encaminha a mensagem pendente. Rejeita com 403 se o
        agente que está tentando mediar não tiver permissão para isso.
        """
        serializer = RelayMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            message = relay_message(
                tenant_id=request.tenant_id,
                relaying_agent_id=data["relaying_agent_id"],
                message_id=int(pk),
                answering_agent_id=data.get("answering_agent_id"),
            )
        except AccessDeniedError as exc:
            return Response({"detail": str(exc)}, status=403)
        except (Agent.DoesNotExist, SectorMessage.DoesNotExist):
            return Response({"detail": "Agente ou mensagem não encontrados para este tenant."}, status=404)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)

        return Response(SectorMessageSerializer(message).data)


class ProjectViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    """
    Projetos comerciais simples criados a pedido (setor de
    Desenvolvimento). Leitura + delete + a action `create_project/` —
    não dá para editar um projeto depois de criado por aqui, só
    consultar o status, o link do repositório, ou remover.
    """

    queryset = Project.objects.all()
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        tenant_id = getattr(self.request, "tenant_id", None)
        if not tenant_id:
            return Project.objects.none()
        # Exclui soft-deleted e projetos que falharam — só mostra ready/pending
        return Project.objects.filter(
            tenant_id=tenant_id,
            is_active=True,
        ).exclude(status="failed")

    @action(detail=False, methods=["post"], url_path="create")
    def create_project_action(self, request):
        """
        POST /api/v1/agency/projects/create/
        {
          "requesting_agent_id": 1,
          "name": "loja-do-cliente-x",
          "description": "Landing page + checkout simples",
          "private": true
        }

        Cria o repositório GitHub e envia o template `simple-commercial`
        (React+Vite+TS, pronto para Vercel+Supabase). Sempre retorna
        `201` com o `Project` — mesmo em caso de falha na integração, o
        status vem como `failed` com `error_message` preenchido, nunca
        um 500 cru (ver `agency.services.create_project`).
        """
        serializer = CreateProjectSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        project = create_project(
            tenant_id=request.tenant_id,
            requesting_agent_id=data["requesting_agent_id"],
            name=data["name"],
            description=data.get("description", ""),
            private=data.get("private", True),
            workspace=data.get("workspace", ""),
        )
        return Response(ProjectSerializer(project).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="import")
    def import_project_action(self, request):
        """
        POST /api/v1/agency/projects/import/
        {
          "requesting_agent_id": 1,
          "name": "projeto-que-ja-existia",
          "github_full_name": "SeuUsuario/repo-que-ja-existe",
          "description": "opcional"
        }

        Registra um projeto QUE JÁ EXISTIA — nunca cria repositório
        novo, nunca envia template. Confirma que o repositório é
        acessível de verdade antes de marcar como pronto (ver
        `agency.services.import_project`). Mesmo contrato de resposta
        do `create/`: sempre 201, `status=failed` com `error_message`
        em vez de erro cru se o repositório não for encontrado.
        """
        serializer = ImportProjectSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        project = import_project(
            tenant_id=request.tenant_id,
            requesting_agent_id=data["requesting_agent_id"],
            name=data["name"],
            github_full_name=data["github_full_name"],
            description=data.get("description", ""),
            workspace=data.get("workspace", ""),
            local_path=data.get("local_path", ""),
        )
        return Response(ProjectSerializer(project).data, status=status.HTTP_201_CREATED)


class PolicyRuleViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    """CRUD das regras de política (§13 do documento — configurável, nunca hardcoded)."""

    queryset = PolicyRule.objects.all()
    serializer_class = PolicyRuleSerializer
    permission_classes = [IsAuthenticated]


class PendingApprovalViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    """
    Fila de aprovação humana (§12 — human-in-the-loop). Só leitura + a
    action `decide/` — não dá pra editar uma aprovação já registrada,
    só consultar e decidir uma vez (ver agency.services.decide_pending_approval).
    """

    queryset = PendingApproval.objects.all()
    serializer_class = PendingApprovalSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        """POST /api/v1/agency/pending-approvals/{id}/decide/ — {"approved": true|false}"""
        pending = self.get_object()
        serializer = DecidePendingApprovalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            decided = decide_pending_approval(
                tenant_id=request.tenant_id, pending_id=pending.id,
                approved=serializer.validated_data["approved"], decided_by=request.user,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        return Response(PendingApprovalSerializer(decided).data)


class TaskViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    """
    Ciclo de vida de Task (ver agency/tasks.py) — complementar ao
    PendingApproval: aquele bloqueia ANTES de executar, este intervém
    DURANTE/DEPOIS (interromper, adaptar com nova instrução, aprovar
    disparando PR real no GitHub, ou rejeitar).
    """

    queryset = Task.objects.select_related("agent", "project").prefetch_related("snapshots").all()
    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        status_filter = self.request.query_params.get("status")
        agent_filter = self.request.query_params.get("agent")
        if status_filter:
            qs = qs.filter(status=status_filter)
        if agent_filter:
            qs = qs.filter(agent_id=agent_filter)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = CreateTaskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = create_task(tenant_id=request.tenant_id, **serializer.validated_data)
        return Response(TaskSerializer(task).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def execute(self, request, pk=None):
        """
        POST tasks/{id}/execute/ — enfileira a execução no Celery e retorna 202.
        O resultado chega ao frontend via WebSocket (agency.realtime) quando
        a task termina. O status inicial (IN_PROGRESS) é retornado imediatamente
        para que o Kanban atualize localmente sem esperar o LLM terminar.
        """
        from agency.celery_tasks import execute_task_async

        task = self.get_object()
        if task.status not in ("created", "adapted"):
            return Response(
                {"detail": f"Task não pode ser executada no status '{task.status}'."},
                status=status.HTTP_409_CONFLICT,
            )

        execute_task_async.delay(request.tenant_id, task.id)
        # Retorna a task como está (status ainda created/adapted) —
        # o WebSocket vai atualizar o frontend quando o worker mudar o status.
        return Response(TaskSerializer(task).data, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=["post"], url_path="start-external")
    def start_external(self, request, pk=None):
        """
        POST tasks/{id}/start-external/ — o trabalho vai rodar FORA do Django
        (ex: geração de página no devserver). Marca IN_PROGRESS + agente
        trabalhando e devolve qual IA o agente usa (`ai_provider`/`ai_model`,
        mesma regra de `resolve_agent_llm`) pra quem vai gerar usar a mesma.
        Fecha com `report-result/`.
        """
        task = self.get_object()
        try:
            updated = start_external_task(request.tenant_id, task.id)
        except TaskStateError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        provider, model = resolve_agent_llm(updated.agent)
        data = TaskSerializer(updated).data
        return Response({**data, "ai_provider": provider, "ai_model": model or ""})

    @action(detail=True, methods=["post"], url_path="report-result")
    def report_result(self, request, pk=None):
        """
        POST tasks/{id}/report-result/ — {"success": bool, "result": {...}, "current_files": [...]}

        Pra trabalho que aconteceu FORA do Django (hoje: geracao de
        pagina via generator.mjs no devserver, que roda typecheck/lint
        de verdade em Node — o backend Python nao tem como fazer isso).
        Nunca chama modelo nenhum aqui, so registra o que ja aconteceu.
        """
        task = self.get_object()
        serializer = ReportTaskResultSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            updated = report_task_result(
                request.tenant_id, task.id, data["success"], data["result"], data.get("current_files"),
                usage=data.get("usage"),
            )
        except TaskStateError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(TaskSerializer(updated).data)

    @action(detail=True, methods=["post"])
    def interrupt(self, request, pk=None):
        """POST tasks/{id}/interrupt/ — {"instructions": "..."}"""
        task = self.get_object()
        serializer = InterruptTaskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            updated = interrupt_task(request.tenant_id, task.id, serializer.validated_data["instructions"])
        except TaskStateError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(TaskSerializer(updated).data)

    @action(detail=True, methods=["post"])
    def adapt(self, request, pk=None):
        """POST tasks/{id}/adapt/ — {"new_brief": "..."}"""
        task = self.get_object()
        serializer = AdaptTaskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            updated = adapt_and_resume(request.tenant_id, task.id, serializer.validated_data["new_brief"])
        except TaskStateError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(TaskSerializer(updated).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        """POST tasks/{id}/approve/ — {"files": {"path": "conteúdo"}, "trigger_git": true}"""
        task = self.get_object()
        serializer = ApproveTaskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = approve_task(request.tenant_id, task.id, **serializer.validated_data)
        except TaskStateError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response({**TaskSerializer(result["task"]).data, "pr_url": result["pr_url"]})

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        """POST tasks/{id}/reject/ — {"reason": "..."} (opcional)"""
        task = self.get_object()
        serializer = RejectTaskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            updated = reject_task(request.tenant_id, task.id, **serializer.validated_data)
        except TaskStateError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(TaskSerializer(updated).data)


class MetricsOverviewView(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)
        return Response(get_overview(request.tenant_id))


class MetricsSectorsView(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)
        return Response(get_sector_metrics(request.tenant_id))


class MetricsAgentsView(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)
        sector_id = request.query_params.get("sector")
        return Response(get_agent_metrics(request.tenant_id, sector_id=sector_id))


class MetricsBudgetsView(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)
        return Response(get_budget_status(request.tenant_id))


class WSTicketView(APIView):
    """
    POST /api/v1/agency/ws-ticket/

    Emite um ticket de uso único (UUID, TTL 15s) para abertura do WebSocket.
    O cliente usa ?ticket=<uuid> na URL do WS em vez do JWT, evitando que o
    token de acesso apareça em logs de reverse proxy.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from agency.ws_ticket import issue_ticket
        ticket = issue_ticket(request.user.id)
        return Response({"ticket": ticket})

class KnowledgeUsageView(TenantContextMixin, APIView):
    """
    GET /api/v1/agency/knowledge-usage/?document=<id> — quais agentes usaram
    uma nota (ingestion.Document) como contexto de resposta, com contagem e
    última vez. Alimenta "Consultada por" no Cérebro do Escritório 3D.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)
        document = request.query_params.get("document", "")
        if not document.isdigit():
            return Response({"detail": "Informe ?document=<id numérico>."}, status=400)
        return Response(knowledge_usage(request.tenant_id, int(document)))


class KnowledgeUsageSummaryView(TenantContextMixin, APIView):
    """
    GET /api/v1/agency/knowledge-usage/summary/[?days=30] — quantas vezes
    cada nota foi usada como contexto (todas de uma vez), pro mapa de calor
    do Cérebro. `{"documents": {"<id>": {"count": n, "last_at": ...}}}`.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)
        days = request.query_params.get("days", "")
        since = None
        if days:
            if not days.isdigit() or int(days) < 1:
                return Response({"detail": "?days deve ser um inteiro positivo."}, status=400)
            since = timezone.now() - timedelta(days=int(days))
        usage = knowledge_usage_summary(request.tenant_id, since=since)
        return Response({"documents": {str(k): v for k, v in usage.items()}})


class AIStatusView(TenantContextMixin, APIView):
    """
    GET /api/v1/agency/ai-status/ — qual IA cada setor usa e se está pronta
    (credencial + modelo). Não chama provedor nenhum — ver
    `agency.services.sector_ai_status`.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)
        return Response(sector_ai_status(request.tenant_id))


TIMELINE_MAX_WINDOW = timedelta(days=7)


def _window(request):
    """(since, until) do corpo ou da query (ISO 8601) — padrão: 0h de hoje até agora; máx 7 dias."""
    def param(name):
        return request.data.get(name) or request.query_params.get(name)

    now = timezone.now()
    midnight = timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)
    until = _parse_when(param("until")) or now
    since = _parse_when(param("since")) or midnight
    if since >= until:
        raise ValueError("`since` precisa ser antes de `until`.")
    if until - since > TIMELINE_MAX_WINDOW:
        raise ValueError("Janela máxima: 7 dias.")
    return since, until


class DailySummaryView(TenantContextMixin, APIView):
    """
    POST /api/v1/agency/daily-summary/ {"since"?, "until"?} — o CEO resume o
    período (padrão: hoje) só com fatos registrados, citando cada um [E#].
    POST /api/v1/agency/daily-summary/save/ {"markdown", "facts"?, "day"?} —
    guarda como nota do Cérebro (fonte "Resumos do dia (CEO)").
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, action=None):
        from agency.summary import daily_summary, save_summary_to_brain
        from harness.providers import ProviderConfigError

        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)

        if action == "save":
            markdown = str(request.data.get("markdown") or "").strip()
            if not markdown:
                return Response({"detail": "Informe o `markdown` do resumo."}, status=400)
            if len(markdown) > 20_000:
                return Response(
                    {"detail": "Resumo grande demais (máx 20 mil caracteres)."}, status=400,
                )
            try:
                day = _parse_when(request.data.get("day")) or timezone.now()
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=400)
            facts = request.data.get("facts")
            facts = facts if isinstance(facts, list) else None
            saved = save_summary_to_brain(
                request.tenant_id, timezone.localtime(day), markdown, facts,
            )
            return Response(saved, status=201)

        try:
            since, until = _window(request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        try:
            return Response(daily_summary(request.tenant_id, since, until))
        except ProviderConfigError as exc:
            return Response({"detail": f"A IA do CEO não respondeu: {exc}"}, status=502)


class TimelineView(TenantContextMixin, APIView):
    """
    GET /api/v1/agency/timeline/?since=<ISO>&until=<ISO> — eventos da empresa
    em ordem (padrão: de 0h de hoje até agora; janela máxima de 7 dias).
    Alimenta o replay do dia no Escritório 3D.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)
        now = timezone.now()
        try:
            until = _parse_when(request.query_params.get("until")) or now
            midnight = timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)
            since = _parse_when(request.query_params.get("since")) or midnight
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        if since >= until:
            return Response({"detail": "`since` precisa ser antes de `until`."}, status=400)
        if until - since > TIMELINE_MAX_WINDOW:
            return Response({"detail": "Janela máxima da linha do tempo: 7 dias."}, status=400)
        return Response(company_timeline(request.tenant_id, since, until))


def _parse_when(raw: str | None):
    if not raw:
        return None
    value = parse_datetime(raw)
    if value is None:
        raise ValueError(f"Data inválida: '{raw}' (use ISO 8601).")
    if timezone.is_naive(value):
        value = timezone.make_aware(value)
    return value


class SourceAccessView(TenantContextMixin, APIView):
    """
    Quem pode consultar uma fonte (conector): GET ?source=<id>. Mesma regra de
    services._rag_scope_for — CEO/Orquestrador-Geral veem tudo; os demais, as
    fontes do próprio setor (principal + adicionais). Fica em `agency` porque
    `ingestion` não sabe o que é setor.

    POST {"source": id, "sectors": [ids]} define em quais setores a fonte
    entra como ADICIONAL (o cérebro principal do setor não muda por aqui).
    """

    permission_classes = [IsAuthenticated]

    def _source(self, request, source_id):
        from ingestion.models import KnowledgeSource

        return KnowledgeSource.objects.filter(
            id=source_id, tenant_id=request.tenant_id, is_active=True
        ).first()

    def _payload(self, request, source):
        sectors = Sector.objects.filter(tenant_id=request.tenant_id, is_active=True).annotate(
            n_agents=Count("agents", filter=Q(agents__is_active=True))
        ).prefetch_related("extra_knowledge_sources").order_by("name")
        rows = []
        for sector in sectors:
            principal = sector.knowledge_source_id == source.id
            extra = any(s.id == source.id for s in sector.extra_knowledge_sources.all())
            rows.append({
                "id": sector.id, "name": sector.name, "agents": sector.n_agents,
                "access": "principal" if principal else "adicional" if extra else None,
            })
        full = Agent.objects.filter(
            tenant_id=request.tenant_id, is_active=True,
            access_level__in=[Agent.AccessLevel.CEO, Agent.AccessLevel.GENERAL_ORCHESTRATOR],
        ).values_list("name", flat=True)
        return {"source": source.id, "full_access": list(full), "sectors": rows}

    def get(self, request):
        source = self._source(request, request.query_params.get("source"))
        if source is None:
            return Response({"detail": "Fonte não encontrada."}, status=status.HTTP_404_NOT_FOUND)
        return Response(self._payload(request, source))

    def post(self, request):
        source = self._source(request, request.data.get("source"))
        if source is None:
            return Response({"detail": "Fonte não encontrada."}, status=status.HTTP_404_NOT_FOUND)
        wanted = {int(i) for i in request.data.get("sectors") or [] if str(i).isdigit()}
        for sector in Sector.objects.filter(tenant_id=request.tenant_id, is_active=True):
            if sector.id in wanted and sector.knowledge_source_id != source.id:
                sector.extra_knowledge_sources.add(source)
            elif sector.id not in wanted:
                sector.extra_knowledge_sources.remove(source)
        return Response(self._payload(request, source))
