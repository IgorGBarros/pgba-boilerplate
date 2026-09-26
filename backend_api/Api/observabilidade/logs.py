# backend_api/Api/observabilidade/logs.py
"""
Handler de log: todo ERROR/CRITICAL vira um EventoErro agrupado pela "impressão
digital" (logger + tipo da exceção + mensagem-modelo + linha de origem) — mil
repetições do mesmo erro são 1 linha com 1.000 ocorrências.

Mensagem e trace passam por `redact_pii` (CPF, e-mail, telefone). Nunca levanta,
nunca entra em recursão (erro ao gravar o erro é ignorado).
"""
from __future__ import annotations

import hashlib
import logging
import threading
import traceback
from pathlib import Path

_local = threading.local()
IGNORAR = ("django.db.backends", "observabilidade")


class EventoErroHandler(logging.Handler):
    def __init__(self, level=logging.ERROR):
        super().__init__(level)

    def emit(self, record: logging.LogRecord) -> None:
        if getattr(_local, "gravando", False) or record.name.startswith(IGNORAR):
            return
        _local.gravando = True
        try:
            self._gravar(record)
        except Exception:  # noqa: BLE001 — sem banco / transação quebrada: deixa pra lá
            pass
        finally:
            _local.gravando = False

    def _gravar(self, record: logging.LogRecord) -> None:
        from django.db.models import F
        from django.utils import timezone

        from core.utils.lgpd import redact_pii
        from observabilidade.models import EventoErro

        tipo = record.exc_info[0].__name__ if record.exc_info and record.exc_info[0] else ""
        origem = f"{'/'.join(Path(record.pathname).parts[-2:])}:{record.lineno}"
        base = f"{record.name}|{tipo}|{record.msg}|{origem}"
        impressao = hashlib.sha1(base.encode("utf-8", "replace")).hexdigest()
        mensagem = redact_pii(record.getMessage())[:2000]
        trace = ""
        if record.exc_info:
            trace = redact_pii("".join(traceback.format_exception(*record.exc_info)))[-6000:]
        agora = timezone.now()
        atualizados = EventoErro.objects.filter(impressao=impressao).update(
            ocorrencias=F("ocorrencias") + 1, ultimo=agora, mensagem=mensagem, resolvido=False
        )
        if not atualizados:
            EventoErro.objects.create(
                impressao=impressao,
                logger=record.name[:200],
                nivel=record.levelname,
                mensagem=mensagem,
                trace=trace,
                origem=origem[:300],
                primeiro=agora,
                ultimo=agora,
            )
