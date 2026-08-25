# backend_api/Api/integrations/apps.py
from django.apps import AppConfig


class IntegrationsConfig(AppConfig):
    """
    Credenciais e clientes de serviços externos que NÃO são provedores de
    IA (isso é `harness`) — GitHub, Vercel, Render, Supabase, etc.

    Mesmo padrão do `harness`: credencial criptografada, resolvida por
    tenant, configurável via admin ou comando de management, nunca
    hardcoded. Existe separado do `harness` porque a semântica é
    diferente (harness = IA; integrations = infraestrutura/deploy) e
    misturar os dois confundiria "qual credencial resolve o quê".
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "integrations"
    verbose_name = "Integrações externas (GitHub, Vercel, Render, Supabase)"
