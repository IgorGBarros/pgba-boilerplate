from django.apps import AppConfig


class MarketingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "marketing"
    verbose_name = "Marketing"

    def ready(self):
        # Resumo, agenda e rascunho de post para os agentes
        from marketing import ai_functions  # noqa: F401
