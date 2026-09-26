# backend_api/Api/observabilidade/models.py
"""
Observabilidade da plataforma — o que o time de TI olha.

    Metrica            contadores por minuto: requisições da API, chamadas de IA,
                       saídas HTTP (conectores, MCP, redes sociais, integrações)
    EventoErro         erro de log agrupado por "impressão digital" (1 linha por causa)
    EstadoComponente   o último resultado de cada verificação (banco, Redis, worker,
                       IA do setor, conector, MCP, conta social, caixa de e-mail...)
    Amostra            histórico curto de cada verificação (disponibilidade 24 h / 7 dias)
    Incidente          verificação que falhou seguidas vezes — abre e fecha sozinho
    Batimento          "estou vivo" do agendador e marcação de tarefas periódicas

`tenant_id` = a empresa; `PLATAFORMA` (UUID zero) = coisa da infraestrutura,
que só a equipe da plataforma (is_staff) vê.
"""
import uuid

from django.db import models
from django.utils import timezone

PLATAFORMA = uuid.UUID(int=0)

STATUS = [
    ("ok", "Funcionando"),
    ("alerta", "Atenção"),
    ("falha", "Fora do ar"),
    ("desconhecido", "Sem dados"),
]
GRAVIDADE = [("critica", "Crítica"), ("alta", "Alta"), ("media", "Média")]


class Metrica(models.Model):
    TIPOS = [("api", "API"), ("ia", "IA"), ("http", "Saída HTTP")]

    tenant_id = models.UUIDField(default=PLATAFORMA, db_index=True)
    minuto = models.DateTimeField()
    tipo = models.CharField(max_length=10, choices=TIPOS)
    chave = models.CharField(max_length=200)
    total = models.PositiveIntegerField(default=0)
    erros = models.PositiveIntegerField(default=0)
    erros_cliente = models.PositiveIntegerField(default=0)
    ms_total = models.PositiveBigIntegerField(default=0)
    ms_max = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant_id", "minuto", "tipo", "chave"], name="metrica_unica_por_minuto"
            )
        ]
        indexes = [models.Index(fields=["tipo", "minuto"])]


class EventoErro(models.Model):
    impressao = models.CharField(max_length=40, unique=True)
    logger = models.CharField(max_length=200)
    nivel = models.CharField(max_length=20)
    mensagem = models.TextField()
    trace = models.TextField(blank=True)
    origem = models.CharField(max_length=300, blank=True)
    ocorrencias = models.PositiveIntegerField(default=1)
    primeiro = models.DateTimeField(default=timezone.now)
    ultimo = models.DateTimeField(default=timezone.now, db_index=True)
    resolvido = models.BooleanField(default=False)

    class Meta:
        ordering = ["-ultimo"]


class EstadoComponente(models.Model):
    tenant_id = models.UUIDField(default=PLATAFORMA, db_index=True)
    chave = models.CharField(max_length=150)
    grupo = models.CharField(max_length=30)
    nome = models.CharField(max_length=200)
    status = models.CharField(max_length=15, choices=STATUS, default="desconhecido")
    detalhe = models.TextField(blank=True)
    causa = models.TextField(blank=True, help_text="Por que (em português, pra gente).")
    acao = models.TextField(blank=True, help_text="O que fazer.")
    dados = models.JSONField(default=dict, blank=True)
    ms = models.PositiveIntegerField(null=True, blank=True)
    falhas_seguidas = models.PositiveIntegerField(default=0)
    desde = models.DateTimeField(default=timezone.now)
    verificado_em = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["grupo", "nome"]
        constraints = [
            models.UniqueConstraint(fields=["tenant_id", "chave"], name="estado_unico_por_chave")
        ]


class Amostra(models.Model):
    tenant_id = models.UUIDField(default=PLATAFORMA)
    chave = models.CharField(max_length=150)
    em = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=15, choices=STATUS)
    ms = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["tenant_id", "chave", "em"])]


class Incidente(models.Model):
    tenant_id = models.UUIDField(default=PLATAFORMA, db_index=True)
    chave = models.CharField(max_length=150)
    grupo = models.CharField(max_length=30)
    titulo = models.CharField(max_length=255)
    gravidade = models.CharField(max_length=10, choices=GRAVIDADE, default="alta")
    status = models.CharField(
        max_length=15, choices=[("aberto", "Aberto"), ("resolvido", "Resolvido")], default="aberto"
    )
    aberto_em = models.DateTimeField(default=timezone.now)
    resolvido_em = models.DateTimeField(null=True, blank=True)
    detalhe = models.TextField(blank=True)
    causa = models.TextField(blank=True)
    acao = models.TextField(blank=True)
    dados = models.JSONField(default=dict, blank=True)
    diagnostico = models.JSONField(default=dict, blank=True)
    chamado_id = models.PositiveIntegerField(null=True, blank=True)
    reconhecido_por = models.CharField(max_length=255, blank=True)
    reconhecido_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-aberto_em"]
        indexes = [models.Index(fields=["tenant_id", "status"])]

    @property
    def duracao_min(self) -> int:
        fim = self.resolvido_em or timezone.now()
        return int((fim - self.aberto_em).total_seconds() // 60)


class Batimento(models.Model):
    nome = models.CharField(max_length=200, unique=True)
    em = models.DateTimeField(default=timezone.now)
    dados = models.JSONField(default=dict, blank=True)
