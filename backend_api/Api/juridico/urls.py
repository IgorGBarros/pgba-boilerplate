from django.urls import include, path
from rest_framework.routers import DefaultRouter

from juridico import views

router = DefaultRouter()
router.register("processos", views.ProcessoViewSet, basename="processo")
router.register("andamentos", views.AndamentoViewSet, basename="andamento")
router.register("contratos", views.ContratoViewSet, basename="contrato")
router.register("prazos", views.PrazoViewSet, basename="prazo")
router.register("modelos", views.ModeloViewSet, basename="modelo-documento")
router.register("documentos", views.DocumentoViewSet, basename="documento")
router.register("assinaturas", views.SolicitacaoViewSet, basename="assinatura")

urlpatterns = [
    path("painel/", views.PainelView.as_view(), name="juridico-painel"),
    # Público (sem login): link individual do signatário e verificação de documento
    path("assinar/<str:token>/", views.AssinarInfoView.as_view(), name="assinar-info"),
    path("assinar/<str:token>/pdf/", views.AssinarPdfView.as_view(), name="assinar-pdf"),
    path("assinar/<str:token>/codigo/", views.AssinarCodigoView.as_view(), name="assinar-codigo"),
    path("assinar/<str:token>/assinar/", views.AssinarView.as_view(), name="assinar-assinar"),
    path("assinar/<str:token>/recusar/", views.RecusarView.as_view(), name="assinar-recusar"),
    path("verificar/", views.VerificarView.as_view(), name="assinatura-verificar"),
    path("", include(router.urls)),
]
