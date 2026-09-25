from rest_framework import serializers
from scraping.models import ScrapingJob


class ScrapingJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScrapingJob
        fields = [
            "id", "job_type", "status", "query", "lat", "lng", "depth",
            "extraction_schema", "result_count", "results", "error_message",
            "external_job_id", "imported_to_crm", "imported_count",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "status", "result_count", "results", "error_message",
            "external_job_id", "imported_to_crm", "imported_count",
            "created_at", "updated_at",
        ]


class GoogleMapsJobCreateSerializer(serializers.Serializer):
    query = serializers.CharField(
        max_length=500,
        help_text='Ex: "padarias em Salvador BA"',
    )
    lat = serializers.CharField(
        max_length=30, required=False, default="", allow_blank=True,
        help_text="Latitude (opcional — preenchida automaticamente por geocode se omitida)",
    )
    lng = serializers.CharField(
        max_length=30, required=False, default="", allow_blank=True,
        help_text="Longitude (opcional)",
    )
    depth = serializers.IntegerField(
        min_value=1, max_value=20, default=5,
        help_text="Profundidade de busca (1-20). Comece com 5.",
    )
    auto_import_to_crm = serializers.BooleanField(
        default=False,
        help_text="Importar resultados como Leads no CRM ao concluir",
    )
    pipeline_id = serializers.IntegerField(
        required=False, allow_null=True, default=None,
        help_text="ID do pipeline CRM para importação (opcional)",
    )


class UrlScrapeCreateSerializer(serializers.Serializer):
    url = serializers.URLField(
        help_text="URL da página a ser extraída",
    )
    schema = serializers.DictField(
        child=serializers.CharField(),
        required=False, default=None,
        help_text='Schema de extração, ex: {"nome": "string", "preco": "string"}',
    )
    schema_preset = serializers.ChoiceField(
        choices=["lead", "produto", "contato"],
        required=False, default=None,
        help_text="Preset de schema: lead | produto | contato",
    )


class ImportToCRMSerializer(serializers.Serializer):
    pipeline_id = serializers.IntegerField(
        required=False, allow_null=True, default=None,
    )
