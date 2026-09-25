# backend_api/Api/crm/tasks.py
"""
Tarefas Celery do módulo CRM.
Tudo que é assíncrono (escrita no vault, reindexação, notificações).
"""
from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=2, default_retry_delay=30)
def sync_lead_to_obsidian(self, lead_id: int, tenant_id):
    """
    Gera resumo da conversa via IA e grava/atualiza a nota do lead no vault.

    Disparado após qualify_lead, move_lead_to_stage e convert_lead_to_deal
    para manter o vault sempre atualizado com o histórico do CRM.

    Não falha em silêncio: erros de provedor são logados e a tarefa é
    retentada; erros de vault (path não configurado) são logados e ignorados
    — o CRM continua funcionando normalmente sem o vault.
    """
    from crm.models import Lead, LeadMessage
    from crm.obsidian import write_lead_note
    from harness.providers import chat_completion, get_active_provider, get_credential, ProviderConfigError

    try:
        lead = Lead.objects.select_related("stage", "pipeline").get(id=lead_id, tenant_id=tenant_id)
    except Lead.DoesNotExist:
        logger.warning("sync_lead_to_obsidian: lead #%s não encontrado.", lead_id)
        return

    # Monta histórico de mensagens (user + agent, sem system)
    qs = LeadMessage.objects.filter(
        lead=lead, tenant_id=tenant_id,
    ).exclude(role=LeadMessage.Role.SYSTEM).order_by("created_at")

    messages_raw = [
        {"role": "user" if m.role == LeadMessage.Role.USER else "assistant",
         "content": m.content,
         "created_at": m.created_at}
        for m in qs
    ]

    # Gera resumo via IA (falha graciosamente)
    summary = ""
    if messages_raw:
        try:
            provider = get_active_provider(tenant_id)
            cred = get_credential(tenant_id, provider)
            model = cred.default_model or None

            history_text = "\n".join(
                f"{'Lead' if m['role'] == 'user' else 'Agente'}: {m['content']}"
                for m in messages_raw[-30:]
            )
            prompt = (
                "Analise a conversa abaixo entre o agente comercial e o lead. "
                "Produza um resumo em português com no máximo 5 bullets cobrindo:\n"
                "- Necessidade ou problema relatado\n"
                "- Produto/serviço de interesse\n"
                "- Prazo mencionado (se houver)\n"
                "- Nível de interesse (baixo/médio/alto)\n"
                "- Próximo passo combinado ou sugerido\n\n"
                f"CONVERSA:\n{history_text}"
            )
            summary = chat_completion(
                tenant_id, provider, model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
            )
        except ProviderConfigError as exc:
            logger.warning("sync_lead_to_obsidian: IA indisponível (%s) — gravando sem resumo.", exc)
        except Exception as exc:
            logger.error("sync_lead_to_obsidian: erro inesperado ao gerar resumo (%s).", exc)
            try:
                raise self.retry(exc=exc)
            except self.MaxRetriesExceededError:
                pass

    # Grava nota no vault (silencioso se vault não configurado)
    wrote = write_lead_note(lead, summary, messages_raw)

    # Se gravou, tenta indexar imediatamente no vector store para busca imediata
    if wrote:
        _index_lead_note(lead, tenant_id)


def _index_lead_note(lead, tenant_id):
    """
    Reindexação imediata da nota do lead no vector store via ingestion.
    Usa o KnowledgeSource Obsidian do tenant se existir; caso contrário, pula.
    """
    try:
        from ingestion.models import KnowledgeSource, Document
        from ingestion.services import index_document
        from crm.obsidian import lead_note_path, render_lead_note
        from crm.models import LeadMessage

        # Busca source obsidian do tenant
        source = KnowledgeSource.objects.filter(
            tenant_id=tenant_id,
            source_type="obsidian",
            deleted_at__isnull=True,
        ).first()
        if source is None:
            return

        path = lead_note_path(lead)
        if path is None or not path.exists():
            return

        # Usa o caminho relativo ao vault como external_id
        vault_path = source.config.get("vault_path", "")
        if not vault_path:
            return

        from pathlib import Path
        rel = str(path.relative_to(Path(vault_path)))
        content = path.read_text(encoding="utf-8")

        doc, _ = Document.objects.update_or_create(
            tenant_id=tenant_id,
            source=source,
            external_id=rel,
            defaults={
                "title": f"Lead #{lead.id} — {lead.nome}",
                "content": content,
                "metadata": {
                    "lead_id": lead.id,
                    "nome": lead.nome,
                    "empresa": lead.empresa,
                    "canal": lead.origem,
                },
            },
        )
        index_document(doc)
        logger.info("_index_lead_note: lead #%s indexado no vector store.", lead.id)
    except Exception as exc:
        # Falha de indexação nunca derruba a tarefa principal
        logger.warning("_index_lead_note: falhou (%s) — vault gravado, indexação pendente.", exc)
