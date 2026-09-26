from django.db import models
from django.utils import timezone
from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


class Ticket(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    CATEGORIA_CHOICES = [
        ("hardware", "Hardware"),
        ("software", "Software"),
        ("rede", "Rede"),
        ("acesso", "Acesso"),
        ("mobile", "Mobile"),
        ("infraestrutura", "Infraestrutura"),
        ("equipamento", "Equipamento"),
        ("sistema", "Sistema (PGBA)"),
        ("banco", "Banco de dados"),
        ("integracao", "Integração / API / MCP"),
        ("ia", "IA / agentes"),
        ("outro", "Outro"),
    ]
    PRIORIDADE_CHOICES = [
        ("critica", "Crítica"),
        ("alta", "Alta"),
        ("media", "Média"),
        ("baixa", "Baixa"),
    ]
    STATUS_CHOICES = [
        ("aberto", "Aberto"),
        ("em_atendimento", "Em atendimento"),
        ("aguardando", "Aguardando"),
        ("resolvido", "Resolvido"),
        ("fechado", "Fechado"),
    ]

    titulo = models.CharField(max_length=255)
    descricao = models.TextField(blank=True)
    solicitante = models.CharField(max_length=200)
    categoria = models.CharField(max_length=20, choices=CATEGORIA_CHOICES, default="outro")
    prioridade = models.CharField(max_length=10, choices=PRIORIDADE_CHOICES, default="media")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="aberto")
    # Positive = horas restantes antes do vencimento do SLA; negative = SLA já violado
    sla_horas = models.IntegerField(default=24)
    atendente = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    resolvido_em = models.DateTimeField(null=True, blank=True)

    ORIGEM_CHOICES = [
        ("manual", "Aberto por pessoa"),
        ("incidente", "Incidente (monitoramento)"),
        ("agente", "Aberto por agente"),
        ("email", "E-mail"),
    ]
    # Setor de quem pediu (pode ser qualquer setor) — o chamado é atendido pelo TI
    setor = models.ForeignKey(
        "agency.Sector", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Agente do TI responsável + a Task real que carrega o atendimento
    agente = models.ForeignKey(
        "agency.Agent", on_delete=models.SET_NULL, null=True, blank=True, related_name="chamados"
    )
    task = models.ForeignKey(
        "agency.Task", on_delete=models.SET_NULL, null=True, blank=True, related_name="chamados"
    )
    origem = models.CharField(max_length=12, choices=ORIGEM_CHOICES, default="manual")
    # id solto (observabilidade.Incidente) — vertical conhece core, nunca FK cruzada
    incidente_id = models.PositiveIntegerField(null=True, blank=True, db_index=True)
    primeira_resposta_em = models.DateTimeField(null=True, blank=True)
    prazo_sla = models.DateTimeField(null=True, blank=True)
    solucao = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "prioridade"]),
        ]

    def __str__(self):
        return f"{self.id} — {self.titulo}"


class EquipamentoTI(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [
        ("notebook", "Notebook"),
        ("desktop", "Desktop"),
        ("servidor", "Servidor"),
        ("switch", "Switch"),
        ("roteador", "Roteador"),
        ("impressora", "Impressora"),
        ("monitor", "Monitor"),
        ("outro", "Outro"),
    ]
    STATUS_CHOICES = [
        ("ativo", "Ativo"),
        ("manutencao", "Em manutenção"),
        ("disponivel", "Disponível"),
        ("descarte", "Descarte"),
    ]

    codigo = models.CharField(max_length=50)
    nome = models.CharField(max_length=200)
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES, default="notebook")
    usuario = models.CharField(max_length=200, blank=True)
    setor = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="ativo")
    ultima_revisao = models.DateField(null=True, blank=True)
    observacoes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["codigo"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "tipo"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant_id", "codigo"], name="uniq_equipamento_codigo_per_tenant"
            )
        ]

    def __str__(self):
        return f"{self.codigo} — {self.nome}"


class InteracaoChamado(TenantMixin, models.Model):
    """Linha do tempo do chamado: comentário de pessoa, resposta da IA ou evento do sistema."""

    TIPO_CHOICES = [
        ("comentario", "Comentário"),
        ("resposta", "Resposta ao solicitante"),
        ("ia", "Sugestão da IA"),
        ("sistema", "Sistema"),
    ]

    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="interacoes")
    tipo = models.CharField(max_length=12, choices=TIPO_CHOICES, default="comentario")
    autor = models.CharField(max_length=200, blank=True)
    texto = models.TextField()
    dados = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["tenant_id", "ticket"])]

    def __str__(self):
        return f"#{self.ticket_id} {self.tipo}"
