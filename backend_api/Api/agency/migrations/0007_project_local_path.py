from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('agency', '0006_project_workspace'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name='historicalproject',
                    name='local_path',
                    field=models.CharField(blank=True, max_length=500),
                ),
                migrations.AddField(
                    model_name='project',
                    name='local_path',
                    field=models.CharField(blank=True, max_length=500),
                ),
            ],
            database_operations=[
                migrations.RunSQL(
                    sql=(
                        "ALTER TABLE agency_historicalproject ADD COLUMN IF NOT EXISTS local_path varchar(500) NOT NULL DEFAULT '';"
                        "ALTER TABLE agency_project ADD COLUMN IF NOT EXISTS local_path varchar(500) NOT NULL DEFAULT '';"
                    ),
                    reverse_sql=(
                        "ALTER TABLE agency_project DROP COLUMN IF EXISTS local_path;"
                        "ALTER TABLE agency_historicalproject DROP COLUMN IF EXISTS local_path;"
                    ),
                ),
            ],
        ),
    ]
