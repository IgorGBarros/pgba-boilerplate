# backend_api/Api/agency/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from agency.views import (
    SectorViewSet,
    AgentViewSet,
    SectorMessageViewSet,
    ProjectViewSet,
    PolicyRuleViewSet,
    PendingApprovalViewSet,
    TaskViewSet,
    MetricsOverviewView,
    MetricsSectorsView,
    MetricsAgentsView,
    MetricsBudgetsView,
    WSTicketView,
    KnowledgeUsageView,
    KnowledgeUsageSummaryView,
    AIStatusView,
    SourceAccessView,
    TimelineView,
    DailySummaryView,
    EmailReplyView,
)

router = DefaultRouter()
router.register("sectors", SectorViewSet, basename="sector")
router.register("agents", AgentViewSet, basename="agent")
router.register("sector-messages", SectorMessageViewSet, basename="sector-message")
router.register("projects", ProjectViewSet, basename="project")
router.register("policy-rules", PolicyRuleViewSet, basename="policy-rule")
router.register("pending-approvals", PendingApprovalViewSet, basename="pending-approval")
router.register("tasks", TaskViewSet, basename="task")

urlpatterns = [
    path("", include(router.urls)),
    path("metrics/overview/", MetricsOverviewView.as_view(), name="agency-metrics-overview"),
    path("metrics/sectors/", MetricsSectorsView.as_view(), name="agency-metrics-sectors"),
    path("metrics/agents/", MetricsAgentsView.as_view(), name="agency-metrics-agents"),
    path("metrics/budgets/", MetricsBudgetsView.as_view(), name="agency-metrics-budgets"),
    path("ws-ticket/", WSTicketView.as_view(), name="agency-ws-ticket"),
    path("knowledge-usage/", KnowledgeUsageView.as_view(), name="agency-knowledge-usage"),
    path(
        "knowledge-usage/summary/",
        KnowledgeUsageSummaryView.as_view(),
        name="agency-knowledge-usage-summary",
    ),
    path("ai-status/", AIStatusView.as_view(), name="agency-ai-status"),
    path("source-access/", SourceAccessView.as_view(), name="agency-source-access"),
    path("timeline/", TimelineView.as_view(), name="agency-timeline"),
    path("daily-summary/", DailySummaryView.as_view(), name="agency-daily-summary"),
    path("email-reply/", EmailReplyView.as_view(), name="agency-email-reply"),
    path(
        "daily-summary/save/", DailySummaryView.as_view(), {"action": "save"},
        name="agency-daily-summary-save",
    ),
]
