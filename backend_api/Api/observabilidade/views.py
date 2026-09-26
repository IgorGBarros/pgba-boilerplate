# backend_api/Api/observabilidade/views.py
from __future__ import annotations

from datetime import timedelta

from django.db.models import Count, Max, Q, Sum
from django.db.models.functions import TruncHour
from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from core.mixins import TenantContextMixin
from observabilidade import motor, plataforma
from observabilidade.models import (
    PLATAFORMA,
    Amostra,
    EstadoComponente,
    EventoErro,
    Incidente,
    Metrica,
)

ORDEM = {"falha": 0, "alerta": 1, "desconhecido": 2, "ok": 3}


def _staff(request) -> bool:
    return bool(getattr(request.user, "is_staff", False))


def _escopos(request) -> list:
    """Empresa vê o dela + a plataforma (banco, fila, workers: é de todos). O detalhe
    técnico da plataforma (hosts, tamanhos) só a equipe da plataforma vê — `_enxuto`."""
    out = [request.tenant_id] if getattr(request, "tenant_id", None) else []
    out.append(PLATAFORMA)
    return out


def _enxuto(request, d: dict) -> dict:
    if d.get("plataforma") and not _staff(request):
        d["detalhe"], d["dados"] = "", {}
    return d


class SaudePublicaView(APIView):
    """Status da plataforma sem login — funciona com o banco fora (é quando mais importa)."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "status_publico"

    def get(self, request):
        resultados = plataforma.todas()
        # "sem dado" (ex.: agendador ainda sem batimento) não é instabilidade
        status = {r.status for r in resultados}
        pior = "falha" if "falha" in status else "alerta" if "alerta" in status else "ok"
        return Response(
            {
                "status": pior,
                "verificado_em": timezone.now(),
                "componentes": [
                    {"nome": r.nome, "status": r.status, "causa": r.causa, "acao": r.acao}
                    for r in resultados
                ],
            },
            status=503 if pior == "falha" else 200,
        )


class _Base(TenantContextMixin, APIView):
    permission_classes = [IsAuthenticated]


def _estado_json(e: EstadoComponente, uptime: dict) -> dict:
    return {
        "id": e.id,
        "chave": e.chave,
        "grupo": e.grupo,
        "nome": e.nome,
        "status": e.status,
        "detalhe": e.detalhe,
        "causa": e.causa,
        "acao": e.acao,
        "dados": e.dados,
        "ms": e.ms,
        "desde": e.desde,
        "verificado_em": e.verificado_em,
        "plataforma": e.tenant_id == PLATAFORMA,
        "disponibilidade_24h": uptime.get((e.tenant_id, e.chave)),
    }


def _componentes(request) -> list[dict]:
    escopos = _escopos(request)
    estados = list(EstadoComponente.objects.filter(tenant_id__in=escopos))
    desde = timezone.now() - timedelta(hours=24)
    uptime = {}
    for row in (
        Amostra.objects.filter(tenant_id__in=escopos, em__gte=desde)
        .values("tenant_id", "chave")
        .annotate(total=Count("id"), bons=Count("id", filter=Q(status__in=["ok", "alerta"])))
    ):
        uptime[(row["tenant_id"], row["chave"])] = round(100 * row["bons"] / row["total"], 1)
    estados.sort(key=lambda e: (ORDEM.get(e.status, 9), e.grupo, e.nome))
    return [_enxuto(request, _estado_json(e, uptime)) for e in estados]


class PainelView(_Base):
    def get(self, request):
        comps = _componentes(request)
        escopos = _escopos(request)
        abertos = Incidente.objects.filter(tenant_id__in=escopos, status="aberto")
        desde = timezone.now() - timedelta(hours=24)
        # Métrica da plataforma (requisições sem login) é de todos: só a equipe vê
        metricas = Metrica.objects.filter(minuto__gte=desde)
        if not _staff(request):
            metricas = metricas.filter(tenant_id=request.tenant_id)
        soma = {"total": Sum("total"), "erros": Sum("erros"), "ms": Sum("ms_total")}
        api = metricas.filter(tipo="api").aggregate(**soma)
        ia = metricas.filter(tipo="ia").aggregate(**soma)
        contagem = {s: sum(1 for c in comps if c["status"] == s) for s in ORDEM}
        return Response(
            {
                "staff": _staff(request),
                "contagem": contagem,
                "componentes": comps,
                "incidentes_abertos": [_enxuto(request, _incidente_json(i)) for i in abertos[:20]],
                "api_24h": _resumo(api),
                "ia_24h": _resumo(ia),
                "erros_abertos": EventoErro.objects.filter(resolvido=False).count()
                if _staff(request)
                else None,
                "ultima_verificacao": max((c["verificado_em"] for c in comps), default=None),
            }
        )


def _resumo(agg: dict) -> dict:
    total, erros = agg.get("total") or 0, agg.get("erros") or 0
    return {
        "total": total,
        "erros": erros,
        "taxa_erro": round(100 * erros / total, 2) if total else 0,
        "ms_medio": int((agg.get("ms") or 0) / total) if total else None,
    }


class VerificarView(_Base):
    def post(self, request):
        if getattr(request, "tenant_id", None):
            motor.rodar_tenant(request.tenant_id, forcar=True)
        if _staff(request):
            motor.rodar_plataforma()
        return Response(_componentes(request))


def _incidente_json(i: Incidente) -> dict:
    return {
        "id": i.id,
        "chave": i.chave,
        "grupo": i.grupo,
        "titulo": i.titulo,
        "gravidade": i.gravidade,
        "status": i.status,
        "aberto_em": i.aberto_em,
        "resolvido_em": i.resolvido_em,
        "duracao_min": i.duracao_min,
        "detalhe": i.detalhe,
        "causa": i.causa,
        "acao": i.acao,
        "dados": i.dados,
        "diagnostico": i.diagnostico,
        "chamado_id": i.chamado_id,
        "reconhecido_por": i.reconhecido_por,
        "reconhecido_em": i.reconhecido_em,
        "plataforma": i.tenant_id == PLATAFORMA,
    }


class IncidentesView(_Base):
    def get(self, request):
        qs = Incidente.objects.filter(tenant_id__in=_escopos(request))
        if st := request.GET.get("status"):
            qs = qs.filter(status=st)
        return Response([_enxuto(request, _incidente_json(i)) for i in qs[:200]])


class IncidenteDetalheView(_Base):
    def get(self, request, pk):
        i = Incidente.objects.filter(pk=pk, tenant_id__in=_escopos(request)).first()
        if i is None:
            return Response({"detail": "Incidente não encontrado."}, status=404)
        serie = list(
            Amostra.objects.filter(
                tenant_id=i.tenant_id,
                chave=i.chave,
                em__gte=i.aberto_em - timedelta(hours=1),
                em__lte=(i.resolvido_em or timezone.now()) + timedelta(minutes=30),
            )
            .order_by("em")
            .values("em", "status", "ms")[:500]
        )
        return Response({**_enxuto(request, _incidente_json(i)), "amostras": serie})

    def post(self, request, pk):
        """Reconhecer: alguém está olhando (incidente da plataforma: só a equipe dela)."""
        escopos = _escopos(request) if _staff(request) else [request.tenant_id]
        i = Incidente.objects.filter(pk=pk, tenant_id__in=escopos).first()
        if i is None:
            return Response({"detail": "Incidente não encontrado."}, status=404)
        i.reconhecido_por = getattr(request.user, "email", "") or str(request.user.pk)
        i.reconhecido_em = timezone.now()
        i.save(update_fields=["reconhecido_por", "reconhecido_em"])
        return Response(_enxuto(request, _incidente_json(i)))


class MetricasView(_Base):
    """Por chave (rota, provedor:modelo ou host): volume, erros, latência; + série por hora."""

    def get(self, request):
        tipo = request.GET.get("tipo", "api")
        if tipo not in ("api", "ia", "http"):
            return Response({"detail": "tipo inválido"}, status=400)
        if tipo == "http" and not _staff(request):
            return Response({"detail": "Só a equipe da plataforma vê as saídas HTTP."}, status=403)
        try:
            horas = max(1, min(int(request.GET.get("horas") or 24), 24 * 30))
        except ValueError:
            horas = 24
        desde = timezone.now() - timedelta(hours=horas)
        qs = Metrica.objects.filter(tipo=tipo, minuto__gte=desde)
        if not _staff(request):
            qs = qs.filter(tenant_id=request.tenant_id)
        linhas = []
        for r in (
            qs.values("chave")
            .annotate(
                total=Sum("total"),
                erros=Sum("erros"),
                erros_cliente=Sum("erros_cliente"),
                ms=Sum("ms_total"),
                ms_max=Max("ms_max"),
            )
            .order_by("-total")[:100]
        ):
            linhas.append(
                {
                    "chave": r["chave"],
                    "total": r["total"],
                    "erros": r["erros"],
                    "erros_cliente": r["erros_cliente"],
                    "taxa_erro": round(100 * r["erros"] / r["total"], 2) if r["total"] else 0,
                    "ms_medio": int(r["ms"] / r["total"]) if r["total"] else None,
                    "ms_max": r["ms_max"],
                }
            )
        serie = [
            {
                "hora": r["hora"],
                "total": r["t"],
                "erros": r["e"],
                "ms_medio": int(r["ms"] / r["t"]) if r["t"] else None,
            }
            for r in qs.annotate(hora=TruncHour("minuto"))
            .values("hora")
            .annotate(t=Sum("total"), e=Sum("erros"), ms=Sum("ms_total"))
            .order_by("hora")
        ]
        return Response({"tipo": tipo, "horas": horas, "linhas": linhas, "serie": serie})


class ErrosView(_Base):
    def get(self, request):
        if not _staff(request):
            return Response({"detail": "Só a equipe da plataforma vê o log de erros."}, status=403)
        qs = EventoErro.objects.all()
        if request.GET.get("todos") != "1":
            qs = qs.filter(resolvido=False)
        return Response(
            [
                {
                    "id": e.id,
                    "logger": e.logger,
                    "nivel": e.nivel,
                    "mensagem": e.mensagem,
                    "trace": e.trace,
                    "origem": e.origem,
                    "ocorrencias": e.ocorrencias,
                    "primeiro": e.primeiro,
                    "ultimo": e.ultimo,
                    "resolvido": e.resolvido,
                }
                for e in qs[:200]
            ]
        )

    def post(self, request):
        if not _staff(request):
            return Response(status=403)
        n = EventoErro.objects.filter(pk__in=request.data.get("ids") or []).update(resolvido=True)
        return Response({"resolvidos": n})
