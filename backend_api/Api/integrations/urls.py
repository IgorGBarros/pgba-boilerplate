# backend_api/Api/integrations/urls.py
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from integrations import views

router = DefaultRouter()
router.register("servers", views.ServerConnectionViewSet, basename="server")
router.register("email-accounts", views.EmailAccountViewSet, basename="email-account")
router.register("outbound-emails", views.OutboundEmailViewSet, basename="outbound-email")
router.register("inbound-emails", views.InboundEmailViewSet, basename="inbound-email")

urlpatterns = [
    path("credentials/", views.CredentialListView.as_view(), name="credentials"),
    path(
        "credentials/<str:provider>/",
        views.CredentialDetailView.as_view(),
        name="credential-detail",
    ),
    path(
        "credentials/<str:provider>/test/",
        views.CredentialTestView.as_view(),
        name="credential-test",
    ),
    path("n8n/overview/", views.N8nOverviewView.as_view(), name="n8n-overview"),
    path("n8n/executions/", views.N8nExecutionsView.as_view(), name="n8n-executions"),
    path(
        "n8n/workflows/<str:workflow_id>/active/",
        views.N8nWorkflowActiveView.as_view(),
        name="n8n-active",
    ),
    path("hostinger/overview/", views.HostingerOverviewView.as_view(), name="hostinger-overview"),
    path("", include(router.urls)),
]
