# backend_api/Api/marketing/models.py
"""
Vertical Marketing — time de conteúdo que serve pra qualquer ramo.

    PerfilMarca (1 por empresa: ramo, público, tom, pilares, cores, logo)
    AplicativoRede (client id/secret do app OAuth de cada rede) ─ ContaSocial
    Midia (imagem/vídeo: upload, criativo gerado, corte, vídeo IA)
    Publicacao ── Destino (1 por conta: texto da rede, status, link publicado)
    JobVideo (cortes de um vídeo longo / vídeo curto pelo MoneyPrinterTurbo)

A IA escreve, planeja e corta — PUBLICAR é decisão de pessoa (aprovar):
nenhum agente publica sozinho (CLAUDE.md §12).
"""
import uuid

from django.db import models
from django.utils import timezone

from core.mixins import AuditMixin, SoftDeleteMixin, TenantMixin
from harness.crypto import decrypt_secret, encrypt_secret

REDES = [
    ("instagram", "Instagram"),
    ("tiktok", "TikTok"),
    ("youtube", "YouTube"),
    ("facebook", "Facebook"),
    ("linkedin", "LinkedIn"),
    ("x", "X (Twitter)"),
    ("discord", "Discord"),
    ("twitch", "Twitch"),
]

# Rede → app OAuth (Instagram e Facebook usam o mesmo app da Meta; YouTube, o Google)
PROVEDOR_OAUTH = {
    "instagram": "meta",
    "facebook": "meta",
    "youtube": "google",
    "tiktok": "tiktok",
    "linkedin": "linkedin",
    "x": "x",
    "twitch": "twitch",
}
PROVEDORES = [
    ("meta", "Meta (Instagram + Facebook)"),
    ("google", "Google (YouTube)"),
    ("tiktok", "TikTok"),
    ("linkedin", "LinkedIn"),
    ("x", "X (Twitter)"),
    ("twitch", "Twitch"),
]


def _arquivo(instance, filename):
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "bin").lower()[:5]
    hoje = timezone.now()
    return f"marketing/{instance.tenant_id}/{hoje:%Y/%m}/{uuid.uuid4().hex}.{ext}"


class PerfilMarca(TenantMixin, AuditMixin, models.Model):
    """O briefing permanente que todo agente do time lê antes de escrever."""

    nome = models.CharField(max_length=120, blank=True)
    ramo = models.CharField(max_length=60, blank=True)
    descricao = models.TextField(blank=True, help_text="O que a empresa faz, em 2-3 frases.")
    publico_alvo = models.TextField(blank=True)
    tom_de_voz = models.CharField(max_length=255, blank=True)
    pilares = models.JSONField(default=list, blank=True)
    diferenciais = models.TextField(blank=True)
    evitar = models.TextField(blank=True, help_text="Palavras, promessas e assuntos proibidos.")
    hashtags = models.CharField(max_length=500, blank=True)
    cta_padrao = models.CharField(max_length=255, blank=True)
    site = models.URLField(blank=True)
    idioma = models.CharField(max_length=10, default="pt-BR")
    cor_primaria = models.CharField(max_length=7, default="#10b981")
    cor_secundaria = models.CharField(max_length=7, default="#161412")
    cor_texto = models.CharField(max_length=7, default="#ffffff")
    logo = models.FileField(upload_to=_arquivo, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant_id"], name="perfil_marca_unico_por_tenant")
        ]

    def __str__(self):
        return self.nome or "Perfil da marca"


class AplicativoRede(TenantMixin, AuditMixin, models.Model):
    """Client ID/Secret do app criado no portal de desenvolvedor de cada rede."""

    provedor = models.CharField(max_length=20, choices=PROVEDORES)
    client_id = models.CharField(max_length=255)
    _client_secret = models.TextField(blank=True, db_column="client_secret_encrypted")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant_id", "provedor"], name="aplicativo_rede_unico_por_tenant"
            )
        ]

    @property
    def client_secret(self) -> str:
        return decrypt_secret(self._client_secret) if self._client_secret else ""

    @client_secret.setter
    def client_secret(self, value: str) -> None:
        self._client_secret = encrypt_secret(value) if value else ""


class ContaSocial(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    STATUS_CHOICES = [
        ("conectada", "Conectada"),
        ("erro", "Com erro"),
        ("expirada", "Token expirado"),
    ]

    rede = models.CharField(max_length=20, choices=REDES)
    nome = models.CharField(max_length=255)
    usuario = models.CharField(max_length=255, blank=True)
    conta_id = models.CharField(max_length=255, help_text="Id da conta/página/canal na rede.")
    url = models.URLField(blank=True)
    _token = models.TextField(blank=True, db_column="token_encrypted")
    _refresh = models.TextField(blank=True, db_column="refresh_encrypted")
    expira_em = models.DateTimeField(null=True, blank=True)
    escopos = models.CharField(max_length=500, blank=True)
    # Específico da rede: página do Instagram, privacidade do YouTube, modo do TikTok...
    config = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="conectada")
    mensagem = models.CharField(max_length=500, blank=True)
    ultimo_teste = models.DateTimeField(null=True, blank=True)
    conectada_por = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["rede", "nome"]

    def __str__(self):
        return f"{self.get_rede_display()} · {self.nome}"

    @property
    def token(self) -> str:
        return decrypt_secret(self._token) if self._token else ""

    @token.setter
    def token(self, value: str) -> None:
        self._token = encrypt_secret(value) if value else ""

    @property
    def refresh_token(self) -> str:
        return decrypt_secret(self._refresh) if self._refresh else ""

    @refresh_token.setter
    def refresh_token(self, value: str) -> None:
        self._refresh = encrypt_secret(value) if value else ""


class OAuthPendente(TenantMixin, models.Model):
    """`state` de um login OAuth em andamento — o verificador PKCE fica só aqui."""

    state = models.CharField(max_length=64, unique=True)
    provedor = models.CharField(max_length=20, choices=PROVEDORES)
    verificador = models.CharField(max_length=128, blank=True)
    redirect_uri = models.URLField()
    usuario = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(default=timezone.now)


class JobVideo(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [("cortes", "Cortes de vídeo"), ("video_ia", "Vídeo curto com IA")]
    STATUS_CHOICES = [
        ("na_fila", "Na fila"),
        ("baixando", "Baixando"),
        ("transcrevendo", "Transcrevendo"),
        ("analisando", "Escolhendo os melhores trechos"),
        ("cortando", "Cortando"),
        ("gerando", "Gerando vídeo"),
        ("concluido", "Concluído"),
        ("erro", "Erro"),
    ]

    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="na_fila")
    progresso = models.PositiveSmallIntegerField(default=0)
    etapa = models.CharField(max_length=255, blank=True)
    titulo = models.CharField(max_length=255, blank=True)
    origem_url = models.URLField(blank=True)
    origem_midia = models.ForeignKey(
        "Midia", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    direitos_confirmados = models.BooleanField(default=False)
    parametros = models.JSONField(default=dict, blank=True)
    transcricao = models.JSONField(default=list, blank=True)
    resultado = models.JSONField(default=dict, blank=True)
    externo_id = models.CharField(max_length=100, blank=True)
    erro = models.TextField(blank=True)
    agente = models.ForeignKey(
        "agency.Agent", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    criado_por = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    concluido_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class Midia(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [("imagem", "Imagem"), ("video", "Vídeo")]
    ORIGEM_CHOICES = [
        ("upload", "Enviada"),
        ("criativo", "Criativo gerado"),
        ("corte", "Corte de vídeo"),
        ("video_ia", "Vídeo IA (MoneyPrinterTurbo)"),
    ]

    tipo = models.CharField(max_length=10, choices=TIPO_CHOICES)
    origem = models.CharField(max_length=20, choices=ORIGEM_CHOICES, default="upload")
    titulo = models.CharField(max_length=255, blank=True)
    arquivo = models.FileField(upload_to=_arquivo)
    miniatura = models.FileField(upload_to=_arquivo, blank=True)
    formato = models.CharField(max_length=30, blank=True)
    largura = models.PositiveIntegerField(default=0)
    altura = models.PositiveIntegerField(default=0)
    duracao = models.FloatField(default=0)
    tamanho = models.PositiveBigIntegerField(default=0)
    mime = models.CharField(max_length=60, blank=True)
    sha256 = models.CharField(max_length=64, blank=True)
    legenda_sugerida = models.TextField(blank=True)
    dados = models.JSONField(default=dict, blank=True)
    job = models.ForeignKey(
        JobVideo, on_delete=models.SET_NULL, null=True, blank=True, related_name="midias"
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.titulo or f"Mídia {self.pk}"


class Publicacao(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    STATUS_CHOICES = [
        ("rascunho", "Rascunho"),
        ("revisao", "Aguardando aprovação"),
        ("agendada", "Agendada"),
        ("publicando", "Publicando"),
        ("publicada", "Publicada"),
        ("parcial", "Publicada em parte"),
        ("erro", "Falhou"),
        ("cancelada", "Cancelada"),
    ]
    FORMATO_CHOICES = [
        ("post", "Post"),
        ("carrossel", "Carrossel"),
        ("reels", "Reels / Short / TikTok"),
        ("video", "Vídeo"),
        ("story", "Story"),
        ("texto", "Só texto"),
    ]

    titulo = models.CharField(max_length=255)
    texto = models.TextField(blank=True)
    pilar = models.CharField(max_length=100, blank=True)
    formato = models.CharField(max_length=20, choices=FORMATO_CHOICES, default="post")
    gancho = models.CharField(max_length=500, blank=True)
    hashtags = models.CharField(max_length=500, blank=True)
    link = models.URLField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="rascunho")
    agendada_para = models.DateTimeField(null=True, blank=True)
    midias = models.ManyToManyField(Midia, blank=True, related_name="publicacoes")
    escrita_por_ia = models.BooleanField(default=False)
    agente = models.ForeignKey(
        "agency.Agent", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    fontes = models.JSONField(default=list, blank=True)
    ideia_visual = models.TextField(blank=True)
    aprovada_por = models.CharField(max_length=255, blank=True)
    aprovada_em = models.DateTimeField(null=True, blank=True)
    publicada_em = models.DateTimeField(null=True, blank=True)
    observacoes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["agendada_para", "-created_at"]

    def __str__(self):
        return self.titulo


class Destino(TenantMixin, models.Model):
    """Uma publicação numa conta: texto próprio da rede e o resultado."""

    STATUS_CHOICES = [
        ("pendente", "Pendente"),
        ("publicando", "Publicando"),
        ("publicado", "Publicado"),
        ("erro", "Erro"),
    ]

    publicacao = models.ForeignKey(Publicacao, on_delete=models.CASCADE, related_name="destinos")
    conta = models.ForeignKey(ContaSocial, on_delete=models.CASCADE, related_name="destinos")
    texto = models.TextField(blank=True, help_text="Vazio = usa o texto da publicação.")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pendente")
    externo_id = models.CharField(max_length=255, blank=True)
    url = models.URLField(blank=True, max_length=500)
    erro = models.TextField(blank=True)
    tentativas = models.PositiveSmallIntegerField(default=0)
    publicado_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["publicacao", "conta"], name="destino_unico_por_conta")
        ]
