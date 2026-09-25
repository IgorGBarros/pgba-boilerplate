from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from django_filters.rest_framework import DjangoFilterBackend

from core.mixins import TenantContextMixin
from scraping.models import ScrapingJob
from scraping.serializers import (
    ScrapingJobSerializer,
    GoogleMapsJobCreateSerializer,
    UrlScrapeCreateSerializer,
    ImportToCRMSerializer,
)
from scraping.services import gmaps_list_jobs, import_results_to_crm
from scraping.tasks import run_google_maps_job, run_url_scrape_job


class ScrapingJobViewSet(TenantContextMixin, ModelViewSet):
    """
    CRUD de jobs de scraping + ações especiais.

    POST /scraping/jobs/google-maps/   → cria job Google Maps
    POST /scraping/jobs/url/           → cria job URL
    GET  /scraping/jobs/               → lista jobs do tenant
    GET  /scraping/jobs/{id}/          → detalhe + resultados
    POST /scraping/jobs/{id}/import/   → importa resultados como Leads no CRM
    GET  /scraping/google-maps-status/ → verifica se o container está ativo
    """

    serializer_class = ScrapingJobSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["job_type", "status"]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        return ScrapingJob.objects.filter(
            tenant_id=self.request.tenant_id,
            deleted_at__isnull=True,
        )

    @action(detail=False, methods=["post"], url_path="google-maps")
    def google_maps(self, request):
        ser = GoogleMapsJobCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        job = ScrapingJob.objects.create(
            tenant_id=request.tenant_id,
            job_type=ScrapingJob.JobType.GOOGLE_MAPS,
            query=d["query"],
            lat=d.get("lat", ""),
            lng=d.get("lng", ""),
            depth=d.get("depth", 5),
        )

        run_google_maps_job.delay(job.id)

        return Response(
            {
                "job_id": job.id,
                "status": job.status,
                "message": "Job criado. Consulte GET /scraping/jobs/{id}/ para acompanhar.",
                "auto_import": d.get("auto_import_to_crm", False),
                "pipeline_id": d.get("pipeline_id"),
            },
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=False, methods=["post"], url_path="url")
    def url_scrape(self, request):
        ser = UrlScrapeCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        job = ScrapingJob.objects.create(
            tenant_id=request.tenant_id,
            job_type=ScrapingJob.JobType.URL,
            query=d["url"],
            extraction_schema=d.get("schema") or None,
        )

        run_url_scrape_job.delay(job.id)

        return Response(
            {
                "job_id": job.id,
                "status": job.status,
                "message": "Extração iniciada. Consulte GET /scraping/jobs/{id}/ para o resultado.",
            },
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["post"], url_path="import")
    def import_to_crm(self, request, pk=None):
        job = self.get_object()

        if job.status not in (ScrapingJob.Status.DONE, ScrapingJob.Status.RUNNING):
            return Response(
                {"error": f"Job ainda não tem resultados (status: {job.status})."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not job.results:
            return Response(
                {"error": "Nenhum resultado disponível para importar ainda."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ser = ImportToCRMSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        count = import_results_to_crm(job, pipeline_id=ser.validated_data.get("pipeline_id"))
        return Response({"imported": count, "message": f"{count} leads importados para o CRM."})

    @action(detail=True, methods=["post"], url_path="retry")
    def retry(self, request, pk=None):
        """Reinicia um job travado em running ou failed."""
        job = self.get_object()

        if job.status == ScrapingJob.Status.DONE:
            return Response(
                {"error": "Job já concluído."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        job.status = ScrapingJob.Status.PENDING
        job.error_message = ""
        job.external_job_id = None
        job.results = []
        job.result_count = 0
        job.save(update_fields=["status", "error_message", "external_job_id", "results", "result_count", "updated_at"])

        run_google_maps_job.delay(job.id)
        return Response({"job_id": job.id, "status": job.status, "message": "Job reiniciado."})

    @action(detail=False, methods=["get"], url_path="google-maps-status")
    def google_maps_status(self, request):
        try:
            jobs = gmaps_list_jobs()
            return Response({"online": True, "jobs_count": len(jobs)})
        except Exception as exc:
            return Response(
                {
                    "online": False,
                    "error": str(exc),
                    "hint": (
                        "Inicie o container: docker compose up -d gmaps-scraper\n"
                        "Ou configure GMAPS_SCRAPER_URL no .env"
                    ),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
