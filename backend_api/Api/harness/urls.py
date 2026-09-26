# backend_api/Api/harness/urls.py
from django.urls import path

from harness.views import (
    GenerateCodeView,
    AIProviderCredentialListCreateView,
    AIProviderCredentialDetailView,
    AIProviderStatusView,
    AIProviderTestView,
)

urlpatterns = [
    path("generate/", GenerateCodeView.as_view(), name="harness-generate-code"),
    path("providers/", AIProviderCredentialListCreateView.as_view(), name="harness-providers-list"),
    path("providers/<int:pk>/", AIProviderCredentialDetailView.as_view(), name="harness-providers-detail"),
    path("providers/status/", AIProviderStatusView.as_view(), name="harness-providers-status"),
    path("providers/test/", AIProviderTestView.as_view(), name="harness-providers-test"),
]
