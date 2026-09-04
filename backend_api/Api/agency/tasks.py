# backend_api/Api/agency/tasks.py
"""
Ciclo de vida de Task — intervenção humana DURANTE a execução de uma
tarefa, complementar ao `agency.policy` (que bloqueia ANTES de executar).

Adaptado do protótipo `escritorio_virtual_agentes` (mesmo autor, projeto
anterior) — lá era FastAPI + estado em memória + Obsidian; aqui é
Django + Postgres (histórico de verdade via AuditMixin, nunca perdido
num restart) + `integrations.github` real (branch + PR de verdade, não
simulado).
"""
from __future__ import annotations

from django.utils import timezone

from agency.models import Agent, Task, TaskSnapshot
from agency.realtime import broadcast_agent_update, broadcast_task_update


class TaskStateError(Exception):
    """Ação pedida não é válida no status atual da Task."""


DEFAULT_TASK_SYSTEM_PROMPT = (
    "Você é um agente executor de tarefas dentro de uma plataforma real. "
    "Responda SEMPRE em JSON válido, sem texto antes ou depois, exatamente "
    'neste formato: {"plan": "resumo do plano", "steps": ["passo 1", "..."], '
    '"output": "resultado principal", "needs_review": true|false}. '
    "Se não tiver certeza da resposta, defina needs_review como true. "
    "Nunca invente informação que não foi pedida na tarefa."
)


def create_task(tenant_id, agent_id, brief: str, task_type: str = "", project_id=None) -> Task:
    task = Task.objects.create(
        tenant_id=tenant_id, agent_id=agent_id, brief=brief, task_type=task_type, project_id=project_id,
    )
    broadcast_task_update(task)
    return task


def execute_task(tenant_id, task_id) -> Task:
    """
    Executa a Task pelo modelo configurado no harness — mesma resolução
    de provider/model que `harness.views.GenerateCodeView` usa (nunca uma
    segunda forma de escolher modelo espalhada pelo projeto). Parseia a
    resposta JSON estruturada; se vier malformada, cai como texto puro
    com `needs_review=True` em vez de derrubar a tarefa inteira.

    Diferente de `agency.services.ask_as_agent` (uma pergunta isolada,
    gated por `agency.policy` quando envolve uma função registrada), uma
    Task sempre fica disponível pra decisão humana ao final da execução
    (permanece IN_PROGRESS com `progress=1.0` — não existe um status
    "aguardando revisão" dedicado no modelo; `approve_task`/`reject_task`
    já aceitam qualquer status que não seja APPROVED/REJECTED).
    """
    import json

    from django.conf import settings

    from harness.providers import chat_completion, ProviderConfigError

    task = Task.objects.select_related("agent").get(id=task_id, tenant_id=tenant_id)
    if task.status not in (Task.Status.CREATED, Task.Status.ADAPTED):
        raise TaskStateError(f"Task não pode ser executada no status atual: {task.get_status_display()}.")

    agent = task.agent
    agent.work_status = Agent.WorkStatus.WORKING
    agent.current_task = task.brief[:255]
    agent.save(update_fields=["work_status", "current_task"])
    broadcast_agent_update(agent)

    task.status = Task.Status.IN_PROGRESS
    task.updated_at = timezone.now()
    task.save(update_fields=["status", "updated_at"])
    broadcast_task_update(task)

    provider = getattr(settings, "CHAT_PROVIDER", "ollama")

    def _finish_with_error(detail: dict):
        task.status = Task.Status.REJECTED
        task.result = detail
        task.updated_at = timezone.now()
        task.save(update_fields=["status", "result", "updated_at"])
        broadcast_task_update(task)
        agent.work_status = Agent.WorkStatus.IDLE
        agent.current_task = ""
        agent.save(update_fields=["work_status", "current_task"])
        broadcast_agent_update(agent)

    try:
        raw = chat_completion(
            tenant_id, provider, None,  # model=None -> resolve por get_credential().default_model
            messages=[
                {"role": "system", "content": DEFAULT_TASK_SYSTEM_PROMPT},
                {"role": "user", "content": task.brief},
            ],
            temperature=0.3, json_mode=True,
        )
    except ProviderConfigError as exc:
        _finish_with_error({"error": str(exc)})
        raise

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        parsed = {"output": raw, "needs_review": True, "parse_error": True}

    # Sem status "aguardando revisão" dedicado no modelo — uma tarefa
    # concluída fica em IN_PROGRESS com progress=1.0; approve_task/
    # reject_task já aceitam qualquer status que não seja
    # APPROVED/REJECTED, então isso não exige nenhuma mudança neles.
    task.progress = 1.0
    task.result = parsed
    task.updated_at = timezone.now()
    task.save(update_fields=["progress", "result", "updated_at"])
    broadcast_task_update(task)

    agent.work_status = Agent.WorkStatus.IDLE
    agent.current_task = ""
    agent.save(update_fields=["work_status", "current_task"])
    broadcast_agent_update(agent)

    return task


def update_progress(tenant_id, task_id, progress: float) -> Task:
    """Só atualiza tarefa EM ANDAMENTO — não faz sentido "progredir" uma pausada/aprovada."""
    task = Task.objects.get(id=task_id, tenant_id=tenant_id)
    if task.status != Task.Status.IN_PROGRESS:
        raise TaskStateError(f"Não é possível atualizar progresso de uma tarefa '{task.get_status_display()}'.")
    task.progress = min(1.0, max(0.0, progress))
    task.updated_at = timezone.now()
    task.save(update_fields=["progress", "updated_at"])
    broadcast_task_update(task)
    return task


def interrupt_task(tenant_id, task_id, ceo_instructions: str) -> Task:
    """
    CEO interrompe uma tarefa em andamento. Salva o estado exato (brief,
    progresso, arquivos) num TaskSnapshot ANTES de mudar qualquer coisa —
    é esse snapshot que `adapt_and_resume` usa depois pra não perder o
    trabalho já feito.
    """
    task = Task.objects.get(id=task_id, tenant_id=tenant_id)
    if task.status not in (Task.Status.IN_PROGRESS, Task.Status.CREATED):
        raise TaskStateError(f"Não é possível interromper uma tarefa '{task.get_status_display()}'.")

    TaskSnapshot.objects.create(
        task=task, version=task.version,
        context={
            "brief": task.brief, "progress": task.progress,
            "current_files": task.current_files, "status": task.status,
            "ceo_instructions": ceo_instructions,
        },
    )

    task.status = Task.Status.PAUSED_CEO
    task.version += 1
    task.updated_at = timezone.now()
    task.save(update_fields=["status", "version", "updated_at"])
    broadcast_task_update(task)

    task.agent.work_status = Agent.WorkStatus.PAUSED
    task.agent.save(update_fields=["work_status"])
    broadcast_agent_update(task.agent)
    return task


def adapt_and_resume(tenant_id, task_id, new_brief: str) -> Task:
    """
    Só funciona em cima de uma tarefa PAUSED_CEO — busca o snapshot da
    versão anterior e monta o novo `brief` citando o progresso salvo, pra
    quem for executar a tarefa de novo (via `orchestration`/`harness`)
    continuar de onde parou, não do zero.
    """
    task = Task.objects.get(id=task_id, tenant_id=tenant_id)
    if task.status != Task.Status.PAUSED_CEO:
        raise TaskStateError("Só é possível adaptar uma tarefa pausada pelo CEO.")

    snapshot = task.snapshots.filter(version=task.version - 1).first()
    if not snapshot:
        raise TaskStateError(f"Snapshot da versão {task.version - 1} não encontrado.")

    adapted_brief = (
        f"# Contexto anterior (snapshot v{snapshot.version})\n"
        f"{snapshot.context.get('brief', '')}\n"
        f"Progresso salvo: {snapshot.context.get('progress', 0):.0%}\n"
        f"Arquivos já produzidos: {', '.join(snapshot.context.get('current_files', [])) or 'nenhum'}\n\n"
        f"# Nova diretriz do CEO\n{new_brief}\n\n"
        f"# Instrução de adaptação\n"
        f"Continue a partir do progresso anterior. Não descarte trabalho já "
        f"feito — ajuste só o necessário para alinhar com a nova diretriz."
    )

    task.brief = adapted_brief
    task.status = Task.Status.ADAPTED
    task.updated_at = timezone.now()
    task.save(update_fields=["brief", "status", "updated_at"])
    broadcast_task_update(task)
    return task


def approve_task(tenant_id, task_id, files: dict[str, str] | None = None, trigger_git: bool = True) -> dict:
    """
    Aprova a tarefa. Se `files` foi passado, `trigger_git=True` e a tarefa
    tem um `project` com repositório GitHub configurado, cria uma branch +
    PR de verdade (nunca commit direto na base) — ver
    `integrations.services.create_task_branch_and_pr`.

    Retorna {"task": Task, "pr_url": str | None} — nunca lança por falha
    de Git (a aprovação em si já aconteceu; problema de infraestrutura
    não deveria reverter uma decisão humana já tomada).
    """
    from integrations.services import create_task_branch_and_pr, IntegrationConfigError

    task = Task.objects.select_related("project").get(id=task_id, tenant_id=tenant_id)
    if task.status in (Task.Status.APPROVED, Task.Status.REJECTED):
        raise TaskStateError(f"Esta tarefa já foi decidida ({task.get_status_display()}).")

    task.status = Task.Status.APPROVED
    task.current_files = list(files.keys()) if files else task.current_files
    task.updated_at = timezone.now()
    task.save(update_fields=["status", "current_files", "updated_at"])
    broadcast_task_update(task)

    pr_url = None
    if files and trigger_git and task.project and task.project.github_full_name:
        branch = f"feat/task-{task.id}"
        try:
            result = create_task_branch_and_pr(
                tenant_id, task.project.github_full_name, branch=branch, files=files,
                commit_message=f"feat(task-{task.id}): {task.brief[:60]}",
                pr_title=f"Task #{task.id}: {task.brief[:60]}",
                pr_body=f"Gerado pelo agente {task.agent.name} (setor {task.agent.sector}). Aprovado via PGBA.",
            )
            pr_url = result["pr_url"]
        except IntegrationConfigError:
            # A aprovação já está registrada — falha de Git fica visível
            # pra quem chamou decidir se tenta de novo, mas não desfaz a decisão humana.
            pass

    return {"task": task, "pr_url": pr_url}


def reject_task(tenant_id, task_id, reason: str = "") -> Task:
    task = Task.objects.get(id=task_id, tenant_id=tenant_id)
    if task.status in (Task.Status.APPROVED, Task.Status.REJECTED):
        raise TaskStateError(f"Esta tarefa já foi decidida ({task.get_status_display()}).")
    task.status = Task.Status.REJECTED
    task.updated_at = timezone.now()
    task.save(update_fields=["status", "updated_at"])
    broadcast_task_update(task)
    return task