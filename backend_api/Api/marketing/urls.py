# backend_api/Api/marketing/urls.py
from django.urls import path
from rest_framework.routers import DefaultRouter

from marketing import views

router = DefaultRouter()
router.register("contas", views.ContaViewSet, basename="mkt-conta")
router.register("midias", views.MidiaViewSet, basename="mkt-midia")
router.register("publicacoes", views.PublicacaoViewSet, basename="mkt-publicacao")
router.register("jobs", views.JobViewSet, basename="mkt-job")

urlpatterns = [
    path("painel/", views.PainelView.as_view()),
    path("time/", views.TimeView.as_view()),
    path("prontidao/", views.ProntidaoView.as_view()),
    path("marca/", views.MarcaView.as_view()),
    path("marca/logo/", views.LogoView.as_view()),
    path("ramos/", views.RamosView.as_view()),
    path("apps/", views.AppsView.as_view()),
    path("apps/<str:provedor>/", views.AppDetailView.as_view()),
    path("criativos/", views.CriativoView.as_view()),
    path("oauth/callback/", views.OAuthCallbackView.as_view()),
    path("publico/midia/<str:token>/", views.MidiaPublicaView.as_view()),
] + router.urls
