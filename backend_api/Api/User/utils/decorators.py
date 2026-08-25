
from django.http import HttpResponseForbidden
from functools import wraps

def limit_projects(get_user_projects_count_func):
    """
    Decorator que limita o número de projetos permitidos pelo plano do usuário.
    `get_user_projects_count_func` deve ser uma função que retorna o número de projetos do usuário.
    """
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, *args, **kwargs):
            user = request.user
            if user.is_authenticated and user.plan:
                current_count = get_user_projects_count_func(user)
                if current_count >= user.plan.max_projects:
                    return HttpResponseForbidden("Limite de projetos atingido para seu plano.")
            return view_func(request, *args, **kwargs)
        return _wrapped_view
    return decorator