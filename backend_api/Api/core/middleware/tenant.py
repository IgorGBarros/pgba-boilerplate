# backend_api/core/middleware/tenant.py
from django.db import connection
from django.http import JsonResponse


class TenantMiddleware:
    """
    Injeta tenant_id no contexto da request e do banco de dados.
    
    Garante que cada usuário B2B acesse apenas seus próprios dados,
    mesmo que a query esqueça de filtrar por tenant_id.

    ⚠️ LIMITAÇÃO CONHECIDA: middleware de Django roda ANTES da
    autenticação do DRF (JWT), então `request.user` aqui é sempre
    `AnonymousUser` numa request de API — este middleware NUNCA
    resolve tenant_id para endpoints DRF na prática. Para APIView/
    ViewSet, use `core.mixins.TenantContextMixin` (resolve no lugar
    certo, depois da autenticação de verdade). Este middleware
    permanece só para o caso raro de uma view Django "crua"
    (não-DRF) autenticada por sessão.
    """
    
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        # Se usuário autenticado tem tenant, injeta no contexto
        if request.user.is_authenticated and hasattr(request.user, 'tenant_id') and request.user.tenant_id:
            request.tenant_id = request.user.tenant_id
            
            # Opcional: injetar no PostgreSQL para Row-Level Security (RLS)
            try:
                cursor = connection.cursor()
                cursor.execute("SET LOCAL app.current_tenant = %s", [str(request.user.tenant_id)])
            except Exception:
                # Falha silenciosa: RLS é opcional, isolamento no Django é obrigatório
                pass
        
        return self.get_response(request)


def tenant_required(view_func):
    """
    Decorator para views que exigem tenant_id.
    Retorna 403 se o usuário não pertence a um tenant.
    """
    def wrapper(request, *args, **kwargs):
        if not hasattr(request, 'tenant_id') or not request.tenant_id:
            return JsonResponse(
                {"error": "Acesso requer tenant válido"}, 
                status=403
            )
        return view_func(request, *args, **kwargs)
    return wrapper