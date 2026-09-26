from django.apps import AppConfig


class HelpdeskConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "helpdesk"
    verbose_name = "TI · Helpdesk"

    def ready(self):
        from helpdesk import ai_functions, receptores, verificacoes  # noqa: F401
