from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse

def health_check(request):
    """Endpoint simples para monitoramento/healthcheck"""
    return JsonResponse({"status": "ok", "service": "pgba-backend-api"})

urlpatterns = [
    path('admin/', admin.site.urls),
    path('health/', health_check, name='health_check'),
    path('api/v1/ingestion/', include('ingestion.urls')),
    path('api/v1/orchestration/', include('orchestration.urls')),
    path('api/v1/harness/', include('harness.urls')),
    path('api/v1/agency/', include('agency.urls')),
    path('api/v1/users/', include('User.urls')),

    # 📌 Descomente conforme for implementando:
    # path('api/v1/payments/', include('payments.urls')),
]