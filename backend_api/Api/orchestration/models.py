# backend_api/Api/orchestration/models.py
"""
QueryLog: todo request de IA sobre dado estruturado fica registrado.

Isso não é telemetria opcional — é o que torna o sistema auditável e
"trustworthy" no sentido do EU AI Act / GenAI4EU: qualquer resposta que a
IA deu pode ser reconstruída depois (que função foi chamada, com quais
parâmetros, qual modelo respondeu, quanto tempo levou, se houve erro).
Também é a base para revisão humana (human-in-the-loop) de decisões
sensíveis tomadas com apoio da IA.
"""
from django.conf import settings
from django.db import models
from django.utils import timezone

from core.mixins import TenantMixin


class QueryLog(TenantMixin, models.Model):
    class Status(models.TextChoices):
        OK = "ok", "Sucesso"
        FUNCTION_ERROR = "function_error", "Erro ao executar função"
        LLM_ERROR = "llm_error", "Erro no modelo de IA"
        REJECTED = "rejected", "Função não encontrada/negada"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    question = models.TextField()
    model_category = models.CharField(max_length=20, blank=True)
    model_name = models.CharField(max_length=100, blank=True)
    function_called = models.CharField(max_length=150, blank=True)
    function_params = models.JSONField(default=dict, blank=True)
    function_result = models.JSONField(default=dict, blank=True)
    answer = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OK)
    error_message = models.TextField(blank=True)
    latency_ms = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["tenant_id", "created_at"])]

    def __str__(self):
        return f"[{self.status}] {self.question[:60]}"
