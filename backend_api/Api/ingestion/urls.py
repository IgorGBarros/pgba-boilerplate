# backend_api/Api/ingestion/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from ingestion.views import (
    KnowledgeSourceViewSet,
    DocumentViewSet,
    DocumentUploadView,
    DocumentFileUploadView,
    RAGQueryView,
    KnowledgeGraphView,
    WebhookReceiveView,
)

router = DefaultRouter()
router.register("sources", KnowledgeSourceViewSet, basename="knowledge-source")
router.register("documents", DocumentViewSet, basename="document")

urlpatterns = [
    path("documents/upload/", DocumentUploadView.as_view(), name="document-upload"),
    path("documents/upload-file/", DocumentFileUploadView.as_view(), name="document-upload-file"),
    path("query/", RAGQueryView.as_view(), name="rag-query"),
    path("graph/", KnowledgeGraphView.as_view(), name="knowledge-graph"),
    path("webhooks/<uuid:public_id>/", WebhookReceiveView.as_view(), name="knowledge-webhook"),
    path("", include(router.urls)),
]