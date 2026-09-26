from django.urls import include, path
from rest_framework.routers import DefaultRouter

from helpdesk.views import (
    AgentesObsView,
    DiagnosticarIncidenteView,
    EquipamentoTIViewSet,
    EquipeView,
    PainelTIView,
    TicketViewSet,
)

router = DefaultRouter()
router.register("tickets", TicketViewSet, basename="ticket")
router.register("equipamentos", EquipamentoTIViewSet, basename="equipamento")

urlpatterns = [
    path("painel/", PainelTIView.as_view()),
    path("equipe/", EquipeView.as_view()),
    path("agentes/", AgentesObsView.as_view()),
    path("incidentes/<int:pk>/diagnosticar/", DiagnosticarIncidenteView.as_view()),
    path("", include(router.urls)),
]
