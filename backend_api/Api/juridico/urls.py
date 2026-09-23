from django.urls import path, include
from rest_framework.routers import DefaultRouter
from juridico.views import ProcessoViewSet, ContratoViewSet, PrazoViewSet

router = DefaultRouter()
router.register("processos", ProcessoViewSet, basename="processo")
router.register("contratos", ContratoViewSet, basename="contrato")
router.register("prazos", PrazoViewSet, basename="prazo")

urlpatterns = [path("", include(router.urls))]
