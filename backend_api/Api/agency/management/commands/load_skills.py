# backend_api/Api/agency/management/commands/load_skills.py
"""
Uso:
    python manage.py load_skills --tenant <uuid>
    python manage.py load_skills --tenant <uuid> --force   # sobrescreve mesmo se ja preenchido

Carrega o conteudo dos arquivos .md em agency/skills/ no campo
Agent.instructions de cada agente do tenant informado.

Util para quem ja rodou seed_company antes da skill ser criada, ou para
atualizar o conteudo de uma skill sem recriar o agente.
"""
import pathlib

from django.core.management.base import BaseCommand

from agency.models import Agent

SKILLS_DIR = pathlib.Path(__file__).resolve().parent.parent.parent / "skills"

AGENT_SKILL_MAP = {
    "CEO Virtual":                      "ceo-virtual.md",
    "AI Controller":                    "ai-controller.md",
    "Orquestrador de Desenvolvimento":  "orquestrador-desenvolvimento.md",
    "AI Backend":                       "ai-backend.md",
    "AI Frontend":                      "ai-frontend.md",
    "AI Vendedor":                      "ai-vendedor.md",
    "AI Planejador":                    "ai-planejador.md",
    "AI Comprador":                     "ai-comprador.md",
    "AI Financeiro":                    "ai-financeiro.md",
    "AI Controladoria":                 "ai-controladoria.md",
    "AI RH":                            "ai-rh.md",
    "AI TI":                            "ai-ti.md",
    "AI Juridico":                      "ai-juridico.md",
    "AI Inteligencia de Mercado":       "ai-inteligencia-mercado.md",
}


class Command(BaseCommand):
    help = "Carrega agency/skills/*.md nos campos Agent.instructions do tenant informado."

    def add_arguments(self, parser):
        parser.add_argument("--tenant", required=True, help="UUID do tenant.")
        parser.add_argument(
            "--force",
            action="store_true",
            default=False,
            help="Sobrescreve instructions mesmo quando o campo ja estiver preenchido.",
        )

    def handle(self, *args, **options):
        tenant_id = options["tenant"]
        force = options["force"]
        loaded = skipped = missing_agent = missing_file = 0

        for agent_name, skill_file in AGENT_SKILL_MAP.items():
            skill_path = SKILLS_DIR / skill_file

            if not skill_path.exists():
                self.stdout.write(self.style.WARNING(f"  [ARQUIVO NAO ENCONTRADO] {skill_file}"))
                missing_file += 1
                continue

            try:
                agent = Agent.objects.get(tenant_id=tenant_id, name=agent_name)
            except Agent.DoesNotExist:
                self.stdout.write(self.style.WARNING(f"  [AGENTE NAO ENCONTRADO] {agent_name}"))
                missing_agent += 1
                continue

            if agent.instructions and not force:
                self.stdout.write(f"  [JA PREENCHIDO] {agent_name} — use --force para sobrescrever")
                skipped += 1
                continue

            agent.instructions = skill_path.read_text(encoding="utf-8")
            agent.save(update_fields=["instructions"])
            self.stdout.write(self.style.SUCCESS(f"  [OK] {agent_name} ← {skill_file}"))
            loaded += 1

        self.stdout.write("")
        self.stdout.write(
            f"Concluido: {loaded} carregado(s), {skipped} ja preenchido(s) "
            f"(use --force pra sobrescrever), {missing_agent} agente(s) nao encontrado(s), "
            f"{missing_file} arquivo(s) ausente(s)."
        )
