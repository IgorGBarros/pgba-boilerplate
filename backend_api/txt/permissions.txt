from rest_framework.permissions import BasePermission
from django.utils.timezone import now
from django.http import JsonResponse

class IsAdminRole(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role and request.user.role.name == 'Administrador'

class IsAlunoUFBA(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role and request.user.role.name == 'Aluno UFBA'


def require_plan(plan_name):
    def decorator(view_func):
        def _wrapped_view(request, *args, **kwargs):
            subscription = getattr(request.user, 'subscription', None)
            if subscription and subscription.plan.name == plan_name and subscription.valid_until > now():
                return view_func(request, *args, **kwargs)
            return JsonResponse({'error': 'Acesso restrito ao plano requerido.'}, status=403)
        return _wrapped_view
    return decorator
