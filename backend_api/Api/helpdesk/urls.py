from django.urls import path, include
from rest_framework.routers import DefaultRouter
from helpdesk.views import TicketViewSet, EquipamentoTIViewSet

router = DefaultRouter()
router.register("tickets", TicketViewSet, basename="ticket")
router.register("equipamentos", EquipamentoTIViewSet, basename="equipamento")

urlpatterns = [path("", include(router.urls))]
