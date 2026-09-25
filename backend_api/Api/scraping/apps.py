from django.apps import AppConfig


class ScrapingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "scraping"

    def ready(self):
        from orchestration.registry import register_query_function

        @register_query_function(
            name="contar_jobs_scraping",
            description="Retorna quantos jobs de scraping existem por status para o tenant.",
            parameters={"status": "string (pending/running/done/failed) ou 'all'"},
            risk="low",
        )
        def contar_jobs_scraping(tenant_id, status: str = "all") -> dict:
            from scraping.models import ScrapingJob
            qs = ScrapingJob.objects.filter(tenant_id=tenant_id)
            if status != "all":
                qs = qs.filter(status=status)
            return {"total": qs.count(), "status_filtro": status}
