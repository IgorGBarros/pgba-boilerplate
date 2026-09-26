# backend_api/Api/juridico/models.py
"""
Vertical Jurídico — ideias dos sistemas jurídicos profissionais (contencioso,
agenda de prazos, gestão de contratos/CLM, GED com modelos e assinatura
eletrônica), adaptadas à plataforma. Nada copiado de nenhum deles.

    Processo (número CNJ) ─┬─ Andamento (manual ou DataJud/CNJ)
                           ├─ Prazo (dias úteis / corridos, CPC 219/220/224)
                           └─ Documento ─── SolicitacaoAssinatura ─── Signatario
    Contrato (ciclo: rascunho → revisão → assinatura → vigente → renovação)
    ModeloDocumento ({{campos}} → Documento)
"""
from django.db import models
from django.utils import timezone

from core.mixins import AuditMixin, SoftDeleteMixin, TenantMixin


class Processo(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [
        ("trabalhista", "Trabalhista"),
        ("civel", "Cível"),
        ("criminal", "Criminal"),
        ("tributario", "Tributário"),
        ("contratual", "Contratual"),
        ("regulatorio", "Regulatório"),
        ("consumidor", "Consumidor"),
        ("administrativo", "Administrativo"),
        ("outro", "Outro"),
    ]
    STATUS_CHOICES = [
        ("em_andamento", "Em andamento"),
        ("suspenso", "Suspenso"),
        ("ganho", "Ganho"),
        ("perdido", "Perdido"),
        ("acordo", "Acordo"),
        ("arquivado", "Arquivado"),
    ]
    RISCO_CHOICES = [
        ("alto", "Alto"),
        ("medio", "Médio"),
        ("baixo", "Baixo"),
    ]
    # CPC 25 / IAS 37: provável → provisiona; possível → só divulga; remota → nada
    PROBABILIDADE_CHOICES = [
        ("provavel", "Provável"),
        ("possivel", "Possível"),
        ("remota", "Remota"),
    ]
    POLO_CHOICES = [
        ("ativo", "Autor (polo ativo)"),
        ("passivo", "Réu (polo passivo)"),
        ("terceiro", "Terceiro"),
    ]
    INSTANCIA_CHOICES = [
        ("1", "1ª instância"),
        ("2", "2ª instância"),
        ("superior", "Tribunal superior"),
    ]
    FASE_CHOICES = [
        ("conhecimento", "Conhecimento"),
        ("recursal", "Recursal"),
        ("execucao", "Execução / cumprimento"),
        ("encerrado", "Encerrado"),
    ]

    titulo = models.CharField(max_length=255)
    numero_cnj = models.CharField(
        max_length=25, blank=True, db_index=True, help_text="NNNNNNN-DD.AAAA.J.TR.OOOO"
    )
    tipo = models.CharField(max_length=30, choices=TIPO_CHOICES, default="civel")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="em_andamento")
    fase = models.CharField(max_length=20, choices=FASE_CHOICES, default="conhecimento")
    instancia = models.CharField(max_length=10, choices=INSTANCIA_CHOICES, default="1")
    polo = models.CharField(max_length=10, choices=POLO_CHOICES, default="passivo")
    cliente = models.ForeignKey(
        "erp.ParceiroNegocio",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="processos",
    )
    parte = models.CharField(max_length=200, help_text="Parte representada (texto livre).")
    parte_contraria = models.CharField(max_length=200, blank=True)
    advogado = models.CharField(max_length=200, blank=True)
    tribunal = models.CharField(
        max_length=20, blank=True, help_text="Sigla DataJud, ex.: tjsp, trt2"
    )
    foro = models.CharField(max_length=100, blank=True, help_text="Comarca / seção judiciária")
    orgao_julgador = models.CharField(max_length=200, blank=True, help_text="Vara / câmara / turma")
    classe = models.CharField(max_length=200, blank=True)
    assunto = models.CharField(max_length=255, blank=True)
    data_distribuicao = models.DateField(null=True, blank=True)
    risco = models.CharField(max_length=10, choices=RISCO_CHOICES, default="medio")
    probabilidade_perda = models.CharField(
        max_length=10, choices=PROBABILIDADE_CHOICES, default="possivel"
    )
    valor_causa = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    valor_estimado_perda = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
        help_text="Quanto a empresa pode pagar se perder (base da provisão).",
    )
    prazo_proximo = models.DateField(null=True, blank=True)
    observacoes = models.TextField(blank=True)
    ultima_sincronizacao = models.DateTimeField(null=True, blank=True)
    sincronizacao_msg = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "prazo_proximo"]),
        ]

    def __str__(self):
        return self.titulo

    @property
    def valor_provisionado(self):
        """CPC 25: só perda PROVÁVEL vira provisão contábil."""
        return self.valor_estimado_perda if self.probabilidade_perda == "provavel" else 0


class Andamento(TenantMixin, SoftDeleteMixin, models.Model):
    """Movimentação do processo — digitada ou capturada do DataJud (CNJ)."""

    ORIGEM_CHOICES = [("manual", "Manual"), ("datajud", "DataJud (CNJ)")]

    processo = models.ForeignKey(Processo, on_delete=models.CASCADE, related_name="andamentos")
    data = models.DateTimeField(default=timezone.now)
    descricao = models.TextField()
    origem = models.CharField(max_length=10, choices=ORIGEM_CHOICES, default="manual")
    # Evita duplicar o mesmo movimento a cada sincronização
    chave = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-data"]
        constraints = [
            models.UniqueConstraint(
                fields=["processo", "chave"],
                condition=~models.Q(chave=""),
                name="uniq_andamento_chave_por_processo",
            )
        ]

    def __str__(self):
        return f"{self.data:%d/%m/%Y} — {self.descricao[:60]}"


class Contrato(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [
        ("servico", "Serviço"),
        ("fornecimento", "Fornecimento"),
        ("locacao", "Locação"),
        ("parceria", "Parceria"),
        ("nda", "NDA"),
        ("trabalhista", "Trabalhista"),
        ("outro", "Outro"),
    ]
    # Ciclo de vida (CLM): rascunho → revisão → assinatura → vigente → renovação/encerramento
    STATUS_CHOICES = [
        ("rascunho", "Rascunho"),
        ("em_revisao", "Em revisão"),
        ("aguardando_assinatura", "Aguardando assinatura"),
        ("vigente", "Vigente"),
        ("expirando", "Expirando"),
        ("vencido", "Vencido"),
        ("negociacao", "Em negociação"),
        ("cancelado", "Cancelado"),
    ]
    RENOVACAO_CHOICES = [
        ("automatica", "Automática"),
        ("negociacao", "Negociação"),
        ("nao_renovar", "Não renovar"),
    ]

    titulo = models.CharField(max_length=255)
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES, default="servico")
    parceiro = models.ForeignKey(
        "erp.ParceiroNegocio",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contratos_juridicos",
    )
    partes = models.CharField(max_length=300)
    responsavel = models.CharField(max_length=200, blank=True)
    data_inicio = models.DateField()
    data_fim = models.DateField(null=True, blank=True)
    aviso_dias = models.PositiveIntegerField(
        default=30, help_text="Avisar quantos dias antes do fim."
    )
    indice_reajuste = models.CharField(max_length=30, blank=True, help_text="IPCA, IGP-M...")
    valor_anual = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=25, choices=STATUS_CHOICES, default="vigente")
    renovacao = models.CharField(max_length=20, choices=RENOVACAO_CHOICES, default="negociacao")
    observacoes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "data_fim"]),
        ]

    def __str__(self):
        return self.titulo


class Prazo(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [
        ("audiencia", "Audiência"),
        ("peca_processual", "Peça processual"),
        ("contrato", "Contrato"),
        ("administrativo", "Administrativo"),
        ("outro", "Outro"),
    ]
    URGENCIA_CHOICES = [
        ("critica", "Crítica"),
        ("alta", "Alta"),
        ("media", "Média"),
        ("baixa", "Baixa"),
    ]
    CONTAGEM_CHOICES = [("uteis", "Dias úteis (CPC)"), ("corridos", "Dias corridos")]

    titulo = models.CharField(max_length=255)
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES, default="administrativo")
    prazo = models.DateField()
    # Se preenchidos, `prazo` foi calculado: intimação em `data_inicio` + `dias`
    data_inicio = models.DateField(null=True, blank=True)
    dias = models.PositiveIntegerField(null=True, blank=True)
    contagem = models.CharField(max_length=10, choices=CONTAGEM_CHOICES, default="uteis")
    urgencia = models.CharField(max_length=10, choices=URGENCIA_CHOICES, default="media")
    responsavel = models.CharField(max_length=200, blank=True)
    descricao = models.TextField(blank=True)
    processo = models.ForeignKey(
        Processo, on_delete=models.SET_NULL, null=True, blank=True, related_name="prazos"
    )
    contrato = models.ForeignKey(
        Contrato, on_delete=models.SET_NULL, null=True, blank=True, related_name="prazos"
    )
    concluido = models.BooleanField(default=False)
    concluido_em = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["prazo"]
        indexes = [
            models.Index(fields=["tenant_id", "prazo"]),
            models.Index(fields=["tenant_id", "urgencia"]),
        ]

    def __str__(self):
        return self.titulo


# ─── Documentos e modelos ────────────────────────────────────────────────────

DOC_TIPOS = [
    ("contrato", "Contrato"),
    ("procuracao", "Procuração"),
    ("peticao", "Petição"),
    ("notificacao", "Notificação"),
    ("parecer", "Parecer"),
    ("ata", "Ata"),
    ("termo", "Termo / declaração"),
    ("outro", "Outro"),
]


class ModeloDocumento(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    """Modelo com campos `{{empresa.razao_social}}`, `{{parte.nome}}`... (ver juridico.modelos)."""

    nome = models.CharField(max_length=200)
    tipo = models.CharField(max_length=20, choices=DOC_TIPOS, default="contrato")
    descricao = models.CharField(max_length=300, blank=True)
    corpo = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["nome"]

    def __str__(self):
        return self.nome


def _doc_path(instance, filename):
    # Nunca servido direto por /media: só pelas views (autenticada ou link de assinatura)
    return f"juridico/{instance.tenant_id}/{timezone.now():%Y/%m}/{filename}"


class Documento(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    STATUS_CHOICES = [
        ("rascunho", "Rascunho"),
        ("final", "Versão final"),
        ("em_assinatura", "Em assinatura"),
        ("assinado", "Assinado"),
    ]

    titulo = models.CharField(max_length=255)
    tipo = models.CharField(max_length=20, choices=DOC_TIPOS, default="outro")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="rascunho")
    processo = models.ForeignKey(
        Processo, on_delete=models.SET_NULL, null=True, blank=True, related_name="documentos"
    )
    contrato = models.ForeignKey(
        Contrato, on_delete=models.SET_NULL, null=True, blank=True, related_name="documentos"
    )
    modelo = models.ForeignKey(
        ModeloDocumento, on_delete=models.SET_NULL, null=True, blank=True, related_name="documentos"
    )
    # Documento gerado de modelo (texto) OU arquivo enviado (PDF)
    conteudo = models.TextField(blank=True)
    arquivo = models.FileField(upload_to=_doc_path, blank=True)
    nome_arquivo = models.CharField(max_length=255, blank=True)
    tamanho = models.PositiveIntegerField(default=0)
    sha256 = models.CharField(max_length=64, blank=True)
    versao = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.titulo


# ─── Assinatura eletrônica ───────────────────────────────────────────────────


class SolicitacaoAssinatura(TenantMixin, AuditMixin, models.Model):
    """
    Envelope de assinatura (no sentido do DocuSign): um documento congelado
    (PDF + SHA-256) e os signatários. `provedor="interno"` = assinatura
    eletrônica da própria plataforma (juridico.assinatura); outros provedores
    (Clicksign, ZapSign, D4Sign, DocuSeal...) entram pelo mesmo modelo.
    """

    STATUS_CHOICES = [
        ("rascunho", "Rascunho"),
        ("enviada", "Enviada"),
        ("concluida", "Concluída"),
        ("recusada", "Recusada"),
        ("cancelada", "Cancelada"),
        ("expirada", "Expirada"),
    ]

    documento = models.ForeignKey(Documento, on_delete=models.PROTECT, related_name="assinaturas")
    titulo = models.CharField(max_length=255)
    mensagem = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="rascunho")
    provedor = models.CharField(max_length=20, default="interno")
    provedor_ref = models.CharField(max_length=120, blank=True)
    exigir_codigo_email = models.BooleanField(default=True)
    ordem_sequencial = models.BooleanField(default=False)
    expira_em = models.DateTimeField(null=True, blank=True)
    pdf_original = models.FileField(upload_to=_doc_path, blank=True)
    hash_original = models.CharField(max_length=64, blank=True)
    arquivo_assinado = models.FileField(upload_to=_doc_path, blank=True)
    hash_assinado = models.CharField(max_length=64, blank=True, db_index=True)
    enviada_em = models.DateTimeField(null=True, blank=True)
    concluida_em = models.DateTimeField(null=True, blank=True)
    criado_por = models.CharField(max_length=150, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.titulo


class Signatario(TenantMixin, models.Model):
    PAPEL_CHOICES = [
        ("parte", "Parte"),
        ("testemunha", "Testemunha"),
        ("aprovador", "Aprovador"),
        ("representante", "Representante legal"),
    ]
    STATUS_CHOICES = [
        ("pendente", "Pendente"),
        ("visualizou", "Visualizou"),
        ("assinou", "Assinou"),
        ("recusou", "Recusou"),
    ]

    solicitacao = models.ForeignKey(
        SolicitacaoAssinatura, on_delete=models.CASCADE, related_name="signatarios"
    )
    nome = models.CharField(max_length=200)
    email = models.EmailField()
    cpf_encrypted = models.TextField(blank=True)
    cpf_mascarado = models.CharField(max_length=20, blank=True)
    papel = models.CharField(max_length=15, choices=PAPEL_CHOICES, default="parte")
    ordem = models.PositiveIntegerField(default=1)
    # Link individual: só o hash serve pra achar; a cópia cifrada serve pra reenviar/copiar
    token_hash = models.CharField(max_length=64, unique=True)
    token_encrypted = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="pendente")
    codigo_hash = models.CharField(max_length=64, blank=True)
    codigo_expira_em = models.DateTimeField(null=True, blank=True)
    codigo_tentativas = models.PositiveIntegerField(default=0)
    codigo_verificado = models.BooleanField(default=False)
    convite_enviado_em = models.DateTimeField(null=True, blank=True)
    visualizado_em = models.DateTimeField(null=True, blank=True)
    assinado_em = models.DateTimeField(null=True, blank=True)
    nome_assinatura = models.CharField(max_length=200, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    recusa_motivo = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["ordem", "id"]

    def __str__(self):
        return f"{self.nome} <{self.email}>"


class EventoAssinatura(TenantMixin, models.Model):
    """
    Trilha de auditoria — só acrescenta. Cada evento guarda o hash do anterior
    (`hash_encadeado`), então apagar ou editar um evento quebra a corrente.
    """

    solicitacao = models.ForeignKey(
        SolicitacaoAssinatura, on_delete=models.CASCADE, related_name="eventos"
    )
    signatario = models.ForeignKey(
        Signatario, on_delete=models.SET_NULL, null=True, blank=True, related_name="eventos"
    )
    tipo = models.CharField(max_length=30)
    detalhe = models.CharField(max_length=500, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    hash_encadeado = models.CharField(max_length=64)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at", "id"]
