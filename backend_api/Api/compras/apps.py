from django.apps import AppConfig


class ComprasConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "compras"
    verbose_name = "Compras"

    def ready(self):
        # Cotação/pedido só viram "enviado" quando o e-mail sai de verdade.
        from compras.services import ao_enviar_email
        from integrations.signals import email_sent

        email_sent.connect(ao_enviar_email, dispatch_uid="compras_email_enviado")
