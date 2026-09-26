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
    path('api/v1/crm/', include('crm.urls')),
    path('api/v1/erp/', include('erp.urls')),
    path('api/v1/juridico/', include('juridico.urls')),
    path('api/v1/marketing/', include('marketing.urls')),
    path('api/v1/helpdesk/', include('helpdesk.urls')),
    path('api/v1/desenvolvimento/', include('desenvolvimento.urls')),
    path('api/v1/controladoria/', include('controladoria.urls')),
    path('api/v1/datalake/', include('datalake.urls')),
    path('api/v1/scraping/', include('scraping.urls')),
    path('api/v1/compras/', include('compras.urls')),
    path('api/v1/integrations/', include('integrations.urls')),

    # 📌 Descomente conforme for implementando:
    # path('api/v1/payments/', include('payments.urls')),
]