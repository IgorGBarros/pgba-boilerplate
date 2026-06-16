from django.db.models.signals import post_migrate, post_save
from django.dispatch import receiver
from django.core.exceptions import ValidationError
from .models import Role, Plan, CustomUser

@receiver(post_migrate)
def create_roles_and_plans(sender, **kwargs):
    if sender.label == "user":  # ajuste para o nome do app correto
        roles = ["Aluno UFBA", "Treinamento", "Eventos", "Administrador", "Assinante"]
        for role_name in roles:
            Role.objects.get_or_create(name=role_name)

        planos = [
            {"name": "Gratuito", "is_free": True, "description": "Plano gratuito básico"},
            {"name": "Premium", "is_free": False, "description": "Plano premium com mais recursos"},
        ]
        for plano in planos:
            Plan.objects.get_or_create(name=plano["name"], defaults={
                "is_free": plano["is_free"],
                "description": plano["description"],
            })

from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import CustomUser, Plan, Role

@receiver(post_save, sender=CustomUser)
def assign_default_plan_and_role(sender, instance, created, **kwargs):
    if created:
        updated = False

        # Atribuir plano gratuito se não existir
        if not instance.plan:
            try:
                free_plan = Plan.objects.get(is_free=True)
                instance.plan = free_plan
                updated = True
            except Plan.DoesNotExist:
                print("Plano gratuito não encontrado.")

        # Atribuir role conforme e-mail
        if not instance.role:
            email = instance.email.lower()
            role_to_assign = None
            try:
                if "@ufba" in email:
                    role_to_assign = Role.objects.get(name="Aluno UFBA")
                elif email.endswith("@gmail.com") or email.endswith("@gmail.com.br"):
                    role_to_assign = Role.objects.get(name="Assinante")
                # Nenhuma outra role automática, admin define depois

                if role_to_assign:
                    instance.role = role_to_assign
                    updated = True
            except Role.DoesNotExist:
                print("Role não encontrada.")

        # Salva se houve alteração
        if updated:
            instance.save(update_fields=['plan', 'role'])
