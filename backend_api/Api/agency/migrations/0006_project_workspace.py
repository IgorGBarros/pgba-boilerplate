# Migration escrita à mão — idempotente de propósito.
#
# Contexto: em bases onde migrations antigas (já apagadas do disco)
# rodaram de verdade, Project.origin e Task.workspace já existem no
# banco. Em uma base nova (ex: suíte de testes, um clone fresco deste
# repositório), nenhuma das três colunas existe ainda. Esta migration
# precisa funcionar CORRETAMENTE nos dois casos.
#
# A solução: `ADD COLUMN IF NOT EXISTS` (Postgres nativo, idempotente
# de verdade) pra cada uma das três colunas, com `state_operations`
# separado garantindo que o Django sempre saiba que os três campos
# existem no modelo — independente de qual delas o SQL efetivamente
# criou desta vez.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('agency', '0005_historicaltask_result_task_result'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name='historicalproject',
                    name='origin',
                    field=models.CharField(
                        choices=[('created', 'Criado (template novo)'), ('imported', 'Importado (repositório já existia)')],
                        default='created', max_length=20,
                    ),
                ),
                migrations.AddField(
                    model_name='project',
                    name='origin',
                    field=models.CharField(
                        choices=[('created', 'Criado (template novo)'), ('imported', 'Importado (repositório já existia)')],
                        default='created', max_length=20,
                    ),
                ),
                migrations.AddField(
                    model_name='historicaltask',
                    name='workspace',
                    field=models.CharField(blank=True, max_length=100),
                ),
                migrations.AddField(
                    model_name='task',
                    name='workspace',
                    field=models.CharField(blank=True, max_length=100),
                ),
                migrations.AddField(
                    model_name='historicalproject',
                    name='workspace',
                    field=models.CharField(blank=True, max_length=100),
                ),
                migrations.AddField(
                    model_name='project',
                    name='workspace',
                    field=models.CharField(blank=True, max_length=100),
                ),
            ],
            database_operations=[
                migrations.RunSQL(
                    sql=(
                        "ALTER TABLE agency_historicalproject ADD COLUMN IF NOT EXISTS origin varchar(20) NOT NULL DEFAULT 'created';"
                        "ALTER TABLE agency_project ADD COLUMN IF NOT EXISTS origin varchar(20) NOT NULL DEFAULT 'created';"
                        "ALTER TABLE agency_historicaltask ADD COLUMN IF NOT EXISTS workspace varchar(100) NOT NULL DEFAULT '';"
                        "ALTER TABLE agency_task ADD COLUMN IF NOT EXISTS workspace varchar(100) NOT NULL DEFAULT '';"
                        "ALTER TABLE agency_historicalproject ADD COLUMN IF NOT EXISTS workspace varchar(100) NOT NULL DEFAULT '';"
                        "ALTER TABLE agency_project ADD COLUMN IF NOT EXISTS workspace varchar(100) NOT NULL DEFAULT '';"
                    ),
                    reverse_sql=(
                        "ALTER TABLE agency_project DROP COLUMN IF EXISTS workspace;"
                        "ALTER TABLE agency_historicalproject DROP COLUMN IF EXISTS workspace;"
                        "ALTER TABLE agency_task DROP COLUMN IF EXISTS workspace;"
                        "ALTER TABLE agency_historicaltask DROP COLUMN IF EXISTS workspace;"
                        "ALTER TABLE agency_project DROP COLUMN IF EXISTS origin;"
                        "ALTER TABLE agency_historicalproject DROP COLUMN IF EXISTS origin;"
                    ),
                ),
            ],
        ),
    ]
