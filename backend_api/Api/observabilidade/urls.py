from django.urls import path

from observabilidade import views

urlpatterns = [
    path("saude/", views.SaudePublicaView.as_view()),
    path("painel/", views.PainelView.as_view()),
    path("verificar/", views.VerificarView.as_view()),
    path("incidentes/", views.IncidentesView.as_view()),
    path("incidentes/<int:pk>/", views.IncidenteDetalheView.as_view()),
    path("metricas/", views.MetricasView.as_view()),
    path("erros/", views.ErrosView.as_view()),
]
