# backend_api/Api/ingestion/management/commands/sync_obsidian.py
"""
Uso:
    python manage.py sync_obsidian --tenant <uuid> --path /caminho/do/vault \
        [--name "Vault Principal"] [--tags publico,docs]

Cria (se não existir) um KnowledgeSource do tipo obsidian para o tenant
informado e sincroniza de forma síncrona — útil em desenvolvimento local,
sem depender de Celery/Redis rodando.
"""
from django.core.management.base import BaseCommand, CommandError

from ingestion.models import KnowledgeSource
from ingestion.services import sync_obsidian_source


class Command(BaseCommand):
    help = "Sincroniza um vault do Obsidian como fonte de conhecimento (RAG)."

    def add_arguments(self, parser):
        parser.add_argument("--tenant", required=True, help="UUID do tenant")
        parser.add_argument("--path", required=True, help="Caminho absoluto do vault")
        parser.add_argument("--name", default="Vault Obsidian")
        parser.add_argument(
            "--tags", default="", help="Tags separadas por vírgula (opcional filtro)"
        )

    def handle(self, *args, **options):
        tenant_id = options["tenant"]
        vault_path = options["path"]
        tags = [t.strip() for t in options["tags"].split(",") if t.strip()]

        source, created = KnowledgeSource.objects.get_or_create(
            tenant_id=tenant_id,
            source_type=KnowledgeSource.SourceType.OBSIDIAN,
            name=options["name"],
            defaults={"config": {"vault_path": vault_path, "include_tags": tags}},
        )
        if not created:
            source.config.update({"vault_path": vault_path, "include_tags": tags})
            source.save(update_fields=["config"])

        self.stdout.write(self.style.NOTICE(f"Sincronizando '{source.name}'..."))
        try:
            stats = sync_obsidian_source(source)
        except Exception as exc:
            raise CommandError(str(exc))

        self.stdout.write(self.style.SUCCESS(f"Concluído: {stats}"))
