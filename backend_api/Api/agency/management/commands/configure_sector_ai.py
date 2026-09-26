# backend_api/Api/agency/management/commands/configure_sector_ai.py
"""
Define qual provedor/modelo de IA os agentes de um setor usam.

    python manage.py configure_sector_ai --sector desenvolvimento --provider anthropic
    python manage.py configure_sector_ai --sector desenvolvimento --provider anthropic \
        --model claude-sonnet-5
    python manage.py configure_sector_ai --sector comercial --clear   # volta pro provedor do tenant
    python manage.py configure_sector_ai --list

`--tenant <uuid>` restringe a um tenant; sem ele, vale para o setor com
esse slug em todos os tenants. Só escolhe o provedor — a chave de API
continua sendo configurada em `configure_ai_provider` (harness).
"""
from django.core.management.base import BaseCommand, CommandError

from agency.models import Sector
from harness.models import AIProviderCredential


class Command(BaseCommand):
    help = "Define o provedor/modelo de IA fixo de um setor (agency.Sector)."

    def add_arguments(self, parser):
        parser.add_argument("--sector", help="Slug do setor (ex: desenvolvimento).")
        parser.add_argument("--provider", choices=AIProviderCredential.Provider.values)
        parser.add_argument("--model", default=None, help="Modelo fixo (opcional).")
        parser.add_argument(
            "--clear", action="store_true", help="Volta a usar o provedor do tenant.",
        )
        parser.add_argument("--tenant", default=None, help="UUID do tenant (opcional).")
        parser.add_argument("--list", action="store_true", help="Lista o provedor de cada setor.")

    def handle(self, *args, **options):
        qs = Sector.objects.filter(is_active=True)
        if options["tenant"]:
            qs = qs.filter(tenant_id=options["tenant"])

        if options["list"]:
            for s in qs.order_by("tenant_id", "name"):
                chosen = s.default_provider or "(provedor do tenant)"
                model = f" / {s.default_model}" if s.default_model else ""
                self.stdout.write(f"{s.tenant_id}  {s.slug:<28} {chosen}{model}")
            return

        if not options["sector"]:
            raise CommandError("Informe --sector (ou use --list).")
        if not options["clear"] and not options["provider"]:
            raise CommandError("Informe --provider ou --clear.")

        sectors = list(qs.filter(slug=options["sector"]))
        if not sectors:
            raise CommandError(f"Nenhum setor ativo com slug '{options['sector']}'.")

        for s in sectors:
            if options["clear"]:
                s.default_provider, s.default_model = "", ""
            else:
                s.default_provider = options["provider"]
                if options["model"] is not None:
                    s.default_model = options["model"]
            s.save(update_fields=["default_provider", "default_model"])
            chosen = s.default_provider or "provedor do tenant"
            self.stdout.write(self.style.SUCCESS(f"{s.tenant_id} / {s.slug}: {chosen}"))
