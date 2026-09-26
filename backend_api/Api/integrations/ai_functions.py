# backend_api/Api/integrations/ai_functions.py
"""
Funções da IA ligadas às integrações (orchestration.registry, CLAUDE.md §6).

- `n8n_automacoes_resumo`: só lê.
- `email_rascunho_setor`: o agente ESCREVE um rascunho na caixa de saída do
  setor. Nunca envia — enviar é sempre de uma pessoa, no painel (§12). Por
  isso o risco é "low": o rascunho não sai da plataforma sozinho.
"""
from orchestration.registry import register_query_function


@register_query_function(
    name="n8n_automacoes_resumo",
    description=(
        "Automações do n8n da empresa: quantos workflows existem, quais estão ativos e "
        "quais tiveram erro nas execuções recentes."
    ),
    parameters={},
)
def n8n_automacoes_resumo(tenant_id) -> dict:
    from integrations import n8n

    try:
        data = n8n.overview(tenant_id)
    except n8n.N8nError as exc:
        return {"erro": str(exc)}
    return {
        "totais": data["totals"],
        "workflows": [
            {
                "nome": w["name"],
                "ativo": w["active"],
                "gatilho": w["trigger"],
                "erros_recentes": w["recent"]["error"],
                "sucessos_recentes": w["recent"]["success"],
            }
            for w in data["workflows"][:50]
        ],
    }


@register_query_function(
    name="email_rascunho_setor",
    description=(
        "Escreve um RASCUNHO de e-mail na caixa de saída de um setor (ex.: cotação para "
        "fornecedor pelo setor Compras). Não envia: uma pessoa revisa e envia no painel. "
        "Use quando pedirem para mandar/preparar um e-mail."
    ),
    parameters={
        "setor": "nome do setor que envia (ex.: Compras)",
        "para": "e-mail(s) do destinatário, separados por vírgula",
        "assunto": "string",
        "corpo": "texto do e-mail",
    },
)
def email_rascunho_setor(tenant_id, setor: str, para: str, assunto: str, corpo: str) -> dict:
    from django.core.exceptions import ValidationError
    from django.core.validators import validate_email

    from agency.models import Sector
    from integrations.email import EmailError, account_for_sector, create_draft

    sector = Sector.objects.filter(
        tenant_id=tenant_id, is_active=True, name__iexact=(setor or "").strip()
    ).first()
    if sector is None:
        return {"erro": f"Setor '{setor}' não existe."}
    destinos = [a.strip() for a in str(para or "").replace(";", ",").split(",") if a.strip()]
    try:
        for a in destinos:
            validate_email(a)
        email = create_draft(
            tenant_id,
            sector_id=sector.id,
            to=destinos,
            subject=str(assunto or "(sem assunto)"),
            body=str(corpo or ""),
            origin="agente",
            requested_by="IA",
        )
    except (ValidationError, EmailError) as exc:
        return {"erro": f"Destinatário inválido: {exc}"}
    pronta = account_for_sector(tenant_id, sector.id) is not None
    return {
        "rascunho_id": email.id,
        "setor": sector.name,
        "para": destinos,
        "status": "rascunho aguardando uma pessoa enviar",
        "caixa_pronta": pronta,
        "aviso": ""
        if pronta
        else f"O setor {sector.name} ainda não tem caixa de e-mail configurada.",
    }
