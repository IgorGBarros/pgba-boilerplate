"""
Setor de Desenvolvimento passa a usar só Claude (provedor "anthropic");
os demais setores continuam no provedor ativo do tenant (hoje, Groq).

Só toca setor de Desenvolvimento que ainda não tem provedor escolhido —
nunca sobrescreve uma escolha feita depois pelo admin. A credencial da
Anthropic é configurada à parte (`configure_ai_provider --provider
anthropic ...`); até lá, agentes desse setor falham de forma explícita
em vez de cair no Groq (ver agency.services.resolve_agent_llm).
"""
from django.db import migrations
from django.db.models import Q

DEV = Q(slug="desenvolvimento") | Q(name__iexact="desenvolvimento")


def forwards(apps, schema_editor):
    Sector = apps.get_model("agency", "Sector")
    Sector.objects.filter(DEV, default_provider="").update(default_provider="anthropic")


def backwards(apps, schema_editor):
    Sector = apps.get_model("agency", "Sector")
    Sector.objects.filter(DEV, default_provider="anthropic").update(default_provider="")


class Migration(migrations.Migration):
    dependencies = [("agency", "0010_sector_ai_provider")]
    operations = [migrations.RunPython(forwards, backwards)]
