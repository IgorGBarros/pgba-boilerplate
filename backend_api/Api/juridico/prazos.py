# backend_api/Api/juridico/prazos.py
"""
Contagem de prazo processual — funções puras.

- CPC art. 219: em dias úteis (prazos processuais);
- art. 224: exclui o dia do começo e inclui o do vencimento; começa no 1º dia
  útil seguinte à intimação; vencimento em dia não útil passa pro próximo útil;
- art. 220: suspensão de 20/12 a 20/01 (recesso) — esses dias não contam.

Feriados: só os NACIONAIS (fixos + móveis da Páscoa, incl. Carnaval, que o
Judiciário não tem expediente). Feriado estadual/municipal e ponto
facultativo do tribunal ficam em `extra_feriados` — sempre confira no
calendário do tribunal; a tela avisa isso.
"""
from __future__ import annotations

from datetime import date, timedelta

FIXOS = [
    (1, 1, "Confraternização Universal"),
    (4, 21, "Tiradentes"),
    (5, 1, "Dia do Trabalho"),
    (9, 7, "Independência"),
    (10, 12, "Nossa Senhora Aparecida"),
    (11, 2, "Finados"),
    (11, 15, "Proclamação da República"),
    (11, 20, "Consciência Negra"),
    (12, 25, "Natal"),
]


def pascoa(ano: int) -> date:
    """Algoritmo de Meeus/Jones/Butcher (calendário gregoriano)."""
    a, b, c = ano % 19, ano // 100, ano % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    m = (32 + 2 * e + 2 * i - h - k) % 7
    n = (a + 11 * h + 22 * m) // 451
    mes = (h + m - 7 * n + 114) // 31
    dia = (h + m - 7 * n + 114) % 31 + 1
    return date(ano, mes, dia)


def feriados(ano: int) -> dict[date, str]:
    out = {date(ano, m, d): nome for m, d, nome in FIXOS}
    p = pascoa(ano)
    out[p - timedelta(days=48)] = "Carnaval (segunda)"
    out[p - timedelta(days=47)] = "Carnaval (terça)"
    out[p - timedelta(days=2)] = "Sexta-feira Santa"
    out[p + timedelta(days=60)] = "Corpus Christi"
    return out


def em_recesso(d: date) -> bool:
    return (d.month == 12 and d.day >= 20) or (d.month == 1 and d.day <= 20)


def motivo_nao_util(
    d: date, extra: dict[date, str] | None = None, recesso: bool = True
) -> str | None:
    if d.weekday() >= 5:
        return "fim de semana"
    nome = (extra or {}).get(d) or feriados(d.year).get(d)
    if nome:
        return nome
    if recesso and em_recesso(d):
        return "recesso forense (CPC 220)"
    return None


def calcular(
    inicio: date,
    dias: int,
    contagem: str = "uteis",
    extra_feriados: dict[date, str] | None = None,
    recesso: bool = True,
) -> dict:
    """
    `inicio` = data da intimação/publicação. Devolve o vencimento e o que foi
    pulado (pra tela mostrar o porquê de cada dia).
    """
    if dias < 1:
        raise ValueError("O prazo tem que ter pelo menos 1 dia.")
    pulados: list[dict] = []

    def nao_util(d):
        motivo = motivo_nao_util(d, extra_feriados, recesso)
        if motivo and motivo != "fim de semana":
            pulados.append({"data": d.isoformat(), "motivo": motivo})
        return motivo

    d = inicio
    if contagem == "uteis":
        restantes = dias
        while restantes:
            d += timedelta(days=1)
            if not nao_util(d):
                restantes -= 1
    else:
        # corridos: todo dia conta, menos os do recesso (suspensão); vencimento útil
        restantes = dias
        while restantes:
            d += timedelta(days=1)
            if recesso and em_recesso(d):
                pulados.append({"data": d.isoformat(), "motivo": "recesso forense (CPC 220)"})
                continue
            restantes -= 1
        while nao_util(d):
            d += timedelta(days=1)
    vistos, unicos = set(), []
    for p in pulados:
        if p["data"] not in vistos:
            vistos.add(p["data"])
            unicos.append(p)
    return {"vencimento": d, "pulados": unicos}
