from django.db import migrations, models

OUTCOME_CHOICES = [
    ("", "—"),
    ("vendido", "Vendido"),
    ("concluido", "Concluído"),
    ("perdido", "Perdido"),
    ("contrato_assinado", "Contrato Assinado"),
    ("cancelado", "Cancelado"),
]


class Migration(migrations.Migration):

    dependencies = [
        ("crm", "0005_add_welcome_message_quick_replies"),
    ]

    operations = [
        migrations.AddField(
            model_name="lead",
            name="outcome",
            field=models.CharField(
                blank=True,
                choices=OUTCOME_CHOICES,
                default="",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="historicallead",
            name="outcome",
            field=models.CharField(
                blank=True,
                choices=OUTCOME_CHOICES,
                default="",
                max_length=30,
            ),
        ),
    ]
