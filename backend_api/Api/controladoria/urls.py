from django.urls import path, include
from rest_framework.routers import DefaultRouter
from controladoria.views import CentroCustoViewSet, EntradaAuditoriaViewSet, AlertaConformidadeViewSet

router = DefaultRouter()
router.register("centros-custo", CentroCustoViewSet, basename="centro-custo")
router.register("auditoria", EntradaAuditoriaViewSet, basename="entrada-auditoria")
router.register("alertas", AlertaConformidadeViewSet, basename="alerta-conformidade")

urlpatterns = [path("", include(router.urls))]
