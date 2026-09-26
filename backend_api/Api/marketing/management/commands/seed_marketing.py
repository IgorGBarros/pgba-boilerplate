# backend_api/Api/marketing/management/commands/seed_marketing.py
"""
Uso:
    python manage.py seed_marketing --tenant <uuid>

Cria (ou confirma) o setor Marketing e o time: Head de Marketing (orquestrador),
Estrategista de Conteúdo, Copywriter, Designer de Criativos, Editor de Vídeo,
Social Media e Analista de Performance. Idempotente. Mesma coisa que o botão
"Montar time" na tela do Marketing.
"""
from django.core.management.base import BaseCommand

from marketing.equipe import montar


class Command(BaseCommand):
    help = "Cria o setor Marketing e o time de marketing (idempotente)."

    def add_arguments(self, parser):
        parser.add_argument("--tenant", required=True)

    def handle(self, *args, **opts):
        r = montar(opts["tenant"])
        self.stdout.write(f"Setor Marketing {'criado' if r['setor_criado'] else 'já existia'}.")
        for n in r["criados"]:
            self.stdout.write(f"  [Agente] Criado: {n}")
        for n in r["existentes"]:
            self.stdout.write(f"  [Agente] Já existia: {n}")
        self.stdout.write(self.style.SUCCESS("Time de marketing pronto."))
