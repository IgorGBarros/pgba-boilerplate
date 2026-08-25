# backend_api/Api/agency/admin.py
from django.contrib import admin

from agency.models import Sector, Agent, AgentInteraction, SectorMessage, Project


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
