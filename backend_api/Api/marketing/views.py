# backend_api/Api/marketing/views.py
from __future__ import annotations

import shutil
from datetime import date, timedelta

from django.conf import settings
from django.core.files.base import ContentFile
from django.db.models import Count, Q
from django.http import FileResponse, HttpResponse, HttpResponseRedirect
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, mixins, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from agency.views import TenantScopedMixin
from core.mixins import SoftDeleteViewMixin, TenantContextMixin
from erp.views import ErpPagination
from marketing import equipe, services
from marketing.criativos import FORMATOS, MODELOS, carrossel, renderizar
from marketing.ia import IAError
from marketing.midias import MidiaError, salvar_imagem, salvar_video, tipo_de
from marketing.models import (
    REDES as REDES_CHOICES,
    AplicativoRede,
    ContaSocial,
    JobVideo,
    Midia,
    Publicacao,
)
from marketing.ramos import RAMOS
from marketing.redes import REDES, RedeError
from marketing.redes.discord import info_webhook, validar_webhook
from marketing.redes.oauth import PROVEDORES
from marketing.serializers import (
    AplicativoRedeSerializer,
    ContaSocialSerializer,
    JobVideoSerializer,
    MidiaSerializer,
    PerfilMarcaSerializer,
    PublicacaoSerializer,
)
from marketing.tasks import (
    despachar,
    escrever_rascunhos_task,
    gerar_video_ia_task,
    processar_cortes_task,
    publicar_task,
)

MAX_LOGO = 3 * 1024 * 1024


def _quem(request) -> str:
    return getattr(request.user, "email", "") or str(getattr(request.user, "pk", ""))


def _erro(msg, code=400):
    return Response({"detail": str(msg)}, status=code)


class _Base(SoftDeleteViewMixin, TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    pagination_class = ErpPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]


class _Tenant(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]


def _arquivo(field, nome: str, mime: str, baixar=False):
    resp = FileResponse(field.open("rb"), content_type=mime or "application/octet-stream")
    resp["Content-Disposition"] = f'{"attachment" if baixar else "inline"}; filename="{nome}"'
    resp["Cache-Control"] = "private, max-age=300"
    return resp


# ─── Visão geral, time, prontidão ───────────────────────────────────────────


class PainelView(_Tenant):
    def get(self, request):
        t = request.tenant_id
        agora = timezone.now()
        pubs = Publicacao.objects.filter(tenant_id=t, is_active=True)
        semana = pubs.filter(agendada_para__gte=agora, agendada_para__lt=agora + timedelta(days=7))
        mes = pubs.filter(publicada_em__gte=agora.replace(day=1, hour=0, minute=0, second=0))
        por_status = dict(pubs.values_list("status").annotate(n=Count("id")))
        from marketing.models import Destino

        por_rede = dict(
            Destino.objects.filter(
                tenant_id=t, status="publicado", publicado_em__gte=agora - timedelta(days=30)
            )
            .values_list("conta__rede")
            .annotate(n=Count("id"))
        )
        proximas = pubs.filter(
            status__in=["rascunho", "revisao", "agendada"], agendada_para__gte=agora
        ).order_by("agendada_para")[:8]
        contas = ContaSocial.objects.filter(tenant_id=t, is_active=True)
        return Response(
            {
                "por_status": por_status,
                "semana": semana.count(),
                "aguardando_aprovacao": pubs.filter(status__in=["rascunho", "revisao"]).count(),
                "agendadas": por_status.get("agendada", 0),
                "com_erro": pubs.filter(status__in=["erro", "parcial"]).count(),
                "publicadas_mes": mes.count(),
                "publicadas_30d_por_rede": por_rede,
                "dias_com_post_14d": pubs.filter(
                    status__in=["agendada", "publicada", "revisao", "rascunho"],
                    agendada_para__gte=agora,
                    agendada_para__lt=agora + timedelta(days=14),
                )
                .dates("agendada_para", "day")
                .count(),
                "proximas": PublicacaoSerializer(
                    proximas, many=True, context={"request": request}
                ).data,
                "contas": {
                    "total": contas.count(),
                    "com_problema": contas.exclude(status="conectada").count(),
                    "redes": sorted(set(contas.values_list("rede", flat=True))),
                },
                "jobs_ativos": JobVideo.objects.filter(
                    tenant_id=t,
                    is_active=True,
                    status__in=[
                        "na_fila",
                        "baixando",
                        "transcrevendo",
                        "analisando",
                        "cortando",
                        "gerando",
                    ],
                ).count(),
            }
        )


class TimeView(_Tenant):
    def get(self, request):
        s = equipe.setor(request.tenant_id)
        agentes = []
        if s is not None:
            papeis = {v[0]: k for k, v in equipe.TIME.items()}
            for a in s.agents.filter(is_active=True).order_by("id"):
                agentes.append(
                    {
                        "id": a.id,
                        "nome": a.name,
                        "cargo": a.role,
                        "papel": papeis.get(a.name, ""),
                        "nivel": a.access_level,
                        "work_status": a.work_status,
                        "tarefa": a.current_task,
                    }
                )
        faltando = [v[0] for v in equipe.TIME.values() if v[0] not in {a["nome"] for a in agentes}]
        return Response({"setor": s.id if s else None, "agentes": agentes, "faltando": faltando})

    def post(self, request):
        return Response(equipe.montar(request.tenant_id), status=201)


class ProntidaoView(_Tenant):
    """O que está (e o que não está) pronto — a tela avisa em vez de falhar escondido."""

    def get(self, request):
        from harness.providers import transcription_provider
        from integrations.models import ServiceCredential

        try:
            import yt_dlp  # noqa: F401

            ytdlp = True
        except ImportError:
            ytdlp = False
        mp = ServiceCredential.objects.filter(
            Q(tenant_id=request.tenant_id) | Q(tenant_id__isnull=True),
            provider="moneyprinter",
            is_active=True,
        ).exists()
        return Response(
            {
                "ffmpeg": bool(shutil.which("ffmpeg") and shutil.which("ffprobe")),
                "yt_dlp": ytdlp,
                "transcricao": transcription_provider(request.tenant_id),
                "moneyprinter": mp,
                "api_publica": services.api_publica(),
                "criptografia": bool(getattr(settings, "ENCRYPTION_KEY", "")),
                "redirect_uri": services.redirect_uri(request),
                "time": equipe.setor(request.tenant_id) is not None,
            }
        )


# ─── Marca ───────────────────────────────────────────────────────────────────


class MarcaView(_Tenant):
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        return Response(PerfilMarcaSerializer(services.perfil(request.tenant_id)).data)

    def patch(self, request):
        p = services.perfil(request.tenant_id)
        ser = PerfilMarcaSerializer(p, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)


class LogoView(_Tenant):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        p = services.perfil(request.tenant_id)
        if not p.logo:
            return _erro("Sem logo.", 404)
        return _arquivo(p.logo, "logo.png", "image/png")

    def post(self, request):
        f = request.FILES.get("arquivo")
        if f is None:
            return _erro("Envie o arquivo do logo.")
        if f.size > MAX_LOGO:
            return _erro("Logo acima de 3 MB.")
        dados = f.read()
        try:
            from PIL import Image
            import io

            with Image.open(io.BytesIO(dados)) as im:
                im.verify()
        except Exception:  # noqa: BLE001
            return _erro("Não consegui abrir essa imagem.")
        p = services.perfil(request.tenant_id)
        p.logo.save(f"logo.{(f.name.rsplit('.', 1)[-1] or 'png')[:4].lower()}", ContentFile(dados))
        return Response(PerfilMarcaSerializer(p).data)

    def delete(self, request):
        p = services.perfil(request.tenant_id)
        p.logo = ""
        p.save(update_fields=["logo"])
        return Response(status=204)


class RamosView(_Tenant):
    def get(self, request):
        return Response(RAMOS)


# ─── Apps OAuth e contas ────────────────────────────────────────────────────


class AppsView(_Tenant):
    def get(self, request):
        apps = {a.provedor: a for a in AplicativoRede.objects.filter(tenant_id=request.tenant_id)}
        out = []
        for key, p in PROVEDORES.items():
            a = apps.get(key)
            out.append(
                {
                    "provedor": key,
                    "nome": p.nome,
                    "redes": p.redes,
                    "portal": p.portal,
                    "escopos": p.escopos,
                    "app": AplicativoRedeSerializer(a).data if a else None,
                }
            )
        return Response({"redirect_uri": services.redirect_uri(request), "provedores": out})

    def post(self, request):
        provedor = request.data.get("provedor")
        if provedor not in PROVEDORES:
            return _erro("Provedor inválido.")
        atual = AplicativoRede.objects.filter(
            tenant_id=request.tenant_id, provedor=provedor
        ).first()
        ser = AplicativoRedeSerializer(atual, data=request.data, partial=bool(atual))
        ser.is_valid(raise_exception=True)
        secret = ser.validated_data.pop("client_secret", "")
        app = atual or AplicativoRede(tenant_id=request.tenant_id, provedor=provedor)
        app.client_id = ser.validated_data.get("client_id", app.client_id).strip()
        if secret and not secret.startswith("••••"):
            try:
                app.client_secret = secret.strip()
            except Exception:  # noqa: BLE001
                return _erro("Defina ENCRYPTION_KEY no servidor para guardar segredos.")
        if not app._client_secret:
            return _erro("Informe o Client Secret.")
        app.save()
        return Response(AplicativoRedeSerializer(app).data, status=201 if atual is None else 200)


class AppDetailView(_Tenant):
    def delete(self, request, provedor):
        AplicativoRede.objects.filter(tenant_id=request.tenant_id, provedor=provedor).delete()
        return Response(status=204)


class ContaViewSet(
    SoftDeleteViewMixin,
    TenantContextMixin,
    TenantScopedMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Conta nasce pelo login OAuth, webhook (Discord) ou token colado — nunca por POST cru."""

    permission_classes = [IsAuthenticated]
    queryset = ContaSocial.objects.all()
    serializer_class = ContaSocialSerializer
    pagination_class = None

    @action(detail=True, methods=["post"])
    def testar(self, request, pk=None):
        conta = self.get_object()
        try:
            return Response({"ok": True, "detail": services.testar_conta(conta)})
        except RedeError as exc:
            return Response({"ok": False, "detail": str(exc)}, status=400)

    @action(detail=False, methods=["post"])
    def conectar(self, request):
        """Começa o login OAuth: devolve a URL da rede pra abrir numa janela."""
        try:
            url = services.iniciar_oauth(
                request.tenant_id,
                request.data.get("provedor", ""),
                services.redirect_uri(request),
                _quem(request),
            )
        except services.MarketingError as exc:
            return _erro(exc)
        return Response({"url": url})

    @action(detail=False, methods=["post"])
    def discord(self, request):
        try:
            url = validar_webhook(request.data.get("webhook_url", ""))
            info = info_webhook(url)
        except RedeError as exc:
            return _erro(exc)
        conta_id = str(info.get("id") or "")
        conta = ContaSocial.objects.filter(
            tenant_id=request.tenant_id, rede="discord", conta_id=conta_id
        ).first() or ContaSocial(tenant_id=request.tenant_id, rede="discord", conta_id=conta_id)
        conta.nome = (request.data.get("nome") or info.get("name") or "Discord")[:255]
        try:
            conta.token = url
        except Exception:  # noqa: BLE001
            return _erro("Defina ENCRYPTION_KEY no servidor para guardar o webhook.")
        conta.config = {"channel_id": info.get("channel_id"), "guild_id": info.get("guild_id")}
        conta.status, conta.mensagem, conta.is_active = "conectada", "", True
        conta.conectada_por = _quem(request)
        conta.save()
        return Response(ContaSocialSerializer(conta).data, status=201)

    @action(detail=False, methods=["post"])
    def manual(self, request):
        """Token gerado no portal da rede (ex.: token de página da Meta) + id da conta."""
        rede = request.data.get("rede")
        token = (request.data.get("token") or "").strip()
        conta_id = (request.data.get("conta_id") or "").strip()
        if rede not in REDES or rede == "discord":
            return _erro("Rede inválida (Discord usa o webhook).")
        if not token or not conta_id:
            return _erro("Informe o token e o id da conta/página/canal.")
        conta = ContaSocial.objects.filter(
            tenant_id=request.tenant_id, rede=rede, conta_id=conta_id
        ).first() or ContaSocial(tenant_id=request.tenant_id, rede=rede, conta_id=conta_id)
        conta.nome = (request.data.get("nome") or conta.nome or conta_id)[:255]
        conta.usuario = (request.data.get("usuario") or conta.usuario or "")[:255]
        try:
            conta.token = token
        except Exception:  # noqa: BLE001
            return _erro("Defina ENCRYPTION_KEY no servidor para guardar o token.")
        conta.refresh_token, conta.expira_em = "", None
        conta.is_active, conta.conectada_por = True, _quem(request)
        conta.save()
        try:
            detalhe = services.testar_conta(conta)
        except RedeError as exc:
            return Response({**ContaSocialSerializer(conta).data, "teste": str(exc)}, status=201)
        return Response({**ContaSocialSerializer(conta).data, "teste": detalhe}, status=201)

    @action(detail=False, methods=["get"])
    def redes(self, request):
        return Response(
            [
                {
                    "rede": k,
                    "nome": n,
                    "limite": REDES[k].limite,
                    "aceita": sorted(REDES[k].aceita),
                    "exige_midia": REDES[k].exige_midia,
                    "provedor": services.provedor_da_rede(k),
                }
                for k, n in REDES_CHOICES
            ]
        )


class OAuthCallbackView(APIView):
    """Volta do login na rede (navegador, sem JWT): o `state` de uso único identifica o tenant."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "marketing_publico"

    def get(self, request):
        from urllib.parse import urlencode

        destino = f"{settings.FRONTEND_URL.rstrip('/')}/marketing-conectado"
        erro = request.GET.get("error_description") or request.GET.get("error")
        state, code = request.GET.get("state", ""), request.GET.get("code", "")
        if erro or not code:
            if state:
                from marketing.models import OAuthPendente

                OAuthPendente.objects.filter(state=state).delete()
            msg = erro or "A rede não devolveu autorização."
            return HttpResponseRedirect(f"{destino}?{urlencode({'ok': 0, 'msg': msg[:300]})}")
        try:
            contas = services.concluir_oauth(state, code)
        except (services.MarketingError, RedeError) as exc:
            return HttpResponseRedirect(f"{destino}?{urlencode({'ok': 0, 'msg': str(exc)[:300]})}")
        nomes = ", ".join(f"{c.get_rede_display()} {c.nome}" for c in contas)
        return HttpResponseRedirect(f"{destino}?{urlencode({'ok': 1, 'msg': nomes[:300]})}")


# ─── Mídias ──────────────────────────────────────────────────────────────────


class MidiaViewSet(_Base):
    queryset = Midia.objects.all()
    serializer_class = MidiaSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    filterset_fields = ["tipo", "origem", "formato", "job"]
    search_fields = ["titulo", "legenda_sugerida"]
    ordering_fields = ["created_at"]

    def create(self, request, *args, **kwargs):
        f = request.FILES.get("arquivo")
        if f is None:
            return _erro("Envie o arquivo.")
        try:
            cabecalho = f.read(16)
            f.seek(0)
            tipo, mime = tipo_de(f.name, "", cabecalho)
            titulo = (request.data.get("titulo") or f.name)[:255]
            if tipo == "imagem":
                m = salvar_imagem(request.tenant_id, f.read(), f.name, mime=mime, titulo=titulo)
            else:
                import pathlib
                import tempfile

                if f.size > 500 * 1024 * 1024:
                    return _erro("Vídeo acima de 500 MB.")
                with tempfile.TemporaryDirectory() as tmp:
                    caminho = pathlib.Path(tmp) / "upload"
                    with caminho.open("wb") as out:
                        for bloco in f.chunks():
                            out.write(bloco)
                    m = salvar_video(request.tenant_id, caminho, f.name, mime=mime, titulo=titulo)
        except MidiaError as exc:
            return _erro(exc)
        return Response(MidiaSerializer(m).data, status=201)

    @action(detail=True, methods=["get"])
    def arquivo(self, request, pk=None):
        m = self.get_object()
        if request.GET.get("miniatura") and m.miniatura:
            return _arquivo(m.miniatura, f"thumb-{m.pk}.jpg", "image/jpeg")
        ext = m.arquivo.name.rsplit(".", 1)[-1]
        return _arquivo(
            m.arquivo,
            f"{m.titulo or 'midia'}-{m.pk}.{ext}"[:120],
            m.mime,
            bool(request.GET.get("baixar")),
        )


class MidiaPublicaView(APIView):
    """Link assinado (2 dias) pra Instagram/TikTok buscarem a mídia. Só serve mídia ativa."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "marketing_publico"

    def get(self, request, token):
        m = services.midia_do_token(token)
        if m is None:
            return HttpResponse(status=404)
        ext = m.arquivo.name.rsplit(".", 1)[-1]
        return _arquivo(m.arquivo, f"midia-{m.pk}.{ext}", m.mime)


# ─── Criativos ───────────────────────────────────────────────────────────────


class CriativoView(_Tenant):
    def get(self, request):
        return Response(
            {
                "formatos": [
                    {"chave": k, "largura": w, "altura": h, "nome": n}
                    for k, (w, h, n) in FORMATOS.items()
                ],
                "modelos": [{"chave": k, "nome": n} for k, n in MODELOS.items()],
            }
        )

    def post(self, request):
        import uuid

        from marketing import ia

        d = request.data
        modelo = d.get("modelo") if d.get("modelo") in MODELOS else "destaque"
        formatos = [f for f in d.get("formatos") or [] if f in FORMATOS] or ["quadrado"]
        textos = d.get("textos") or {}
        if not isinstance(textos, dict):
            return _erro("textos inválido.")
        laminas = int(d.get("laminas") or (4 if modelo == "lista" else 1))
        if d.get("usar_ia"):
            if not (d.get("tema") or "").strip():
                return _erro("Diga o tema pra IA escrever o texto.")
            try:
                textos = {
                    **ia.texto_criativo(request.tenant_id, d["tema"], modelo, laminas),
                    **{k: v for k, v in textos.items() if v},
                }
            except IAError as exc:
                return _erro(exc)
            except Exception as exc:  # noqa: BLE001 — provedor fora do ar
                return _erro(f"A IA do setor não respondeu: {exc}", 502)
        if not str(textos.get("titulo") or "").strip():
            return _erro("Falta o título do criativo.")
        p = services.perfil(request.tenant_id)
        marca = PerfilMarcaSerializer(p).data
        logo = None
        if p.logo:
            with p.logo.open("rb") as fh:
                logo = fh.read()
        fundo = None
        if d.get("fundo"):
            fm = Midia.objects.filter(
                tenant_id=request.tenant_id, pk=d["fundo"], tipo="imagem", is_active=True
            ).first()
            if fm:
                with fm.arquivo.open("rb") as fh:
                    fundo = fh.read()
        grupo = uuid.uuid4().hex[:12]
        criadas = []
        for fmt in formatos:
            if modelo == "lista":
                paginas = carrossel(textos, fmt, marca, logo, fundo)
                laminas = [x for x in textos.get("laminas") or [] if isinstance(x, dict)]
                titulos = (
                    [textos.get("titulo", "")]
                    + [str(x.get("titulo") or "") for x in laminas]
                    + [textos.get("cta") or "Fechamento"]
                )
            else:
                paginas = [renderizar(modelo, fmt, textos, marca, logo, fundo)]
                titulos = [textos.get("titulo", "")]
            for i, png in enumerate(paginas, start=1):
                sufixo = f"{i}/{len(paginas)} · " if len(paginas) > 1 else ""
                criadas.append(
                    salvar_imagem(
                        request.tenant_id,
                        png,
                        f"criativo-{fmt}-{i}.png",
                        origem="criativo",
                        titulo=f"{sufixo}{str(titulos[i - 1] if i <= len(titulos) else '')[:200]}",
                        formato=fmt,
                        dados={"modelo": modelo, "grupo": grupo, "ordem": i, "textos": textos},
                    )
                )
        return Response(
            {"grupo": grupo, "textos": textos, "midias": MidiaSerializer(criadas, many=True).data},
            status=201,
        )


# ─── Publicações ─────────────────────────────────────────────────────────────


class PublicacaoViewSet(_Base):
    queryset = Publicacao.objects.prefetch_related("destinos__conta", "midias").select_related(
        "agente"
    )
    serializer_class = PublicacaoSerializer
    filterset_fields = ["status", "formato", "pilar", "escrita_por_ia"]
    search_fields = ["titulo", "texto", "pilar"]
    ordering_fields = ["agendada_para", "created_at", "publicada_em"]

    def get_queryset(self):
        qs = super().get_queryset()
        de, ate = self.request.GET.get("de"), self.request.GET.get("ate")
        if de:
            qs = qs.filter(agendada_para__date__gte=de)
        if ate:
            qs = qs.filter(agendada_para__date__lte=ate)
        if self.request.GET.get("sem_data"):
            qs = qs.filter(agendada_para__isnull=True)
        if rede := self.request.GET.get("rede"):
            qs = qs.filter(destinos__conta__rede=rede).distinct()
        return qs

    def perform_destroy(self, instance):
        if instance.status in ("publicando",):
            from rest_framework.exceptions import ValidationError

            raise ValidationError("Está publicando agora — espere terminar.")
        super().perform_destroy(instance)

    def _pub(self, request, pk):
        return self.get_queryset().get(pk=pk)

    def _resp(self, pub, code=200):
        pub = self.get_queryset().get(pk=pub.pk)
        return Response(self.get_serializer(pub).data, status=code)

    @action(detail=False, methods=["post"])
    def gerar(self, request):
        """IA escreve um post novo (rascunho) pras contas escolhidas."""
        from marketing import ia

        d = request.data
        tema = (d.get("tema") or "").strip()
        if not tema:
            return _erro("Diga o tema do post.")
        contas = list(
            ContaSocial.objects.filter(
                tenant_id=request.tenant_id, is_active=True, pk__in=d.get("contas") or []
            )
        )
        redes = sorted({c.rede for c in contas}) or [r for r in d.get("redes") or [] if r in REDES]
        formato = d.get("formato") if d.get("formato") in ia.FORMATOS else "post"
        try:
            dados = ia.escrever_post(
                request.tenant_id, tema, redes, formato, d.get("instrucoes") or ""
            )
        except IAError as exc:
            return _erro(exc)
        except Exception as exc:  # noqa: BLE001
            return _erro(f"A IA do setor não respondeu: {exc}", 502)
        quando = parse_datetime(d["agendada_para"]) if d.get("agendada_para") else None
        pub = Publicacao.objects.create(
            tenant_id=request.tenant_id,
            titulo=dados["titulo"],
            formato=formato,
            agendada_para=quando,
        )
        services.definir_destinos(pub, [c.pk for c in contas])
        ia.aplicar_post(pub, dados)
        if ids := d.get("midias"):
            pub.midias.set(
                Midia.objects.filter(tenant_id=request.tenant_id, pk__in=ids, is_active=True)
            )
        resp = self._resp(pub, 201)
        resp.data["avisos"] = dados["avisos"]
        return resp

    @action(detail=True, methods=["post"])
    def escrever(self, request, pk=None):
        from marketing import ia

        pub = self._pub(request, pk)
        if pub.status not in ("rascunho", "revisao", "erro"):
            return _erro("Só rascunho ou em revisão.")
        redes = sorted({x.conta.rede for x in pub.destinos.all()}) or ["instagram"]
        try:
            dados = ia.escrever_post(
                request.tenant_id,
                request.data.get("tema") or pub.titulo,
                redes,
                pub.formato,
                request.data.get("instrucoes") or "",
                gancho=pub.gancho,
                pilar=pub.pilar,
            )
        except IAError as exc:
            return _erro(exc)
        except Exception as exc:  # noqa: BLE001
            return _erro(f"A IA do setor não respondeu: {exc}", 502)
        ia.aplicar_post(pub, dados)
        resp = self._resp(pub)
        resp.data["avisos"] = dados["avisos"]
        return resp

    @action(detail=True, methods=["post"])
    def conferir(self, request, pk=None):
        return Response({"erros": services.conferir(self._pub(request, pk))})

    @action(detail=True, methods=["post"])
    def revisao(self, request, pk=None):
        pub = self._pub(request, pk)
        if pub.status not in ("rascunho", "erro", "parcial", "cancelada"):
            return _erro("Só rascunho vai pra aprovação.")
        pub.status = "revisao"
        pub.save(update_fields=["status"])
        return self._resp(pub)

    @action(detail=True, methods=["post"])
    def aprovar(self, request, pk=None):
        """Decisão humana. Sem data (ou `publicar_agora`) sai já; com data, o agendador publica."""
        pub = self._pub(request, pk)
        if request.data.get("publicar_agora"):
            pub.agendada_para = None
            pub.save(update_fields=["agendada_para"])
        try:
            services.aprovar(pub, _quem(request))
        except services.MarketingError as exc:
            return _erro(exc)
        if pub.agendada_para is None or pub.agendada_para <= timezone.now():
            if services.reivindicar(pub.pk, request.tenant_id):
                despachar(publicar_task, pub.pk, str(request.tenant_id))
        return self._resp(pub)

    @action(detail=True, methods=["post"])
    def publicar(self, request, pk=None):
        """Tentar de novo os destinos com erro (a aprovação já existe)."""
        pub = self._pub(request, pk)
        if pub.status not in ("erro", "parcial") or not pub.aprovada_em:
            return _erro("Só dá pra tentar de novo uma publicação aprovada que falhou.")
        Publicacao.objects.filter(pk=pub.pk).update(status="publicando")
        despachar(publicar_task, pub.pk, str(request.tenant_id))
        return self._resp(pub)

    @action(detail=True, methods=["post"])
    def cancelar(self, request, pk=None):
        pub = self._pub(request, pk)
        if pub.status in ("publicando", "publicada"):
            return _erro("Já saiu (ou está saindo) — não dá pra cancelar.")
        pub.status, pub.aprovada_por, pub.aprovada_em = "cancelada", "", None
        pub.save(update_fields=["status", "aprovada_por", "aprovada_em"])
        return self._resp(pub)

    @action(detail=True, methods=["post"])
    def voltar(self, request, pk=None):
        pub = self._pub(request, pk)
        if pub.status in ("publicando", "publicada"):
            return _erro("Já saiu — não volta pra rascunho.")
        pub.status, pub.aprovada_por, pub.aprovada_em = "rascunho", "", None
        pub.save(update_fields=["status", "aprovada_por", "aprovada_em"])
        return self._resp(pub)

    @action(detail=False, methods=["post"], url_path="aprovar-lote")
    def aprovar_lote(self, request):
        ok, erros = [], {}
        for pub in self.get_queryset().filter(pk__in=request.data.get("ids") or []):
            try:
                services.aprovar(pub, _quem(request))
                ok.append(pub.pk)
                if pub.agendada_para is None or pub.agendada_para <= timezone.now():
                    if services.reivindicar(pub.pk, request.tenant_id):
                        despachar(publicar_task, pub.pk, str(request.tenant_id))
            except services.MarketingError as exc:
                erros[pub.pk] = str(exc)
        return Response({"aprovadas": ok, "erros": erros})

    @action(detail=False, methods=["post"])
    def planejar(self, request):
        """Estrategista monta o calendário; cada item vira rascunho com data (e, opcional,
        o Copywriter já escreve)."""
        from marketing import ia

        d = request.data
        try:
            inicio = date.fromisoformat(str(d.get("inicio") or timezone.localdate().isoformat()))
        except ValueError:
            return _erro("Data de início inválida.")
        contas = list(
            ContaSocial.objects.filter(
                tenant_id=request.tenant_id, is_active=True, pk__in=d.get("contas") or []
            )
        )
        if not contas:
            return _erro("Escolha as contas que entram no plano.")
        try:
            itens, agente = ia.planejar(
                request.tenant_id,
                inicio,
                int(d.get("semanas") or 4),
                int(d.get("por_semana") or 3),
                sorted({c.rede for c in contas}),
                d.get("objetivo") or "",
            )
        except IAError as exc:
            return _erro(exc)
        except Exception as exc:  # noqa: BLE001
            return _erro(f"A IA do setor não respondeu: {exc}", 502)
        criadas = []
        for it in itens:
            pub = Publicacao.objects.create(
                tenant_id=request.tenant_id,
                titulo=it["tema"],
                gancho=it["gancho"],
                pilar=it["pilar"],
                formato=it["formato"],
                agendada_para=it["quando"],
                escrita_por_ia=True,
                agente=agente,
                observacoes=f"Plano: {d.get('objetivo', '')}"[:1000] if d.get("objetivo") else "",
            )
            services.definir_destinos(pub, [c.pk for c in contas if c.rede in it["redes"]])
            criadas.append(pub.pk)
        enfileirado = None
        if d.get("escrever"):
            enfileirado = despachar(
                escrever_rascunhos_task, criadas, str(request.tenant_id), d.get("instrucoes") or ""
            )
        return Response(
            {
                "criadas": criadas,
                "escrevendo": d.get("escrever", False),
                "enfileirado": enfileirado,
            },
            status=201,
        )

    @action(detail=False, methods=["post"], url_path="escrever-lote")
    def escrever_lote(self, request):
        ids = [int(i) for i in request.data.get("ids") or []][:60]
        enfileirado = despachar(
            escrever_rascunhos_task,
            ids,
            str(request.tenant_id),
            request.data.get("instrucoes") or "",
        )
        return Response({"ids": ids, "enfileirado": enfileirado}, status=202)


# ─── Vídeo ───────────────────────────────────────────────────────────────────


class JobViewSet(
    SoftDeleteViewMixin,
    TenantContextMixin,
    TenantScopedMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAuthenticated]
    queryset = JobVideo.objects.select_related("agente")
    serializer_class = JobVideoSerializer
    pagination_class = ErpPagination
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["tipo", "status"]

    @action(detail=False, methods=["post"])
    def cortes(self, request):
        from marketing.video import VideoError, validar_url

        d = request.data
        if not d.get("direitos"):
            return _erro(
                "Confirme que a empresa tem direito sobre esse vídeo (próprio ou autorizado)."
            )
        if equipe.agente(request.tenant_id, "video") is None:
            return _erro("Monte o time de marketing antes (o Editor de Vídeo escolhe os trechos).")
        if not shutil.which("ffmpeg"):
            return _erro("ffmpeg não está instalado no servidor.")
        midia = None
        url = ""
        if d.get("midia"):
            midia = Midia.objects.filter(
                tenant_id=request.tenant_id, pk=d["midia"], tipo="video", is_active=True
            ).first()
            if midia is None:
                return _erro("Vídeo não encontrado.")
        else:
            try:
                url = validar_url(d.get("url") or "")
            except VideoError as exc:
                return _erro(exc)

        def intervalo(nome, padrao, lo, hi):
            try:
                return max(lo, min(int(d.get(nome) or padrao), hi))
            except (TypeError, ValueError):
                return padrao

        minimo = intervalo("minimo", 20, 8, 120)
        job = JobVideo.objects.create(
            tenant_id=request.tenant_id,
            tipo="cortes",
            titulo=(d.get("titulo") or (midia.titulo if midia else ""))[:255],
            origem_url=url,
            origem_midia=midia,
            direitos_confirmados=True,
            criado_por=_quem(request),
            parametros={
                "quantidade": intervalo("quantidade", 5, 1, 12),
                "minimo": minimo,
                "maximo": max(minimo + 5, intervalo("maximo", 60, 15, 180)),
                "estilo": d.get("estilo")
                if d.get("estilo") in ("desfocado", "centro")
                else "desfocado",
                "legenda": bool(d.get("legenda", True)),
                "gancho": bool(d.get("gancho", True)),
                "idioma": (d.get("idioma") or "pt")[:5],
            },
        )
        despachar(processar_cortes_task, job.pk)
        job.refresh_from_db()
        return Response(JobVideoSerializer(job).data, status=201)

    @action(detail=False, methods=["post"])
    def roteiro(self, request):
        from marketing import ia

        tema = (request.data.get("tema") or "").strip()
        if not tema:
            return _erro("Diga o tema do vídeo.")
        try:
            r = ia.roteiro(
                request.tenant_id,
                tema,
                int(request.data.get("segundos") or 45),
                request.data.get("instrucoes") or "",
            )
        except IAError as exc:
            return _erro(exc)
        except Exception as exc:  # noqa: BLE001
            return _erro(f"A IA do setor não respondeu: {exc}", 502)
        r.pop("agente", None)
        return Response(r)

    @action(detail=False, methods=["post"], url_path="video-ia")
    def video_ia(self, request):
        d = request.data
        roteiro = (d.get("roteiro") or "").strip()
        termos = [str(t).strip() for t in d.get("termos") or [] if str(t).strip()]
        if not roteiro or not termos:
            return _erro("Falta o roteiro e as palavras-chave (gere com a IA ou escreva).")
        job = JobVideo.objects.create(
            tenant_id=request.tenant_id,
            tipo="video_ia",
            titulo=(d.get("titulo") or roteiro[:60])[:255],
            criado_por=_quem(request),
            agente=equipe.agente(request.tenant_id, "video"),
            parametros={
                "roteiro": roteiro[:5000],
                "termos": termos[:12],
                "proporcao": d.get("proporcao")
                if d.get("proporcao") in ("9:16", "16:9", "1:1")
                else "9:16",
                "voz": (d.get("voz") or "pt-BR-FranciscaNeural-Female")[:80],
                "legenda": bool(d.get("legenda", True)),
                "musica": bool(d.get("musica", True)),
                "legenda_post": (d.get("legenda_post") or "")[:2000],
                "hashtags": (d.get("hashtags") or "")[:500],
            },
        )
        despachar(gerar_video_ia_task, job.pk)
        job.refresh_from_db()
        return Response(JobVideoSerializer(job).data, status=201)
