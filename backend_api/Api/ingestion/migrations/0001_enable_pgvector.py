# backend_api/Api/ingestion/migrations/0001_enable_pgvector.py
"""
Ativa a extensão `vector` do PostgreSQL antes de qualquer model do app
ingestion ser criado. Sem isso, `VectorField` falha na migration seguinte.

Depois de rodar esta migration, gere o restante normalmente:
    python manage.py makemigrations ingestion
    python manage.py migrate
"""
from django.db import migrations
from pgvector.django import VectorExtension


class Migration(migrations.Migration):

    initial = True
    dependencies = []

    operations = [
        VectorExtension(),
    ]
