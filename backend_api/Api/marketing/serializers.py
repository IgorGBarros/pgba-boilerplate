# backend_api/Api/marketing/serializers.py
from rest_framework import serializers

from marketing.models import (
    PROVEDOR_OAUTH,
    AplicativoRede,
    ContaSocial,
    Destino,
    JobVideo,
    Midia,
    PerfilMarca,
    Publicacao,
)
from marketing.redes import REDES


class PerfilMarcaSerializer(serializers.ModelSerializer):
    tem_logo = serializers.SerializerMethodField()

    class Meta:
        model = PerfilMarca
        fields = [
            "nome",
            "ramo",
            "descricao",
            "publico_alvo",
            "tom_de_voz",
            "pilares",
            "diferenciais",
            "evitar",
            "hashtags",
            "cta_padrao",
            "site",
            "idioma",
            "cor_primaria",
            "cor_secundaria",
            "cor_texto",
            "tem_logo",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]

    def get_tem_logo(self, obj):
        return bool(obj.logo)

    def validate_pilares(self, value):
        if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
            raise serializers.ValidationError("Lista de textos.")
        return [x.strip()[:80] for x in value if x.strip()][:12]

    def _cor(self, value):
        import re

        if not re.fullmatch(r"#[0-9a-fA-F]{6}", value or ""):
            raise serializers.ValidationError("Cor no formato #RRGGBB.")
        return value.lower()

    validate_cor_primaria = _cor
    validate_cor_secundaria = _cor
    validate_cor_texto = _cor


class AplicativoRedeSerializer(serializers.ModelSerializer):
    client_secret = serializers.CharField(write_only=True, required=False, allow_blank=True)
    secret_definido = serializers.SerializerMethodField()

    class Meta:
        model = AplicativoRede
        fields = ["id", "provedor", "client_id", "client_secret", "secret_definido", "updated_at"]
        read_only_fields = ["id", "updated_at"]

    def get_secret_definido(self, obj):
        return bool(obj._client_secret)


class ContaSocialSerializer(serializers.ModelSerializer):
    rede_nome = serializers.CharField(source="get_rede_display", read_only=True)
    provedor = serializers.SerializerMethodField()

    class Meta:
        model = ContaSocial
        fields = [
            "id",
            "rede",
            "rede_nome",
            "provedor",
            "nome",
            "usuario",
            "conta_id",
            "url",
            "expira_em",
            "config",
            "status",
            "mensagem",
            "ultimo_teste",
            "conectada_por",
            "created_at",
        ]
        read_only_fields = [f for f in fields if f != "config"]

    def get_provedor(self, obj):
        return PROVEDOR_OAUTH.get(obj.rede)

    def validate_config(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Objeto JSON.")
        permitidos = {
            "youtube": {"privacidade": {"public", "unlisted", "private"}},
            "tiktok": {
                "modo": {"rascunho", "direto"},
                "privacidade": {"PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"},
            },
            "linkedin": {"author": None},
        }.get(self.instance.rede if self.instance else "", {})
        atual = dict(self.instance.config or {}) if self.instance else {}
        for k, v in value.items():
            if k not in permitidos:
                continue  # chaves internas (page_id, guild_id...) não mudam pela API
            opcoes = permitidos[k]
            if opcoes is not None and v not in opcoes:
                raise serializers.ValidationError({k: f"Use um de: {', '.join(sorted(opcoes))}."})
            if k == "author" and v and not str(v).startswith("urn:li:organization:"):
                raise serializers.ValidationError({k: "Use urn:li:organization:<id>."})
            atual[k] = v
        return atual


class MidiaSerializer(serializers.ModelSerializer):
    origem_nome = serializers.CharField(source="get_origem_display", read_only=True)

    class Meta:
        model = Midia
        fields = [
            "id",
            "tipo",
            "origem",
            "origem_nome",
            "titulo",
            "formato",
            "largura",
            "altura",
            "duracao",
            "tamanho",
            "mime",
            "legenda_sugerida",
            "dados",
            "job",
            "created_at",
        ]
        read_only_fields = [f for f in fields if f not in ("titulo", "legenda_sugerida")]


class DestinoSerializer(serializers.ModelSerializer):
    rede = serializers.CharField(source="conta.rede", read_only=True)
    conta_nome = serializers.CharField(source="conta.nome", read_only=True)
    limite = serializers.SerializerMethodField()
    texto_final = serializers.SerializerMethodField()

    class Meta:
        model = Destino
        fields = [
            "id",
            "conta",
            "rede",
            "conta_nome",
            "texto",
            "texto_final",
            "limite",
            "status",
            "externo_id",
            "url",
            "erro",
            "tentativas",
            "publicado_em",
        ]

    def get_limite(self, obj):
        r = REDES.get(obj.conta.rede)
        return r.limite if r else None

    def get_texto_final(self, obj):
        from marketing.services import texto_para

        return texto_para(obj.publicacao, obj)


class PublicacaoSerializer(serializers.ModelSerializer):
    destinos = DestinoSerializer(many=True, read_only=True)
    midias_ids = serializers.PrimaryKeyRelatedField(
        source="midias", many=True, queryset=Midia.objects.none(), required=False
    )
    midias_info = serializers.SerializerMethodField()
    contas = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False
    )
    textos = serializers.DictField(
        child=serializers.CharField(allow_blank=True), write_only=True, required=False
    )
    agente_nome = serializers.CharField(source="agente.name", read_only=True, default="")
    status_nome = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Publicacao
        fields = [
            "id",
            "titulo",
            "texto",
            "pilar",
            "formato",
            "gancho",
            "hashtags",
            "link",
            "status",
            "status_nome",
            "agendada_para",
            "midias_ids",
            "midias_info",
            "contas",
            "textos",
            "destinos",
            "escrita_por_ia",
            "agente_nome",
            "fontes",
            "ideia_visual",
            "aprovada_por",
            "aprovada_em",
            "publicada_em",
            "observacoes",
            "created_at",
        ]
        read_only_fields = [
            "status",
            "escrita_por_ia",
            "fontes",
            "aprovada_por",
            "aprovada_em",
            "publicada_em",
            "created_at",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        tenant = getattr(request, "tenant_id", None)
        if tenant:
            self.fields["midias_ids"].child_relation.queryset = Midia.objects.filter(
                tenant_id=tenant, is_active=True
            )

    def get_midias_info(self, obj):
        return [
            {"id": m.id, "tipo": m.tipo, "titulo": m.titulo, "formato": m.formato}
            for m in obj.midias.filter(is_active=True)
        ]

    def validate(self, attrs):
        if self.instance and self.instance.status in ("publicando", "publicada"):
            raise serializers.ValidationError("Publicação que já saiu não muda.")
        return attrs

    def _salvar_destinos(self, pub, contas, textos):
        from marketing.services import definir_destinos

        if contas is not None:
            definir_destinos(pub, contas, textos)
        elif textos:
            definir_destinos(pub, list(pub.destinos.values_list("conta_id", flat=True)), textos)

    def create(self, validated):
        contas, textos = validated.pop("contas", None), validated.pop("textos", None)
        pub = super().create(validated)
        self._salvar_destinos(pub, contas, textos)
        return pub

    def update(self, instance, validated):
        contas, textos = validated.pop("contas", None), validated.pop("textos", None)
        # editar depois de aprovada volta pra revisão: aprovação vale pro que foi aprovado
        if instance.status == "agendada" and (
            set(validated) - {"observacoes"} or contas is not None or textos
        ):
            validated["status"] = "revisao"
            validated["aprovada_por"], validated["aprovada_em"] = "", None
        pub = super().update(instance, validated)
        self._salvar_destinos(pub, contas, textos)
        return pub


class JobVideoSerializer(serializers.ModelSerializer):
    status_nome = serializers.CharField(source="get_status_display", read_only=True)
    agente_nome = serializers.CharField(source="agente.name", read_only=True, default="")
    midias = serializers.SerializerMethodField()

    class Meta:
        model = JobVideo
        fields = [
            "id",
            "tipo",
            "status",
            "status_nome",
            "progresso",
            "etapa",
            "titulo",
            "origem_url",
            "origem_midia",
            "parametros",
            "resultado",
            "erro",
            "agente_nome",
            "criado_por",
            "midias",
            "created_at",
            "concluido_em",
        ]

    def get_midias(self, obj):
        return MidiaSerializer(obj.midias.filter(is_active=True).order_by("id"), many=True).data
