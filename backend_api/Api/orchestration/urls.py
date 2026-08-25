# backend_api/Api/orchestration/urls.py
from django.urls import path

from orchestration.views import AskView

urlpatterns = [
    path("ask/", AskView.as_view(), name="orchestration-ask"),
]
