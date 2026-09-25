# backend_api/Api/crm/obsidian.py
"""
Escrita de notas de lead no vault Obsidian.

Único ponto do projeto que escreve de volta no vault — diferente das
KnowledgeSources (que são só-leitura), estas notas são geradas pela
plataforma e ficam em Leads/ (pasta separada dos documentos de conhecimento).
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


def _slug(text: str) -> str:
    """Converte texto em slug seguro para nome de arquivo."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text[:50].strip("-")


def lead_note_path(lead) -> Path | None:
    """Retorna o Path completo da nota do lead no vault, ou None se vault não configurado."""
    vault_path = getattr(settings, "OBSIDIAN_VAULT_PATH", "")
    if not vault_path:
        return None
    vault = Path(vault_path)
    if not vault.is_dir():
        return None
    leads_dir = vault / "Leads"
    leads_dir.mkdir(exist_ok=True)
    slug = _slug(lead.nome)
    return leads_dir / f"lead-{lead.id}-{slug}.md"


def render_lead_note(lead, summary: str, messages: list[dict]) -> str:
    """
    Gera o conteúdo markdown da nota do lead com frontmatter YAML.
    `messages` é uma lista de {role, content, created_at} já ordenada.
    """
    from django.utils.dateformat import format as dfmt

    now = timezone.localtime(timezone.now())
    created = timezone.localtime(lead.created_at)
    stage_name = lead.stage.name if lead.stage else "—"
    pipeline_name = lead.pipeline.name if lead.pipeline else "—"
    canal = lead.origem or "—"
    canal_ref = lead.channel_ref or ""

    # Frontmatter — pesquisável pelo Obsidian e pelo dataview plugin
    frontmatter = (
        "---\n"
        f"lead_id: {lead.id}\n"
        f"nome: \"{lead.nome}\"\n"
        f"empresa: \"{lead.empresa or ''}\"\n"
        f"telefone: \"{lead.telefone or ''}\"\n"
        f"email: \"{lead.email or ''}\"\n"
        f"canal: {canal}\n"
        f"canal_ref: \"{canal_ref}\"\n"
        f"etapa: \"{stage_name}\"\n"
        f"pipeline: \"{pipeline_name}\"\n"
        f"status: {lead.outcome or 'ativo'}\n"
        f"responsavel: \"{lead.responsavel or ''}\"\n"
        f"valor_estimado: {lead.valor_estimado or ''}\n"
        f"primeira_interacao: {dfmt(created, 'Y-m-d')}\n"
        f"ultima_interacao: {dfmt(now, 'Y-m-d')}\n"
        "tags: [lead, crm]\n"
        "---\n\n"
    )

    # Cabeçalho
    titulo = lead.nome
    if lead.empresa:
        titulo += f" — {lead.empresa}"
    header = f"# {titulo}\n\n"

    # Bloco de metadados legível
    meta = (
        f"**ID do Lead:** #{lead.id}  \n"
        f"**Canal:** {canal}{f' ({canal_ref})' if canal_ref else ''}  \n"
        f"**Etapa:** {stage_name}  \n"
        f"**Responsável:** {lead.responsavel or '—'}  \n"
        f"**Primeira interação:** {dfmt(created, 'd/m/Y')}  \n"
        f"**Última atualização:** {dfmt(now, 'd/m/Y H:i')}  \n\n"
    )

    # Resumo gerado por IA
    summary_section = f"## Resumo da Conversa\n\n{summary}\n\n" if summary else ""

    # Últimas mensagens (máximo 20, só user + agent)
    history_lines = []
    for m in messages[-20:]:
        role_label = "**Lead**" if m["role"] == "user" else "**Agente**"
        content = m["content"].replace("\n", " ").strip()
        ts = m.get("created_at", "")
        ts_str = f" _{dfmt(timezone.localtime(ts), 'H:i')}_" if ts else ""
        history_lines.append(f"{role_label}{ts_str}: {content}")

    history_section = ""
    if history_lines:
        history_section = "## Histórico de Mensagens\n\n" + "\n\n".join(history_lines) + "\n"

    return frontmatter + header + meta + summary_section + history_section


def write_lead_note(lead, summary: str, messages: list[dict]) -> bool:
    """
    Escreve/atualiza a nota do lead no vault Obsidian.
    Retorna True se gravou, False se vault não está configurado ou inacessível.
    """
    path = lead_note_path(lead)
    if path is None:
        logger.debug("write_lead_note: OBSIDIAN_VAULT_PATH não configurado — pulando.")
        return False

    content = render_lead_note(lead, summary, messages)
    try:
        path.write_text(content, encoding="utf-8")
        logger.info("write_lead_note: nota do lead #%s gravada em %s", lead.id, path)
        return True
    except OSError as exc:
        logger.error("write_lead_note: erro ao gravar %s — %s", path, exc)
        return False
