# backend_api/Api/observabilidade/coletor.py
"""
Contadores por minuto em memória, gravados em lote (a cada 10 s ou 300 chaves).
Nada de uma escrita no banco por requisição: o que vai ao banco é um UPSERT que
SOMA no minuto (várias instâncias do backend/worker somam juntas).

Banco fora do ar: o lote é descartado (com teto) — medir nunca derruba o sistema.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone as dt_tz

from observabilidade.models import PLATAFORMA

logger = logging.getLogger(__name__)

INTERVALO = 10.0
MAX_CHAVES = 300

_lock = threading.Lock()
_buffer: dict[tuple, list[int]] = {}
_ultimo_flush = time.monotonic()


def _minuto() -> datetime:
    agora = datetime.now(dt_tz.utc)
    return agora.replace(second=0, microsecond=0)


def registrar(
    tipo: str, chave: str, ms: int, erro: bool = False, erro_cliente: bool = False, tenant_id=None
) -> None:
    k = (str(tenant_id or PLATAFORMA), _minuto(), tipo, chave[:200])
    with _lock:
        v = _buffer.setdefault(k, [0, 0, 0, 0, 0])
        v[0] += 1
        v[1] += int(erro)
        v[2] += int(erro_cliente)
        v[3] += max(0, int(ms))
        v[4] = max(v[4], int(ms))
        cheio = len(_buffer) >= MAX_CHAVES
    if cheio or time.monotonic() - _ultimo_flush >= INTERVALO:
        gravar()


SQL = """
INSERT INTO observabilidade_metrica
    (tenant_id, minuto, tipo, chave, total, erros, erros_cliente, ms_total, ms_max)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (tenant_id, minuto, tipo, chave) DO UPDATE SET
    total = observabilidade_metrica.total + EXCLUDED.total,
    erros = observabilidade_metrica.erros + EXCLUDED.erros,
    erros_cliente = observabilidade_metrica.erros_cliente + EXCLUDED.erros_cliente,
    ms_total = observabilidade_metrica.ms_total + EXCLUDED.ms_total,
    ms_max = GREATEST(observabilidade_metrica.ms_max, EXCLUDED.ms_max)
"""


def gravar() -> int:
    global _ultimo_flush
    with _lock:
        lote = list(_buffer.items())
        _buffer.clear()
        _ultimo_flush = time.monotonic()
    if not lote:
        return 0
    from django.db import connection

    try:
        with connection.cursor() as cur:
            cur.executemany(SQL, [(t, m, tp, c, *v) for (t, m, tp, c), v in lote])
    except Exception as exc:  # noqa: BLE001 — sem banco, as métricas deste lote se perdem
        logger.warning("Métricas não gravadas (%s): %s", len(lote), exc)
        return 0
    return len(lote)
