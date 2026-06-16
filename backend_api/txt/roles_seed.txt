# users/roles_seed.py
def seed_roles():
    from .models import Role

    roles = ["Aluno UFBA", "Treinamento", "Eventos", "Administrador", "Assinante"]
    for role_name in roles:
        Role.objects.get_or_create(name=role_name)
