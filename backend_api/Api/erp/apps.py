from django.apps import AppConfig


class ErpConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "erp"
    verbose_name = "ERP"

    def ready(self):
        # Funções que os agentes de QUALQUER setor podem usar pra consultar o
        # ERP (CLAUDE.md §6): só leitura, tenant vem do código, nunca do LLM.
        from erp import ai_functions  # noqa: F401
