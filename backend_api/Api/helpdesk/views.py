# backend_api/Api/helpdesk/views.py
from __future__ import annotations

from datetime import timedelta

from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Max, Q, Sum
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from agency.views import TenantScopedMixin
from core.mixins import SoftDeleteViewMixin, TenantContextMixin
from helpdesk import equipe, services
from helpdesk.models import EquipamentoTI, Ticket
from helpdesk.serializers import EquipamentoTISerializer, InteracaoSerializer, TicketSerializer


class Paginacao(PageNumberPagination):
    """20 por padrão; a tela pode pedir até 500 com `?page_size=` (mesmo contrato do ErpCrud)."""

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 500


def _quem(request) -> str:
    return getattr(request.user, "email", "") or str(getattr(request.user, "pk", ""))


def _erro(msg, code=400):
    return Response({"detail": str(msg)}, status=code)


def _texto(request, campo: str, n: int = 8000) -> str:
    return str(request.data.get(campo) or "")[:n]


class TicketViewSet(
    SoftDeleteViewMixin, TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet
):
    queryset = Ticket.objects.select_related("setor", "agente", "task").annotate(
        interacoes_count=Count("interacoes")
    )
    serializer_class = TicketSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = Paginacao
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = [
        "status",
        "prioridade",
        "categoria",
        "origem",
        "agente",
        "setor",
        "incidente_id",
    ]
    search_fields = ["titulo", "solicitante", "atendente", "descricao"]
    ordering_fields = ["created_at", "prioridade", "prazo_sla"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("abertos") == "1":
            qs = qs.exclude(status__in=("resolvido", "fechado"))
        return qs

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        t = services.abrir_chamado(
            request.tenant_id,
            d["titulo"],
            d.get("descricao", ""),
            solicitante=d.get("solicitante") or _quem(request),
            categoria=d.get("categoria", "outro"),
            prioridade=d.get("prioridade", "media"),
            setor_id=d["setor"].id if d.get("setor") else None,
            autor=_quem(request),
        )
        return Response(self.get_serializer(self.get_queryset().get(pk=t.pk)).data, status=201)

    def _ok(self, pk):
        return Response(self.get_serializer(self.get_queryset().get(pk=pk)).data)

    def _rodar(self, fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs), None
        except services.ChamadoNaoEncontrado as exc:
            return None, _erro(exc, 404)
        except services.ChamadoError as exc:
            return None, _erro(exc)

    @action(detail=True, methods=["get"])
    def interacoes(self, request, pk=None):
        t = self.get_object()
        return Response(InteracaoSerializer(t.interacoes.all(), many=True).data)

    @action(detail=True, methods=["post"], url_path="atender-ia")
    def atender_ia(self, request, pk=None):
        from harness.providers import ProviderConfigError

        try:
            i = services.atender_com_ia(
                request.tenant_id, pk, _texto(request, "instrucoes", 800), _quem(request)
            )
        except services.ChamadoNaoEncontrado as exc:
            return _erro(exc, 404)
        except services.ChamadoError as exc:
            return _erro(exc)
        except ProviderConfigError as exc:
            return _erro(f"IA do TI sem credencial: {exc}")
        return Response(InteracaoSerializer(i).data, status=201)

    @action(detail=True, methods=["post"])
    def responder(self, request, pk=None):
        i, err = self._rodar(
            services.responder,
            request.tenant_id,
            pk,
            _texto(request, "texto"),
            _quem(request),
            aguardar=bool(request.data.get("aguardar")),
        )
        return err or Response(InteracaoSerializer(i).data, status=201)

    @action(detail=True, methods=["post"])
    def comentar(self, request, pk=None):
        i, err = self._rodar(
            services.comentar, request.tenant_id, pk, _texto(request, "texto"), _quem(request)
        )
        return err or Response(InteracaoSerializer(i).data, status=201)

    @action(detail=True, methods=["post"])
    def resolver(self, request, pk=None):
        _, err = self._rodar(
            services.resolver, request.tenant_id, pk, _texto(request, "solucao"), _quem(request)
        )
        return err or self._ok(pk)

    @action(detail=True, methods=["post"])
    def reabrir(self, request, pk=None):
        _, err = self._rodar(
            services.reabrir, request.tenant_id, pk, _texto(request, "motivo", 500), _quem(request)
        )
        return err or self._ok(pk)

    @action(detail=True, methods=["post"])
    def fechar(self, request, pk=None):
        _, err = self._rodar(services.fechar, request.tenant_id, pk, _quem(request))
        return err or self._ok(pk)

    @action(detail=True, methods=["post"])
    def atribuir(self, request, pk=None):
        _, err = self._rodar(
            services.atribuir,
            request.tenant_id,
            pk,
            papel=str(request.data.get("papel") or ""),
            agente_id=request.data.get("agente") or None,
            autor=_quem(request),
        )
        return err or self._ok(pk)

    @action(detail=True, methods=["post"])
    def prioridade(self, request, pk=None):
        t = self.get_object()
        p = str(request.data.get("prioridade") or "")
        if p not in services.SLA_HORAS:
            return _erro("Prioridade inválida.")
        horas = services.SLA_HORAS[p]
        t.prioridade, t.sla_horas, t.prazo_sla = p, horas, t.created_at + timedelta(hours=horas)
        t.save(update_fields=["prioridade", "sla_horas", "prazo_sla"])
        services.interacao(
            t,
            "sistema",
            f"Prioridade alterada para {t.get_prioridade_display()} (SLA {horas}h).",
            autor=_quem(request),
        )
        return self._ok(pk)


class EquipamentoTIViewSet(
    SoftDeleteViewMixin, TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet
):
    queryset = EquipamentoTI.objects.all()
    serializer_class = EquipamentoTISerializer
    permission_classes = [IsAuthenticated]
    pagination_class = Paginacao
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "tipo"]
    search_fields = ["codigo", "nome", "usuario", "setor"]
    ordering_fields = ["codigo", "nome", "ultima_revisao"]


class _Base(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]


def _agente_json(a, abertos: dict) -> dict:
    return {
        "id": a.id,
        "nome": a.name,
        "cargo": a.role,
        "papel": equipe.papel_de(a),
        "nivel": a.access_level,
        "work_status": a.work_status,
        "tarefa_atual": a.current_task,
        "chamados_abertos": abertos.get(a.id, 0),
        "tem_skill": bool(a.instructions),
    }


class EquipeView(_Base):
    """GET: o time de TI. POST: monta (idempotente)."""

    def get(self, request):
        abertos = dict(
            Ticket.objects.filter(tenant_id=request.tenant_id, is_active=True)
            .exclude(status__in=("resolvido", "fechado"))
            .values_list("agente")
            .annotate(n=Count("id"))
        )
        s = equipe.setor(request.tenant_id)
        return Response(
            {
                "setor": {"id": s.id, "nome": s.name} if s else None,
                "agentes": [
                    _agente_json(a, abertos)
                    for a in equipe.agentes(request.tenant_id).order_by("id")
                ],
                "papeis": [
                    {"papel": p, "nome": v[0], "cargo": v[1]} for p, v in equipe.TIME.items()
                ],
            }
        )

    def post(self, request):
        return Response(equipe.montar(request.tenant_id), status=201)


class PainelTIView(_Base):
    """Números do helpdesk: fila, SLA, tempos (30 dias) e por categoria."""

    def get(self, request):
        agora = timezone.now()
        qs = Ticket.objects.filter(tenant_id=request.tenant_id, is_active=True)
        abertos = qs.exclude(status__in=("resolvido", "fechado"))
        mes = qs.filter(created_at__gte=agora - timedelta(days=30))

        def dur(a, b):
            return ExpressionWrapper(F(a) - F(b), output_field=DurationField())

        tempos = mes.aggregate(
            resposta=Avg(
                dur("primeira_resposta_em", "created_at"),
                filter=Q(primeira_resposta_em__isnull=False),
            ),
            resolucao=Avg(dur("resolvido_em", "created_at"), filter=Q(resolvido_em__isnull=False)),
        )
        resolvidos = mes.filter(resolvido_em__isnull=False, prazo_sla__isnull=False)
        no_prazo = resolvidos.filter(resolvido_em__lte=F("prazo_sla")).count()
        minutos = lambda d: int(d.total_seconds() // 60) if d else None  # noqa: E731
        return Response(
            {
                "abertos": abertos.count(),
                "por_status": dict(qs.values_list("status").annotate(n=Count("id"))),
                "por_prioridade": dict(abertos.values_list("prioridade").annotate(n=Count("id"))),
                "por_categoria": dict(mes.values_list("categoria").annotate(n=Count("id"))),
                "por_origem": dict(mes.values_list("origem").annotate(n=Count("id"))),
                "sla_estourado": abertos.filter(prazo_sla__lt=agora).count(),
                "sla_vencendo": abertos.filter(
                    prazo_sla__gte=agora, prazo_sla__lt=agora + timedelta(hours=2)
                ).count(),
                "sem_resposta": abertos.filter(primeira_resposta_em__isnull=True).count(),
                "mes": {
                    "abertos": mes.count(),
                    "resolvidos": mes.filter(resolvido_em__isnull=False).count(),
                    "no_prazo_pct": round(100 * no_prazo / resolvidos.count())
                    if resolvidos.count()
                    else None,
                    "primeira_resposta_min": minutos(tempos["resposta"]),
                    "resolucao_min": minutos(tempos["resolucao"]),
                },
                "tem_time": equipe.agentes(request.tenant_id).exists(),
            }
        )


class DiagnosticarIncidenteView(_Base):
    """POST: o time de TI (SRE/DBA/Integrações) escreve o diagnóstico do incidente."""

    def post(self, request, pk):
        from harness.providers import ProviderConfigError
        from helpdesk.ia import TIError
        from observabilidade.models import PLATAFORMA, Incidente

        inc = Incidente.objects.filter(pk=pk).first()
        permitido = inc is not None and (
            inc.tenant_id == request.tenant_id
            or (
                inc.tenant_id == PLATAFORMA
                and (
                    request.user.is_staff
                    or Ticket.objects.filter(tenant_id=request.tenant_id, incidente_id=pk).exists()
                )
            )
        )
        if not permitido:
            return _erro("Incidente não encontrado.", 404)
        if not Ticket.objects.filter(tenant_id=request.tenant_id, incidente_id=pk).exists():
            services.chamado_de_incidente(request.tenant_id, inc)
        try:
            return Response(services.diagnosticar(request.tenant_id, inc))
        except (TIError, ProviderConfigError) as exc:
            return _erro(exc)


class AgentesObsView(_Base):
    """
    Observabilidade de TODOS os agentes de todos os setores: chamadas de IA,
    custo, tokens, tarefas por status, falhas, aprovações pendentes e a última
    atividade — o que o time de TI olha quando "a IA do setor X parou".
    """

    def get(self, request):
        from agency.models import Agent, AgentInteraction, PendingApproval, Task

        tid = request.tenant_id
        horas = min(max(int(request.query_params.get("horas") or 24), 1), 24 * 30)
        desde = timezone.now() - timedelta(hours=horas)
        inter = {
            r["agent"]: r
            for r in AgentInteraction.objects.filter(tenant_id=tid, created_at__gte=desde)
            .values("agent")
            .annotate(n=Count("id"), custo=Sum("estimated_cost_usd"), tokens=Sum("tokens_used"))
        }
        ultima = dict(
            AgentInteraction.objects.filter(tenant_id=tid)
            .values_list("agent")
            .annotate(m=Max("created_at"))
        )
        tarefas: dict = {}
        for r in (
            Task.objects.filter(tenant_id=tid, updated_at__gte=desde)
            .values("agent", "status")
            .annotate(n=Count("id"))
        ):
            tarefas.setdefault(r["agent"], {})[r["status"]] = r["n"]
        falhas = dict(
            Task.objects.filter(tenant_id=tid, status=Task.Status.REJECTED, updated_at__gte=desde)
            .exclude(result__error__isnull=True)
            .values_list("agent")
            .annotate(n=Count("id"))
        )
        presas = dict(
            Task.objects.filter(
                tenant_id=tid,
                status=Task.Status.IN_PROGRESS,
                progress__lt=1.0,
                updated_at__lt=timezone.now() - timedelta(minutes=30),
            )
            .values_list("agent")
            .annotate(n=Count("id"))
        )
        aprov = dict(
            PendingApproval.objects.filter(tenant_id=tid, status=PendingApproval.Status.PENDING)
            .values_list("agent")
            .annotate(n=Count("id"))
        )
        provedores = dict(
            AgentInteraction.objects.filter(tenant_id=tid, created_at__gte=desde)
            .values_list("agent")
            .annotate(p=Max("provider"))
        )
        agentes, setores = [], {}
        for a in (
            Agent.objects.filter(tenant_id=tid, is_active=True)
            .select_related("sector")
            .order_by("sector__name", "name")
        ):
            i = inter.get(a.id, {})
            saude = (
                "falha"
                if falhas.get(a.id, 0) >= 2
                else ("alerta" if falhas.get(a.id) or presas.get(a.id) or aprov.get(a.id) else "ok")
            )
            linha = {
                "id": a.id,
                "nome": a.name,
                "cargo": a.role,
                "setor_id": a.sector_id,
                "setor": a.sector.name if a.sector else "Diretoria",
                "work_status": a.work_status,
                "tarefa_atual": a.current_task,
                "autonomia": a.autonomy_level,
                "chamadas": i.get("n", 0),
                "custo_usd": float(i.get("custo") or 0),
                "tokens": i.get("tokens") or 0,
                "ultima_atividade": ultima.get(a.id),
                "provedor": provedores.get(a.id) or a.default_provider or "",
                "tarefas": tarefas.get(a.id, {}),
                "falhas": falhas.get(a.id, 0),
                "presas": presas.get(a.id, 0),
                "aprovacoes_pendentes": aprov.get(a.id, 0),
                "saude": saude,
            }
            agentes.append(linha)
            s = setores.setdefault(
                linha["setor"],
                {
                    "setor": linha["setor"],
                    "setor_id": a.sector_id,
                    "agentes": 0,
                    "trabalhando": 0,
                    "chamadas": 0,
                    "custo_usd": 0.0,
                    "falhas": 0,
                    "alertas": 0,
                },
            )
            s["agentes"] += 1
            s["trabalhando"] += a.work_status == "working"
            s["chamadas"] += linha["chamadas"]
            s["custo_usd"] += linha["custo_usd"]
            s["falhas"] += linha["falhas"]
            s["alertas"] += saude != "ok"
        return Response({"horas": horas, "agentes": agentes, "setores": list(setores.values())})
