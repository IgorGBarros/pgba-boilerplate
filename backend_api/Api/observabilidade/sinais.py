# backend_api/Api/observabilidade/sinais.py
"""Quem quiser agir quando um incidente abre/fecha (ex.: o setor de TI abre chamado)."""
from django.dispatch import Signal

# kwargs: incidente (Incidente)
incidente_aberto = Signal()
incidente_resolvido = Signal()
