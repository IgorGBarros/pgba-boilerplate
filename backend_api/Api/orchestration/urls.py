# backend_api/Api/orchestration/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from orchestration.views import AskView, QueryLogViewSet

router = DefaultRouter()
router.register("query-logs", QueryLogViewSet, basename="query-log")

urlpatterns = [
    path("ask/", AskView.as_view(), name="orchestration-ask"),
    path("", include(router.urls)),
]
