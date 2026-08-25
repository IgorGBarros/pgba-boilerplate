# backend_api/Api/harness/urls.py
from django.urls import path

from harness.views import GenerateCodeView

urlpatterns = [
    path("generate/", GenerateCodeView.as_view(), name="harness-generate-code"),
]
