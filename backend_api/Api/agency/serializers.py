# backend_api/Api/agency/serializers.py
from rest_framework import serializers

from agency.models import Sector, Agent, SectorMessage, Project, PendingApproval, PolicyRule, Task, TaskSnapshot


class SectorSerializer(serializers.ModelSerializer):
    agents_count = serializers.IntegerField(source="agents.count", read_only=True)

    class Meta:
        model = Sector
        fields = [
            "id", "name", "slug", "description", "monthly_budget_usd",
            "knowledge_source", "agents_count", "created_at",
        ]
        read_only_fields = ["id", "slug", "agents_count", "created_at"]


class AgentSerializer(serializers.ModelSerializer):
    sector_name = serializers.CharField(source="sector.name", read_only=True, default=None)
    # Anotado no queryset da view (Max("interactions__created_at")), não é
    # campo do model — complementa `work_status`: como `ask_as_agent` é
    # síncrono, o agente só fica "working" pela duração da chamada em si
    # (pode ser rápido demais para um painel com polling pegar). Isso dá
    # visibilidade de "trabalhou por último quando" mesmo perdendo o
    # instante exato em que esteve `working`.
    last_active_at = serializers.DateTimeField(read_only=True, default=None)

    class Meta:
        model = Agent
        fields = [
            "id", "sector", "sector_name", "name", "role", "access_level",
            "work_status", "current_task", "backlog_tasks", "last_active_at",
            "default_provider", "default_model", "created_at",
        ]
        read_only_fields = [
            "id", "sector_name", "work_status", "current_task",
            "backlog_tasks", "last_active_at", "created_at",
        ]

    def validate(self, attrs):
        access_level = attrs.get("access_level", getattr(self.instance, "access_level", Agent.AccessLevel.OPERATIONAL))
        sector = attrs.get("sector", getattr(self.instance, "sector", None))
        full_access = access_level in (Agent.AccessLevel.GENERAL_ORCHESTRATOR, Agent.AccessLevel.CEO)

        if full_access and sector is not None:
            raise serializers.ValidationError(
                "CEO e Orquestrador-Geral não pertencem a um setor específico (sector deve ser nulo)."
            )
        if not full_access and sector is None:
            raise serializers.ValidationError(
                "Agentes operacionais e orquestradores de setor precisam de um sector."
            )
        return attrs


class AskAsAgentSerializer(serializers.Serializer):
    question = serializers.CharField(max_length=2000)
    use_rag_context = serializers.BooleanField(required=False, default=True)

    def validate_question(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("question não pode ser vazio.")
        return value


class SectorMessageSerializer(serializers.ModelSerializer):
    from_agent_name = serializers.CharField(source="from_agent.name", read_only=True)
    to_sector_name = serializers.CharField(source="to_sector.name", read_only=True)
    relayed_by_name = serializers.CharField(source="relayed_by.name", read_only=True, default=None)

    class Meta:
        model = SectorMessage
        fields = [
            "id", "from_agent", "from_agent_name", "to_sector", "to_sector_name",
            "relayed_by", "relayed_by_name", "content", "response",
            "status", "rejection_reason", "created_at", "answered_at",
        ]
        read_only_fields = [
            "id", "from_agent_name", "to_sector_name", "relayed_by", "relayed_by_name",
            "response", "status", "rejection_reason", "created_at", "answered_at",
        ]


class RequestCrossSectorSerializer(serializers.Serializer):
    from_agent_id = serializers.IntegerField()
    to_sector_id = serializers.IntegerField()
    content = serializers.CharField(max_length=2000)

    def validate_content(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("content não pode ser vazio.")
        return value


class RelayMessageSerializer(serializers.Serializer):
    relaying_agent_id = serializers.IntegerField()
    answering_agent_id = serializers.IntegerField(required=False)


class ProjectSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.CharField(source="requested_by.name", read_only=True, default=None)

    class Meta:
        model = Project
        fields = [
            "id", "name", "description", "requested_by", "requested_by_name",
            "status", "github_repo_url", "github_full_name", "error_message", "created_at",
        ]
        read_only_fields = [
            "id", "requested_by_name", "status", "github_repo_url",
            "github_full_name", "error_message", "created_at",
        ]


class CreateProjectSerializer(serializers.Serializer):
    requesting_agent_id = serializers.IntegerField()
    name = serializers.CharField(max_length=100)
    description = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    private = serializers.BooleanField(required=False, default=True)

    def validate_name(self, value):
        import re

        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("name não pode ser vazio.")
        if not re.match(r"^[a-zA-Z0-9._-]+$", value):
            raise serializers.ValidationError(
                "name só pode conter letras, números, ponto, hífen e underscore (vira o nome do repositório GitHub)."
            )
        return value


class PolicyRuleSerializer(serializers.ModelSerializer):
    sector_name = serializers.CharField(source="sector.name", read_only=True, default=None)

    class Meta:
        model = PolicyRule
        fields = ["id", "sector", "sector_name", "risk", "min_autonomy_level", "description", "is_active", "created_at"]
        read_only_fields = ["id", "sector_name", "created_at"]


class PendingApprovalSerializer(serializers.ModelSerializer):
    agent_name = serializers.CharField(source="agent.name", read_only=True)
    decided_by_email = serializers.CharField(source="decided_by.email", read_only=True, default=None)

    class Meta:
        model = PendingApproval
        fields = [
            "id", "agent", "agent_name", "function_name", "params", "risk", "reason",
            "status", "result", "decided_by", "decided_by_email", "created_at", "decided_at",
        ]
        read_only_fields = fields


class DecidePendingApprovalSerializer(serializers.Serializer):
    approved = serializers.BooleanField()


class TaskSnapshotSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskSnapshot
        fields = ["id", "version", "context", "created_at"]
        read_only_fields = fields


class TaskSerializer(serializers.ModelSerializer):
    agent_name = serializers.CharField(source="agent.name", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    snapshots = TaskSnapshotSerializer(many=True, read_only=True)

    class Meta:
        model = Task
        fields = [
            "id", "agent", "agent_name", "project", "project_name", "brief", "status",
            "progress", "current_files", "result", "version", "task_type", "snapshots", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "status", "result", "version", "snapshots", "created_at", "updated_at"]


class CreateTaskSerializer(serializers.Serializer):
    agent_id = serializers.IntegerField()
    project_id = serializers.IntegerField(required=False, allow_null=True)
    brief = serializers.CharField(max_length=4000)
    task_type = serializers.CharField(max_length=50, required=False, allow_blank=True, default="")


class InterruptTaskSerializer(serializers.Serializer):
    instructions = serializers.CharField(max_length=2000)


class AdaptTaskSerializer(serializers.Serializer):
    new_brief = serializers.CharField(max_length=4000)


class ApproveTaskSerializer(serializers.Serializer):
    files = serializers.DictField(child=serializers.CharField(), required=False, default=dict)
    trigger_git = serializers.BooleanField(required=False, default=True)


class RejectTaskSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")