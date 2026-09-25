from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("crm", "0009_channelconfig_business_hours_session_timeout_pause"),
    ]

    operations = [
        migrations.AddField(
            model_name="leadmessage",
            name="tokens_in",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="leadmessage",
            name="tokens_out",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="leadmessage",
            name="cost_estimated_usd",
            field=models.DecimalField(decimal_places=6, default=0, max_digits=10),
        ),
    ]
