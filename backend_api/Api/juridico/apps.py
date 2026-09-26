from django.apps import AppConfig


class JuridicoConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "juridico"
    verbose_name = "Jurídico"

    def ready(self):
        # Resumo e prazos para os agentes (só leitura)
        from juridico import ai_functions  # noqa: F401
