# backend_api/Api/observabilidade/registro.py
"""
Verificações por empresa são REGISTRADAS por quem conhece o assunto (o setor de TI
registra IA por setor, conectores, MCP, redes, e-mail, agentes) — a
observabilidade só roda e guarda. Mesmo padrão do `orchestration.registry`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


@dataclass
class Resultado:
    chave: str
    grupo: str
    nome: str
    status: str  # ok | alerta | falha | desconhecido
    detalhe: str = ""
    causa: str = ""
    acao: str = ""
    dados: dict = field(default_factory=dict)
    ms: int | None = None
    gravidade: str = "alta"


@dataclass
class Verificacao:
    nome: str
    fn: Callable  # fn(tenant_id) -> list[Resultado]
    intervalo: int = 60  # segundos entre execuções automáticas


_verificacoes: dict[str, Verificacao] = {}
_tenants: list[Callable] = []


def registrar_verificacao(nome: str, intervalo: int = 60):
    def deco(fn):
        _verificacoes[nome] = Verificacao(nome, fn, intervalo)
        return fn

    return deco


def registrar_fonte_de_tenants(fn: Callable) -> Callable:
    """fn() -> iterável de tenant_ids que têm algo a verificar."""
    _tenants.append(fn)
    return fn


def verificacoes() -> list[Verificacao]:
    return list(_verificacoes.values())


def tenants() -> set:
    out = set()
    for fn in _tenants:
        try:
            out |= {t for t in fn() if t}
        except Exception:  # noqa: BLE001
            continue
    return out
