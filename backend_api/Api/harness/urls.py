# backend_api/Api/harness/urls.py
from django.urls import path

from harness.views import (
    GenerateCodeView,
    AIProviderCredentialListCreateView,
    AIProviderCredentialDetailView,
)

urlpatterns = [
    path("generate/", GenerateCodeView.as_view(), name="harness-generate-code"),
    path("providers/", AIProviderCredentialListCreateView.as_view(), name="harness-providers-list"),
    path("providers/<int:pk>/", AIProviderCredentialDetailView.as_view(), name="harness-providers-detail"),
]
