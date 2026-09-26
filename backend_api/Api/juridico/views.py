# backend_api/Api/juridico/views.py
from datetime import date, timedelta

from django.core.files.base import ContentFile
from django.db.models import Count, Q, Sum
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from agency.views import TenantScopedMixin
from core.mixins import SoftDeleteViewMixin, TenantContextMixin
from erp.views import ErpPagination
from juridico import assinatura as assin
from juridico.models import (
    Andamento,
    Contrato,
    Documento,
    ModeloDocumento,
    Prazo,
    Processo,
    SolicitacaoAssinatura,
)
from juridico.serializers import (
    AndamentoSerializer,
    ContratoSerializer,
    DocumentoSerializer,
    EventoSerializer,
    ModeloDocumentoSerializer,
    NovaSolicitacaoSerializer,
    PrazoSerializer,
    ProcessoSerializer,
    SolicitacaoSerializer,
)

MAX_UPLOAD = 20 * 1024 * 1024


class _Base(SoftDeleteViewMixin, TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    pagination_class = ErpPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]


def _pdf_response(data: bytes, nome: str, inline=True) -> HttpResponse:
    resp = HttpResponse(data, content_type="application/pdf")
    resp["Content-Disposition"] = f'{"inline" if inline else "attachment"}; filename="{nome}"'
    resp["Cache-Control"] = "no-store"
    return resp


def _file_bytes(field) -> bytes:
    field.open("rb")
    try:
        return field.read()
    finally:
        field.close()


# ─── Contencioso ─────────────────────────────────────────────────────────────


class ProcessoViewSet(_Base):
    queryset = Processo.objects.select_related("cliente")
    serializer_class = ProcessoSerializer
    filterset_fields = ["status", "tipo", "risco", "fase", "probabilidade_perda", "cliente"]
    search_fields = ["titulo", "numero_cnj", "parte", "parte_contraria", "advogado"]
    ordering_fields = ["created_at", "prazo_proximo", "valor_causa", "valor_estimado_perda"]

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .annotate(andamentos_count=Count("andamentos", filter=Q(andamentos__is_active=True)))
            .order_by("-created_at")
        )

    @action(detail=True, methods=["post"])
    def sincronizar(self, request, pk=None):
        """Busca os andamentos no DataJud (CNJ)."""
        from juridico.datajud import DataJudError, sincronizar

        processo = self.get_object()
        try:
            return Response(sincronizar(processo))
        except DataJudError as exc:
            return Response({"detail": str(exc)}, status=400)


class AndamentoViewSet(_Base):
    queryset = Andamento.objects.select_related("processo")
    serializer_class = AndamentoSerializer
    filterset_fields = ["processo", "origem"]
    ordering_fields = ["data"]


class ContratoViewSet(_Base):
    queryset = Contrato.objects.select_related("parceiro")
    serializer_class = ContratoSerializer
    filterset_fields = ["status", "tipo", "renovacao", "parceiro"]
    search_fields = ["titulo", "partes", "responsavel"]
    ordering_fields = ["created_at", "data_fim", "valor_anual"]


class PrazoViewSet(_Base):
    queryset = Prazo.objects.select_related("processo", "contrato")
    serializer_class = PrazoSerializer
    filterset_fields = ["tipo", "urgencia", "concluido", "processo", "contrato"]
    search_fields = ["titulo", "responsavel"]
    ordering_fields = ["prazo", "urgencia"]

    @action(detail=False, methods=["post"])
    def calcular(self, request):
        """Calculadora: intimação + N dias (úteis/corridos) → vencimento e dias pulados."""
        from juridico.prazos import calcular

        try:
            inicio = date.fromisoformat(str(request.data.get("inicio")))
            dias = int(request.data.get("dias"))
            r = calcular(inicio, dias, request.data.get("contagem") or "uteis")
        except (TypeError, ValueError) as exc:
            return Response({"detail": f"Dados inválidos: {exc}"}, status=400)
        return Response({"vencimento": r["vencimento"].isoformat(), "pulados": r["pulados"]})


# ─── Documentos e modelos ────────────────────────────────────────────────────


class ModeloViewSet(_Base):
    queryset = ModeloDocumento.objects.all()
    serializer_class = ModeloDocumentoSerializer
    filterset_fields = ["tipo"]
    search_fields = ["nome", "descricao"]

    @action(detail=False, methods=["post"])
    def padrao(self, request):
        """Cria os modelos padrão que ainda não existem (contrato, NDA, procuração, notificação)."""
        from juridico.modelos import PADRAO

        criados = 0
        for m in PADRAO:
            _, novo = ModeloDocumento.objects.get_or_create(
                tenant_id=request.tenant_id,
                nome=m["nome"],
                is_active=True,
                defaults={"tipo": m["tipo"], "descricao": m["descricao"], "corpo": m["corpo"]},
            )
            criados += int(novo)
        return Response({"criados": criados})

    @action(detail=True, methods=["post"])
    def gerar(self, request, pk=None):
        """Preenche o modelo com dados de processo/contrato/parceiro e cria o Documento."""
        from erp.models import ParceiroNegocio
        from juridico.modelos import contexto, render

        modelo = self.get_object()
        tid = request.tenant_id

        def get(model, key):
            pk_ = request.data.get(key)
            return (
                model.objects.filter(pk=pk_, tenant_id=tid, is_active=True).first() if pk_ else None
            )

        processo, contrato = get(Processo, "processo"), get(Contrato, "contrato")
        parceiro = get(ParceiroNegocio, "parceiro")
        texto, faltando = render(modelo.corpo, contexto(tid, processo, contrato, parceiro))
        doc = Documento.objects.create(
            tenant_id=tid,
            titulo=(request.data.get("titulo") or modelo.nome)[:255],
            tipo=modelo.tipo,
            modelo=modelo,
            processo=processo,
            contrato=contrato,
            conteudo=texto,
        )
        data = DocumentoSerializer(doc, context={"request": request}).data
        return Response({**data, "faltando": faltando}, status=201)


class DocumentoViewSet(_Base):
    queryset = Documento.objects.select_related("processo", "contrato").prefetch_related(
        "assinaturas"
    )
    serializer_class = DocumentoSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    filterset_fields = ["tipo", "status", "processo", "contrato"]
    search_fields = ["titulo", "nome_arquivo"]

    def perform_create(self, serializer):
        arquivo = self.request.FILES.get("arquivo")
        doc = serializer.save(tenant_id=self.request.tenant_id)
        if arquivo:
            self._guardar(doc, arquivo)

    def perform_update(self, serializer):
        if serializer.instance.status in ("em_assinatura", "assinado"):
            from rest_framework.exceptions import ValidationError

            raise ValidationError(
                {
                    "detail": (
                        "Documento em assinatura ou assinado não pode mudar. "
                        "Crie uma nova versão."
                    )
                }
            )
        doc = serializer.save()
        arquivo = self.request.FILES.get("arquivo")
        if arquivo:
            doc.versao += 1
            self._guardar(doc, arquivo)

    def _guardar(self, doc, arquivo):
        from rest_framework.exceptions import ValidationError

        if arquivo.size > MAX_UPLOAD:
            raise ValidationError({"arquivo": "Arquivo maior que 20 MB."})
        data = arquivo.read()
        if arquivo.name.lower().endswith(".pdf") and not data.startswith(b"%PDF"):
            raise ValidationError({"arquivo": "O arquivo não parece ser um PDF válido."})
        doc.arquivo.save(arquivo.name, ContentFile(data), save=False)
        doc.nome_arquivo, doc.tamanho, doc.sha256 = (
            arquivo.name[:255],
            len(data),
            assin.sha256(data),
        )
        doc.save()

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        """Ver o documento como PDF (arquivo enviado ou texto gerado de modelo)."""
        doc = self.get_object()
        if doc.arquivo and not doc.arquivo.name.lower().endswith(".pdf"):
            return FileResponse(
                doc.arquivo.open("rb"), as_attachment=True, filename=doc.nome_arquivo
            )
        try:
            return _pdf_response(assin.pdf_do_documento(doc), f"{doc.titulo[:60]}.pdf")
        except assin.AssinaturaError as exc:
            return Response({"detail": str(exc)}, status=400)


# ─── Assinatura eletrônica (lado da empresa) ─────────────────────────────────


class SolicitacaoViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    queryset = SolicitacaoAssinatura.objects.select_related("documento").prefetch_related(
        "signatarios"
    )
    serializer_class = SolicitacaoSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = ErpPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["status", "documento"]
    search_fields = ["titulo", "signatarios__nome", "signatarios__email"]

    def create(self, request):
        ser = NovaSolicitacaoSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        doc = Documento.objects.filter(
            pk=d["documento"], tenant_id=request.tenant_id, is_active=True
        ).first()
        if doc is None:
            return Response({"documento": "Documento não encontrado."}, status=400)
        quem = request.user.email or str(request.user.pk)
        try:
            sol = assin.criar(
                request.tenant_id,
                doc,
                d["signatarios"],
                titulo=d.get("titulo", ""),
                mensagem=d.get("mensagem", ""),
                exigir_codigo_email=d["exigir_codigo_email"],
                ordem_sequencial=d["ordem_sequencial"],
                expira_dias=d["expira_dias"],
                criado_por=quem,
            )
            envio = assin.enviar(sol, quem) if d["enviar_agora"] else None
        except assin.AssinaturaError as exc:
            return Response({"detail": str(exc)}, status=400)
        sol.refresh_from_db()
        return Response({**SolicitacaoSerializer(sol).data, "envio": envio}, status=201)

    @action(detail=True, methods=["post"])
    def enviar(self, request, pk=None):
        try:
            return Response(assin.enviar(self.get_object(), request.user.email or ""))
        except assin.AssinaturaError as exc:
            return Response({"detail": str(exc)}, status=400)

    @action(detail=True, methods=["post"])
    def cancelar(self, request, pk=None):
        try:
            assin.cancelar(
                self.get_object(), request.user.email or "", str(request.data.get("motivo") or "")
            )
        except assin.AssinaturaError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(SolicitacaoSerializer(self.get_object()).data)

    @action(detail=True, methods=["get"])
    def links(self, request, pk=None):
        """Links individuais (pra mandar por WhatsApp etc. enquanto não há caixa de e-mail)."""
        sol = self.get_object()
        return Response(
            [
                {
                    "signatario": s.id,
                    "nome": s.nome,
                    "email": s.email,
                    "status": s.status,
                    "link": assin.link_de(s),
                }
                for s in sol.signatarios.all()
            ]
        )

    @action(detail=True, methods=["post"])
    def reenviar(self, request, pk=None):
        sol = self.get_object()
        sig = sol.signatarios.filter(pk=request.data.get("signatario")).first()
        if sig is None or assin.pode_assinar(sig):
            return Response({"detail": "Esse signatário não pode assinar agora."}, status=400)
        return Response({"enviado": assin._convidar(sig, request.user.email or "")})

    @action(detail=True, methods=["get"])
    def eventos(self, request, pk=None):
        sol = self.get_object()
        return Response(
            {
                "trilha_integra": assin.trilha_integra(sol),
                "eventos": EventoSerializer(
                    sol.eventos.select_related("signatario"), many=True
                ).data,
            }
        )

    @action(detail=True, methods=["get"])
    def arquivo(self, request, pk=None):
        """?via=original|assinada"""
        sol = self.get_object()
        if request.query_params.get("via") == "assinada":
            if not sol.arquivo_assinado:
                return Response({"detail": "Ainda não concluída."}, status=404)
            return _pdf_response(
                _file_bytes(sol.arquivo_assinado), f"{sol.titulo[:60]} - assinado.pdf"
            )
        return _pdf_response(_file_bytes(sol.pdf_original), f"{sol.titulo[:60]}.pdf")


# ─── Painel ──────────────────────────────────────────────────────────────────


class PainelView(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tid = request.tenant_id
        hoje = timezone.localdate()
        procs = Processo.objects.filter(tenant_id=tid, is_active=True)
        ativos = procs.filter(status__in=["em_andamento", "suspenso"])
        encerrados = procs.filter(status__in=["ganho", "perdido", "acordo"])
        n_enc = encerrados.count()
        exito = (
            round(100 * encerrados.filter(status__in=["ganho", "acordo"]).count() / n_enc)
            if n_enc
            else None
        )
        prazos = Prazo.objects.filter(tenant_id=tid, is_active=True, concluido=False)
        contratos = Contrato.objects.filter(tenant_id=tid, is_active=True).exclude(
            status="cancelado"
        )
        por_prob = {
            p: ativos.filter(probabilidade_perda=p).aggregate(v=Sum("valor_estimado_perda"))["v"]
            or 0
            for p in ("provavel", "possivel", "remota")
        }
        return Response(
            {
                "processos_ativos": ativos.count(),
                "valor_em_disputa": ativos.aggregate(v=Sum("valor_causa"))["v"] or 0,
                "provisao": por_prob["provavel"],
                "contingencia_possivel": por_prob["possivel"],
                "contingencia_remota": por_prob["remota"],
                "taxa_exito": exito,
                "encerrados": n_enc,
                "prazos_vencidos": prazos.filter(prazo__lt=hoje).count(),
                "prazos_7_dias": prazos.filter(
                    prazo__gte=hoje, prazo__lte=hoje + timedelta(days=7)
                ).count(),
                "contratos_vigentes": contratos.filter(status__in=["vigente", "expirando"]).count(),
                "contratos_vencendo_30": contratos.filter(
                    data_fim__gte=hoje, data_fim__lte=hoje + timedelta(days=30)
                ).count(),
                "assinaturas_pendentes": SolicitacaoAssinatura.objects.filter(
                    tenant_id=tid, status="enviada"
                ).count(),
                "por_tipo": list(ativos.values("tipo").annotate(n=Count("id")).order_by("-n")),
                "proximos_prazos": PrazoSerializer(
                    prazos.filter(prazo__lte=hoje + timedelta(days=15)).select_related(
                        "processo", "contrato"
                    )[:8],
                    many=True,
                ).data,
                "contratos_a_vencer": ContratoSerializer(
                    contratos.filter(
                        data_fim__gte=hoje, data_fim__lte=hoje + timedelta(days=60)
                    ).order_by("data_fim")[:6],
                    many=True,
                ).data,
            }
        )


# ─── Público: assinar pelo link e verificar documento ───────────────────────


def _meta(request):
    ip = request.META.get("REMOTE_ADDR")
    return ip, request.META.get("HTTP_USER_AGENT", "")


class _Publico(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "assinatura"

    def _sig(self, token):
        try:
            return assin.por_token(token), None
        except assin.AssinaturaError as exc:
            return None, Response({"detail": str(exc)}, status=404)


class AssinarInfoView(_Publico):
    def get(self, request, token):
        sig, err = self._sig(token)
        if err:
            return err
        sol = sig.solicitacao
        bloqueio = assin.pode_assinar(sig)
        if not bloqueio:
            assin.visualizou(sig, *_meta(request))
        empresa = ""
        from erp.models import DadosEmpresa

        e = DadosEmpresa.objects.filter(tenant_id=sol.tenant_id).first()
        if e:
            empresa = e.nome_fantasia or e.razao_social
        return Response(
            {
                "titulo": sol.titulo,
                "mensagem": sol.mensagem,
                "empresa": empresa,
                "remetente": sol.criado_por,
                "hash_original": sol.hash_original,
                "expira_em": sol.expira_em,
                "status": sol.status,
                "exigir_codigo_email": sol.exigir_codigo_email,
                "pedir_cpf": bool(sig.cpf_encrypted),
                "signatario": {
                    "nome": sig.nome,
                    "email": assin._mask_email(sig.email),
                    "papel": sig.get_papel_display(),
                    "status": sig.status,
                },
                "bloqueio": bloqueio,
                "concluida": sol.status == "concluida",
                "hash_assinado": sol.hash_assinado,
                "outros": [
                    {"nome": s.nome, "status": s.status}
                    for s in sol.signatarios.all()
                    if s.pk != sig.pk
                ],
            }
        )


class AssinarPdfView(_Publico):
    def get(self, request, token):
        sig, err = self._sig(token)
        if err:
            return err
        sol = sig.solicitacao
        if request.query_params.get("via") == "assinada" and sol.arquivo_assinado:
            return _pdf_response(
                _file_bytes(sol.arquivo_assinado), f"{sol.titulo[:60]} - assinado.pdf"
            )
        return _pdf_response(_file_bytes(sol.pdf_original), f"{sol.titulo[:60]}.pdf")


class AssinarCodigoView(_Publico):
    def post(self, request, token):
        sig, err = self._sig(token)
        if err:
            return err
        try:
            assin.enviar_codigo(sig, *_meta(request))
        except assin.AssinaturaError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"ok": True, "email": assin._mask_email(sig.email)})


class AssinarView(_Publico):
    def post(self, request, token):
        sig, err = self._sig(token)
        if err:
            return err
        try:
            sol = assin.assinar(
                sig,
                nome=str(request.data.get("nome") or ""),
                cpf=str(request.data.get("cpf") or ""),
                codigo=str(request.data.get("codigo") or ""),
                aceite=bool(request.data.get("aceite")),
                ip=_meta(request)[0],
                ua=_meta(request)[1],
            )
        except assin.AssinaturaError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(
            {"ok": True, "concluida": sol.status == "concluida", "hash_assinado": sol.hash_assinado}
        )


class RecusarView(_Publico):
    def post(self, request, token):
        sig, err = self._sig(token)
        if err:
            return err
        try:
            assin.recusar(sig, str(request.data.get("motivo") or ""), *_meta(request))
        except assin.AssinaturaError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"ok": True})


class VerificarView(_Publico):
    """POST com o PDF (campo `arquivo`) ou `hash`: diz se é um documento assinado aqui."""

    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        arquivo = request.FILES.get("arquivo")
        if arquivo:
            if arquivo.size > MAX_UPLOAD:
                return Response({"detail": "Arquivo maior que 20 MB."}, status=400)
            h = assin.sha256(arquivo.read())
        else:
            h = str(request.data.get("hash") or "")
        r = assin.verificar(h)
        if r is None:
            return Response({"encontrado": False, "hash": h}, status=status.HTTP_200_OK)
        return Response({"encontrado": True, "hash": h, **r})
