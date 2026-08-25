# backend_api/Api/ingestion/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from ingestion.views import (
    KnowledgeSourceViewSet,
    DocumentViewSet,
    DocumentUploadView,
    RAGQueryView,
)

router = DefaultRouter()
router.register("sources", KnowledgeSourceViewSet, basename="knowledge-source")
router.register("documents", DocumentViewSet, basename="document")

urlpatterns = [
    path("", include(router.urls)),
    path("documents/upload/", DocumentUploadView.as_view(), name="document-upload"),
    path("query/", RAGQueryView.as_view(), name="rag-query"),
]
