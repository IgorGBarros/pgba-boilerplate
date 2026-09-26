from django.apps import AppConfig


class ObservabilidadeConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "observabilidade"
    verbose_name = "Observabilidade"

    def ready(self):
        # Mede toda chamada de IA e toda saída de rede (sinais do core)
        from observabilidade import receptores  # noqa: F401
