# backend_api/Api/marketing/verificacoes.py
"""Contas de redes sociais no monitoramento do TI (token com erro, vencido ou vencendo)."""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from observabilidade.registro import Resultado, registrar_verificacao


@registrar_verificacao("redes_sociais", intervalo=300)
def verificar_contas(tenant_id) -> list[Resultado]:
    from marketing.models import ContaSocial

    agora = timezone.now()
    out = []
    for c in ContaSocial.objects.filter(tenant_id=tenant_id, is_active=True):
        vencendo = c.expira_em and c.expira_em < agora + timedelta(days=7)
        vencida = c.status == "expirada" or (c.expira_em and c.expira_em < agora)
        st = "falha" if c.status == "erro" or vencida else ("alerta" if vencendo else "ok")
        out.append(
            Resultado(
                f"social.{c.id}",
                "social",
                f"{c.get_rede_display()} · {c.nome}",
                st,
                c.mensagem
                or (
                    f"token vence em {timezone.localtime(c.expira_em):%d/%m}"
                    if c.expira_em
                    else "conectada"
                ),
                causa="Token da rede vencido ou recusado — as publicações falham."
                if st == "falha"
                else "",
                acao="Marketing → Contas → Reconectar." if st != "ok" else "",
                gravidade="baixa",
            )
        )
    return out
