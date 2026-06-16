from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse

def health_check(request):
    """Endpoint simples para monitoramento/healthcheck"""
    return JsonResponse({"status": "ok", "service": "pgba-backend-api"})

urlpatterns = [
    path('admin/', admin.site.urls),
    path('health/', health_check, name='health_check'),
    
    # 📌 Descomente conforme for criando os apps:
    # path('api/v1/users/', include('User.urls')),
    # path('api/v1/auth/', include('auth.urls')),
    # path('api/v1/payments/', include('payments.urls')),
]