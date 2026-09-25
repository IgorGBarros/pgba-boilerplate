"""
python manage.py scrape_google_maps "padarias em Salvador BA" --depth 5
python manage.py scrape_google_maps "academias em Feira de Santana" --lat -12.2664 --lng -38.9663 --depth 8
python manage.py scrape_google_maps "restaurantes em Recife" --import-to-crm --tenant-id <uuid>
"""
import time
import json

from django.core.management.base import BaseCommand, CommandError

from scraping.services import (
    gmaps_create_job, gmaps_get_job, gmaps_normalize_results,
    gmaps_list_jobs,
)


class Command(BaseCommand):
    help = "Scrapa negócios no Google Maps e exibe (ou importa para o CRM) os resultados."

    def add_arguments(self, parser):
        parser.add_argument("query", help='Ex: "padarias em Salvador BA"')
        parser.add_argument("--lat", default="", help="Latitude (opcional)")
        parser.add_argument("--lng", default="", help="Longitude (opcional)")
        parser.add_argument("--depth", type=int, default=5, help="Profundidade (padrão: 5)")
        parser.add_argument("--import-to-crm", action="store_true", help="Importar como Leads no CRM")
        parser.add_argument("--tenant-id", default="", help="tenant_id para importação no CRM")
        parser.add_argument("--status", action="store_true", help="Apenas verifica se o container está rodando")

    def handle(self, *args, **options):
        if options["status"]:
            try:
                jobs = gmaps_list_jobs()
                self.stdout.write(self.style.SUCCESS(
                    f"✅ Container ativo — {len(jobs)} job(s) registrado(s)"
                ))
            except Exception as exc:
                self.stdout.write(self.style.ERROR(f"❌ Container offline: {exc}"))
                self.stdout.write("Suba com: docker compose --profile scraping up -d gmaps-scraper")
            return

        query = options["query"]
        lat = options["lat"]
        lng = options["lng"]
        depth = options["depth"]

        self.stdout.write(f"🔍 Buscando: {query} (depth={depth})")

        try:
            ext_id = gmaps_create_job(query, lat, lng, depth)
            self.stdout.write(f"📋 Job criado: {ext_id}")
        except Exception as exc:
            raise CommandError(f"Erro ao criar job: {exc}")

        # Poll
        elapsed = 0
        max_wait = 300
        poll_interval = 5

        while elapsed < max_wait:
            time.sleep(poll_interval)
            elapsed += poll_interval

            try:
                data = gmaps_get_job(ext_id)
            except Exception as exc:
                self.stderr.write(f"Erro no poll: {exc}")
                continue

            status = str(data.get("status", "")).lower()
            self.stdout.write(f"  ⏳ {elapsed}s — status: {status}")

            if status in ("completed", "done", "finished"):
                raw = data.get("data") or data.get("results") or []
                results = gmaps_normalize_results(raw if isinstance(raw, list) else [raw])
                self.stdout.write(self.style.SUCCESS(f"\n✅ {len(results)} resultado(s) encontrado(s):"))

                for i, r in enumerate(results[:20], 1):
                    self.stdout.write(
                        f"  {i:2}. {r.get('title', '?')} | "
                        f"{r.get('phone', '-')} | "
                        f"{r.get('website', '-')} | "
                        f"⭐ {r.get('review_rating', '-')} ({r.get('review_count', 0)})"
                    )

                if len(results) > 20:
                    self.stdout.write(f"  ... e mais {len(results) - 20} resultado(s)")

                if options["import_to_crm"]:
                    if not options["tenant_id"]:
                        self.stderr.write("⚠️  --tenant-id obrigatório para importar no CRM")
                    else:
                        from scraping.models import ScrapingJob
                        from scraping.services import import_results_to_crm

                        job_obj = ScrapingJob.objects.create(
                            tenant_id=options["tenant_id"],
                            job_type=ScrapingJob.JobType.GOOGLE_MAPS,
                            query=query,
                            lat=lat,
                            lng=lng,
                            depth=depth,
                            status=ScrapingJob.Status.DONE,
                            results=results,
                            result_count=len(results),
                            external_job_id=str(ext_id),
                        )
                        count = import_results_to_crm(job_obj)
                        self.stdout.write(self.style.SUCCESS(f"📥 {count} leads importados para o CRM"))
                return

            if status in ("failed", "error", "cancelled"):
                raise CommandError(f"Job falhou: {data.get('error', status)}")

        raise CommandError(f"Timeout após {max_wait}s aguardando job {ext_id}")
