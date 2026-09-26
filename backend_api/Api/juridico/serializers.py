# backend_api/Api/juridico/serializers.py
from django.utils import timezone
from rest_framework import serializers

from erp.serializers import TenantFKMixin
from juridico import cnj
from juridico.models import (
    Andamento,
    Contrato,
    Documento,
    EventoAssinatura,
    ModeloDocumento,
    Prazo,
    Processo,
    Signatario,
    SolicitacaoAssinatura,
)


class ProcessoSerializer(TenantFKMixin, serializers.ModelSerializer):
    cliente_nome = serializers.CharField(source="cliente.nome", read_only=True, default="")
    valor_provisionado = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    andamentos_count = serializers.IntegerField(read_only=True, default=0)
    ultimo_andamento = serializers.SerializerMethodField()

    class Meta:
        model = Processo
        fields = [
            "id",
            "titulo",
            "numero_cnj",
            "tipo",
            "status",
            "fase",
            "instancia",
            "polo",
            "cliente",
            "cliente_nome",
            "parte",
            "parte_contraria",
            "advogado",
            "tribunal",
            "foro",
            "orgao_julgador",
            "classe",
            "assunto",
            "data_distribuicao",
            "risco",
            "probabilidade_perda",
            "valor_causa",
            "valor_estimado_perda",
            "valor_provisionado",
            "prazo_proximo",
            "observacoes",
            "ultima_sincronizacao",
            "sincronizacao_msg",
            "andamentos_count",
            "ultimo_andamento",
            "created_at",
        ]
        read_only_fields = ["id", "created_at", "ultima_sincronizacao", "sincronizacao_msg"]

    def get_ultimo_andamento(self, obj):
        a = next(iter(getattr(obj, "_prefetched_objects_cache", {}).get("andamentos", [])), None)
        if a is None:
            a = obj.andamentos.filter(is_active=True).first()
        return {"data": a.data, "descricao": a.descricao[:200], "origem": a.origem} if a else None

    def validate_numero_cnj(self, value):
        if not value:
            return ""
        try:
            numero = cnj.format_cnj(value)
        except cnj.CnjError as exc:
            raise serializers.ValidationError(str(exc))
        request = self.context.get("request")
        dup = Processo.objects.filter(
            tenant_id=getattr(request, "tenant_id", None), numero_cnj=numero, is_active=True
        )
        if self.instance:
            dup = dup.exclude(pk=self.instance.pk)
        if dup.exists():
            raise serializers.ValidationError("Já existe um processo com esse número.")
        return numero

    def validate(self, attrs):
        attrs = super().validate(attrs)
        numero = attrs.get("numero_cnj")
        if numero and not attrs.get("tribunal") and not getattr(self.instance, "tribunal", ""):
            attrs["tribunal"] = cnj.tribunal_alias(numero) or ""
        return attrs


class AndamentoSerializer(TenantFKMixin, serializers.ModelSerializer):
    class Meta:
        model = Andamento
        fields = ["id", "processo", "data", "descricao", "origem", "created_at"]
        read_only_fields = ["id", "origem", "created_at"]


class ContratoSerializer(TenantFKMixin, serializers.ModelSerializer):
    parceiro_nome = serializers.CharField(source="parceiro.nome", read_only=True, default="")
    dias_para_vencer = serializers.SerializerMethodField()

    class Meta:
        model = Contrato
        fields = [
            "id",
            "titulo",
            "tipo",
            "parceiro",
            "parceiro_nome",
            "partes",
            "responsavel",
            "data_inicio",
            "data_fim",
            "aviso_dias",
            "indice_reajuste",
            "valor_anual",
            "status",
            "renovacao",
            "observacoes",
            "dias_para_vencer",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def get_dias_para_vencer(self, obj):
        return (obj.data_fim - timezone.localdate()).days if obj.data_fim else None

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if not attrs.get("partes") and attrs.get("parceiro"):
            attrs["partes"] = attrs["parceiro"].nome
        ini = attrs.get("data_inicio", getattr(self.instance, "data_inicio", None))
        fim = attrs.get("data_fim", getattr(self.instance, "data_fim", None))
        if ini and fim and fim < ini:
            raise serializers.ValidationError({"data_fim": "O fim não pode ser antes do início."})
        return attrs


class PrazoSerializer(TenantFKMixin, serializers.ModelSerializer):
    processo_titulo = serializers.CharField(source="processo.titulo", read_only=True, default="")
    processo_numero = serializers.CharField(
        source="processo.numero_cnj", read_only=True, default=""
    )
    contrato_titulo = serializers.CharField(source="contrato.titulo", read_only=True, default="")
    dias_restantes = serializers.SerializerMethodField()

    class Meta:
        model = Prazo
        fields = [
            "id",
            "titulo",
            "tipo",
            "prazo",
            "data_inicio",
            "dias",
            "contagem",
            "urgencia",
            "responsavel",
            "descricao",
            "processo",
            "processo_titulo",
            "processo_numero",
            "contrato",
            "contrato_titulo",
            "concluido",
            "concluido_em",
            "dias_restantes",
            "created_at",
        ]
        read_only_fields = ["id", "concluido_em", "created_at"]
        extra_kwargs = {"prazo": {"required": False}}

    def get_dias_restantes(self, obj):
        return (obj.prazo - timezone.localdate()).days if obj.prazo else None

    def validate(self, attrs):
        from juridico.prazos import calcular

        attrs = super().validate(attrs)
        ini = attrs.get("data_inicio", getattr(self.instance, "data_inicio", None))
        dias = attrs.get("dias", getattr(self.instance, "dias", None))
        # Início + dias preenchidos: o vencimento é calculado (CPC), não digitado
        if ini and dias and ("data_inicio" in attrs or "dias" in attrs or "contagem" in attrs):
            contagem = attrs.get("contagem", getattr(self.instance, "contagem", "uteis"))
            attrs["prazo"] = calcular(ini, dias, contagem)["vencimento"]
        if not attrs.get("prazo") and not getattr(self.instance, "prazo", None):
            raise serializers.ValidationError(
                {"prazo": "Informe o vencimento ou a intimação + dias."}
            )
        if "concluido" in attrs:
            attrs["concluido_em"] = timezone.now() if attrs["concluido"] else None
        return attrs


class ModeloDocumentoSerializer(serializers.ModelSerializer):
    campos = serializers.SerializerMethodField()

    class Meta:
        model = ModeloDocumento
        fields = ["id", "nome", "tipo", "descricao", "corpo", "campos", "created_at"]
        read_only_fields = ["id", "created_at"]

    def get_campos(self, obj):
        from juridico.modelos import CAMPO

        return sorted(set(CAMPO.findall(obj.corpo or "")))


class DocumentoSerializer(TenantFKMixin, serializers.ModelSerializer):
    processo_titulo = serializers.CharField(source="processo.titulo", read_only=True, default="")
    contrato_titulo = serializers.CharField(source="contrato.titulo", read_only=True, default="")
    tem_arquivo = serializers.SerializerMethodField()
    assinaturas = serializers.SerializerMethodField()

    class Meta:
        model = Documento
        fields = [
            "id",
            "titulo",
            "tipo",
            "status",
            "processo",
            "processo_titulo",
            "contrato",
            "contrato_titulo",
            "modelo",
            "conteudo",
            "nome_arquivo",
            "tamanho",
            "sha256",
            "versao",
            "tem_arquivo",
            "assinaturas",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "nome_arquivo",
            "tamanho",
            "sha256",
            "versao",
            "status",
            "created_at",
            "updated_at",
        ]

    def get_tem_arquivo(self, obj):
        return bool(obj.arquivo)

    def get_assinaturas(self, obj):
        return [{"id": s.id, "status": s.status} for s in obj.assinaturas.all()]


class SignatarioSerializer(serializers.ModelSerializer):
    papel_display = serializers.CharField(source="get_papel_display", read_only=True)

    class Meta:
        model = Signatario
        fields = [
            "id",
            "nome",
            "email",
            "cpf_mascarado",
            "papel",
            "papel_display",
            "ordem",
            "status",
            "convite_enviado_em",
            "visualizado_em",
            "assinado_em",
            "ip",
            "recusa_motivo",
        ]


class EventoSerializer(serializers.ModelSerializer):
    signatario_nome = serializers.CharField(source="signatario.nome", read_only=True, default="")

    class Meta:
        model = EventoAssinatura
        fields = ["id", "tipo", "detalhe", "signatario_nome", "ip", "hash_encadeado", "created_at"]


class SolicitacaoSerializer(serializers.ModelSerializer):
    documento_titulo = serializers.CharField(source="documento.titulo", read_only=True)
    signatarios = SignatarioSerializer(many=True, read_only=True)
    assinados = serializers.SerializerMethodField()

    class Meta:
        model = SolicitacaoAssinatura
        fields = [
            "id",
            "documento",
            "documento_titulo",
            "titulo",
            "mensagem",
            "status",
            "provedor",
            "exigir_codigo_email",
            "ordem_sequencial",
            "expira_em",
            "hash_original",
            "hash_assinado",
            "enviada_em",
            "concluida_em",
            "criado_por",
            "signatarios",
            "assinados",
            "created_at",
        ]

    def get_assinados(self, obj):
        sigs = list(obj.signatarios.all())
        return {"feitos": sum(1 for s in sigs if s.status == "assinou"), "total": len(sigs)}


class NovaSolicitacaoSerializer(serializers.Serializer):
    documento = serializers.IntegerField()
    titulo = serializers.CharField(required=False, allow_blank=True, max_length=255)
    mensagem = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    exigir_codigo_email = serializers.BooleanField(default=True)
    ordem_sequencial = serializers.BooleanField(default=False)
    expira_dias = serializers.IntegerField(default=30, min_value=1, max_value=180)
    enviar_agora = serializers.BooleanField(default=True)
    signatarios = serializers.ListField(child=serializers.DictField(), min_length=1, max_length=20)
