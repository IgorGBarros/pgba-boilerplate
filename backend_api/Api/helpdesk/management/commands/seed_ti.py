from django.core.management.base import BaseCommand

from helpdesk import equipe


class Command(BaseCommand):
    help = (
        "Monta o time de TI (Head, SRE, DBA, Suporte, Integrações, Segurança) "
        "no setor TI do tenant."
    )

    def add_arguments(self, parser):
        parser.add_argument("--tenant", required=True, help="tenant_id (UUID)")

    def handle(self, *args, tenant, **opts):
        r = equipe.montar(tenant)
        self.stdout.write(
            self.style.SUCCESS(
                f"Setor TI #{r['setor']}{' (criado)' if r['setor_criado'] else ''} · "
                f"criados: {', '.join(r['criados']) or '—'} · "
                f"já existiam: {', '.join(r['existentes']) or '—'}"
            )
        )
