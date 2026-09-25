from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("crm", "0008_add_trigger_phrases"),
    ]

    operations = [
        migrations.AddField(
            model_name="channelconfig",
            name="is_paused",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="channelconfig",
            name="session_timeout_minutes",
            field=models.PositiveIntegerField(
                default=20,
                help_text="Minutos sem resposta para encerrar a sessão. 0 = desativado.",
            ),
        ),
        migrations.AddField(
            model_name="channelconfig",
            name="session_timeout_message",
            field=models.TextField(
                blank=True,
                default="Sua sessão foi encerrada por inatividade. Se precisar de ajuda, é só enviar uma mensagem!",
            ),
        ),
        migrations.AddField(
            model_name="channelconfig",
            name="business_hours",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="channelconfig",
            name="out_of_hours_message",
            field=models.TextField(
                blank=True,
                default="Olá! Nosso atendimento funciona em horário comercial. Em breve retornaremos!",
            ),
        ),
    ]
