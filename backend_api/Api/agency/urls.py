# backend_api/Api/agency/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from agency.views import (
    SectorViewSet,
    AgentViewSet,
    SectorMessageViewSet,
    ProjectViewSet,
    MetricsOverviewView,
    MetricsSectorsView,
    MetricsAgentsView,
    MetricsBudgetsView,
)

router = DefaultRouter()
router.register("sectors", SectorViewSet, basename="sector")
router.register("agents", AgentViewSet, basename="agent")
router.register("sector-messages", SectorMessageViewSet, basename="sector-message")
router.register("projects", ProjectViewSet, basename="project")

urlpatterns = [
    path("", include(router.urls)),
    path("metrics/overview/", MetricsOverviewView.as_view(), name="agency-metrics-overview"),
    path("metrics/sectors/", MetricsSectorsView.as_view(), name="agency-metrics-sectors"),
    path("metrics/agents/", MetricsAgentsView.as_view(), name="agency-metrics-agents"),
    path("metrics/budgets/", MetricsBudgetsView.as_view(), name="agency-metrics-budgets"),
]
