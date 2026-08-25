# backend_api/Api/User/signals.py
"""
NOTA DE AUDITORIA (ver relatório de varredura):
1. Este arquivo tinha imports duplicados (post_save, receiver,
   Role/Plan/CustomUser importados duas vezes).
2. Tinha uma regra de negócio de OUTRO projeto — atribuição automática de
   role "Aluno UFBA" por domínio de e-mail (@ufba), sem nenhuma relação
   com o PGBA Boilerplate. Removida.
3. BUG real: `if sender.label == "user"` nunca era verdadeiro — o label
   padrão do app é derivado de `AppConfig.name` SEM lowercase, e o app se
   chama `User` (maiúsculo, ver User/apps.py). Ou seja, `create_roles_and_plans`
   nunca executava. Corrigido para comparar com "User".

O seed de roles/planos foi generalizado para nomes neutros. Ajuste
conforme o domínio real do projeto que usar este boilerplate como base.
"""
from django.db.models.signals import post_migrate, post_save
from django.dispatch import receiver

from .models import Role, Plan, CustomUser


@receiver(post_migrate)
def create_roles_and_plans(sender, **kwargs):
    if sender.label != "User":
        return

    for role_name in ["Administrador", "Membro", "Convidado"]:
        Role.objects.get_or_create(name=role_name)

    planos = [
        {"name": "Gratuito", "is_free": True, "description": "Plano gratuito básico"},
        {"name": "Premium", "is_free": False, "description": "Plano premium com mais recursos"},
    ]
    for plano in planos:
        Plan.objects.get_or_create(
            name=plano["name"],
            defaults={"is_free": plano["is_free"], "description": plano["description"]},
        )


@receiver(post_save, sender=CustomUser)
def assign_default_plan_and_role(sender, instance, created, **kwargs):
    """
    Ao criar um usuário, garante plano e role padrão. Atribuir role por
    domínio de e-mail (ou qualquer outra regra de negócio) é responsabilidade
    da VERTICAL do domínio do projeto (ver CLAUDE.md, "Padrão de Vertical"),
    não do core de usuários do boilerplate.
    """
    if not created:
        return

    updated = False

    if not instance.plan:
        free_plan = Plan.objects.filter(is_free=True).first()
        if free_plan:
            instance.plan = free_plan
            updated = True

    if not instance.role:
        default_role = Role.objects.filter(name="Membro").first()
        if default_role:
            instance.role = default_role
            updated = True

    if updated:
        instance.save(update_fields=["plan", "role"])
