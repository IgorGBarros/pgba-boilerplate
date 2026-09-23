from django.urls import path, include
from rest_framework.routers import DefaultRouter
from crm.views import LeadViewSet, ContatoViewSet, OportunidadeViewSet, AtividadeCRMViewSet

router = DefaultRouter()
router.register("leads", LeadViewSet, basename="lead")
router.register("contatos", ContatoViewSet, basename="contato")
router.register("oportunidades", OportunidadeViewSet, basename="oportunidade")
router.register("atividades", AtividadeCRMViewSet, basename="atividade")

urlpatterns = [path("", include(router.urls))]
