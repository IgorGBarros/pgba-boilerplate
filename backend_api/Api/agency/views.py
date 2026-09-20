# backend_api/Api/agency/views.py
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

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
    create_task, interrupt_task, adapt_and_resume, approve_task, reject_task, report_task_result, TaskStateError,
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
        # "pending_approval" é um resultado NORMAL (o Policy Engine
        # funcionou como deveria — bloqueou e criou a PendingApproval),
        # não uma falha técnica. Só function_error/llm_error/rejected são
        # de fato erro (o modelo/execução falhou).
        is_success = result["status"] in ("ok", "pending_approval")
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