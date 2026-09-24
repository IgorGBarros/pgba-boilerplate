from django.urls import path, include
from rest_framework.routers import DefaultRouter
from crm.views import (
    PipelineViewSet,
    StageViewSet,
    LeadViewSet,
    DealViewSet,
    ProjectViewSet,
    ContatoViewSet,
    AtividadeCRMViewSet,
    CustomFieldDefinitionViewSet,
    CustomFieldValueViewSet,
)
from crm.webhooks import (
    ChannelConfigViewSet,
    WhatsAppWebhookView,
    TelegramWebhookView,
    LeadCaptureView,
    MetaLeadAdsWebhookView,
)

router = DefaultRouter()
router.register("pipelines", PipelineViewSet, basename="pipeline")
router.register("stages", StageViewSet, basename="stage")
router.register("leads", LeadViewSet, basename="lead")
router.register("deals", DealViewSet, basename="deal")
router.register("projects", ProjectViewSet, basename="project")
router.register("contatos", ContatoViewSet, basename="contato")
router.register("atividades", AtividadeCRMViewSet, basename="atividade")
router.register("custom-fields", CustomFieldDefinitionViewSet, basename="custom-field")
router.register("custom-field-values", CustomFieldValueViewSet, basename="custom-field-value")
router.register("channels", ChannelConfigViewSet, basename="channel")

urlpatterns = [
    path("", include(router.urls)),

    # Webhooks públicos — sem autenticação JWT
    path("webhook/whatsapp/<str:tenant_id>/", WhatsAppWebhookView.as_view(), name="crm-webhook-whatsapp"),
    path("webhook/telegram/<str:tenant_id>/",  TelegramWebhookView.as_view(),  name="crm-webhook-telegram"),
    path("webhook/landing-page/<str:tenant_id>/", LeadCaptureView.as_view(),  name="crm-webhook-landing"),
    path("webhook/meta-ads/<str:tenant_id>/",  MetaLeadAdsWebhookView.as_view(), name="crm-webhook-meta"),
]
