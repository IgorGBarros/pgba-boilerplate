# backend_api/Api/agency/admin.py
from django.contrib import admin

from agency.models import Sector, Agent, AgentInteraction, SectorMessage, Project, PolicyRule, PendingApproval, Task, TaskSnapshot


@admin.register(Sector)
class SectorAdmin(admin.ModelAdmin):
    list_display = ("name", "tenant_id", "knowledge_source", "monthly_budget_usd", "is_active")
    search_fields = ("name",)


@admin.register(Agent)
class AgentAdmin(admin.ModelAdmin):
    list_display = ("name", "role", "access_level", "sector", "work_status", "tenant_id")
    list_filter = ("access_level", "work_status", "sector")
    search_fields = ("name", "role")


@admin.register(AgentInteraction)
class AgentInteractionAdmin(admin.ModelAdmin):
    list_display = ("agent", "tokens_used", "estimated_cost_usd", "created_at")
    list_filter = ("agent__sector",)
    readonly_fields = ("agent", "question", "answer", "tokens_used", "estimated_cost_usd", "query_log_id", "created_at")

    def has_add_permission(self, request):
        return False


@admin.register(SectorMessage)
class SectorMessageAdmin(admin.ModelAdmin):
    list_display = ("from_agent", "to_sector", "relayed_by", "status", "created_at")
    list_filter = ("status", "to_sector")
    readonly_fields = (
        "from_agent", "to_sector", "relayed_by", "content", "response",
        "status", "rejection_reason", "created_at", "answered_at",
    )

    def has_add_permission(self, request):
        return False


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "status", "requested_by", "github_repo_url", "tenant_id", "created_at")
    list_filter = ("status",)
    search_fields = ("name",)
    readonly_fields = ("status", "github_repo_url", "github_full_name", "error_message", "created_at")


@admin.register(PolicyRule)
class PolicyRuleAdmin(admin.ModelAdmin):
    list_display = ("risk", "min_autonomy_level", "sector", "is_active", "tenant_id")
    list_filter = ("risk", "is_active", "min_autonomy_level")


@admin.register(PendingApproval)
class PendingApprovalAdmin(admin.ModelAdmin):
    """
    Fila de aprovação humana pelo admin — útil pra quem ainda não integrou
    a UI de aprovação no frontend. Decidir por aqui chama o mesmo
    `agency.services.decide_pending_approval` usado pela API, nunca
    manipula `status`/`result` direto (isso quebraria a auditoria).
    """

    list_display = ("function_name", "agent", "risk", "status", "created_at", "decided_by")
    list_filter = ("status", "risk")
    readonly_fields = (
        "agent", "function_name", "params", "risk", "reason",
        "status", "result", "decided_by", "created_at", "decided_at",
    )
    actions = ["approve_selected", "reject_selected"]

    def has_add_permission(self, request):
        return False

    def _decide(self, request, queryset, approved: bool):
        from agency.services import decide_pending_approval

        decided, skipped = 0, 0
        for pending in queryset.filter(status=PendingApproval.Status.PENDING):
            try:
                decide_pending_approval(pending.tenant_id, pending.id, approved=approved, decided_by=request.user)
                decided += 1
            except ValueError:
                skipped += 1
        self.message_user(request, f"{decided} decidida(s), {skipped} já estavam decididas (ignoradas).")

    @admin.action(description="Aprovar selecionadas (executa a ação de verdade)")
    def approve_selected(self, request, queryset):
        self._decide(request, queryset, approved=True)

    @admin.action(description="Rejeitar selecionadas")
    def reject_selected(self, request, queryset):
        self._decide(request, queryset, approved=False)


class TaskSnapshotInline(admin.TabularInline):
    model = TaskSnapshot
    extra = 0
    readonly_fields = ("version", "context", "created_at")
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ("brief_short", "agent", "status", "version", "progress", "created_at")
    list_filter = ("status", "task_type")
    search_fields = ("brief",)
    inlines = [TaskSnapshotInline]

    def brief_short(self, obj):
        return obj.brief[:60]
    brief_short.short_description = "Tarefa"
