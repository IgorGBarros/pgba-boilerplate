from rest_framework.permissions import BasePermission
from django.utils.timezone import now
from django.http import JsonResponse

from rest_framework.permissions import BasePermission

class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_admin

class IsProUser(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_pro_user

class CanManageTeam(BasePermission):
    def has_permission(self, request, view):
        allowed_roles = ["Administrador", "Gestor"]
        return request.user.is_authenticated and request.user.role.name in allowed_roles

class IsOwnerOrAdmin(BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.user == request.user or request.user.is_admin

def require_plan(plan_name):
    def decorator(view_func):
        def _wrapped_view(request, *args, **kwargs):
            subscription = getattr(request.user, 'subscription', None)
            if subscription and subscription.plan.name == plan_name and subscription.valid_until > now():
                return view_func(request, *args, **kwargs)
            return JsonResponse({'error': 'Acesso restrito ao plano requerido.'}, status=403)
        return _wrapped_view
    return decorator
