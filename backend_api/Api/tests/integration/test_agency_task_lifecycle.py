# backend_api/Api/tests/integration/test_agency_task_lifecycle.py
"""
Prova o ciclo de vida completo de Task de verdade: interromper salva o
snapshot exato, adaptar usa o snapshot certo (não perde progresso),
aprovar dispara branch+PR de verdade (mockado só na chamada HTTP pro
GitHub, nunca na lógica de decisão), e as transições inválidas são
recusadas (não silenciosamente ignoradas).
"""
from unittest.mock import patch

import pytest

from agency.models import Agent, Task, TaskSnapshot
from agency.tasks import (
    create_task, interrupt_task, adapt_and_resume, approve_task, reject_task, TaskStateError,
)
from tests.factories import AgentFactory, ProjectFactory


@pytest.mark.django_db
class TestTaskLifecycle:
    def test_create_task_starts_as_created(self, tenant_id):
        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="Gerar relatório de vendas de agosto")
        assert task.status == Task.Status.CREATED
        assert task.version == 1

    def test_interrupt_saves_exact_snapshot_before_changing_status(self, tenant_id):
        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="Análise de churn")
        task.status = Task.Status.IN_PROGRESS
        task.progress = 0.4
        task.current_files = ["relatorio.md"]
        task.save()

        interrupted = interrupt_task(tenant_id, task.id, ceo_instructions="Foca só no Q3, ignora o resto")

        assert interrupted.status == Task.Status.PAUSED_CEO
        assert interrupted.version == 2

        snapshot = TaskSnapshot.objects.get(task=task, version=1)
        assert snapshot.context["brief"] == "Análise de churn"
        assert snapshot.context["progress"] == 0.4
        assert snapshot.context["current_files"] == ["relatorio.md"]
        assert snapshot.context["ceo_instructions"] == "Foca só no Q3, ignora o resto"

    def test_cannot_interrupt_a_task_already_approved(self, tenant_id):
        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="teste")
        task.status = Task.Status.APPROVED
        task.save()

        with pytest.raises(TaskStateError):
            interrupt_task(tenant_id, task.id, "qualquer coisa")

    def test_adapt_and_resume_cites_previous_progress_not_from_scratch(self, tenant_id):
        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="Migrar dados legados")
        task.status = Task.Status.IN_PROGRESS
        task.progress = 0.7
        task.current_files = ["migracao.sql", "validacao.py"]
        task.save()

        interrupt_task(tenant_id, task.id, "Adiciona validação de CPF antes de migrar")
        adapted = adapt_and_resume(tenant_id, task.id, new_brief="Adicionar validação de CPF")

        assert adapted.status == Task.Status.ADAPTED
        assert "70%" in adapted.brief
        assert "migracao.sql" in adapted.brief
        assert "Adicionar validação de CPF" in adapted.brief
        assert "Não descarte trabalho já" in adapted.brief

    def test_cannot_adapt_a_task_that_was_never_paused(self, tenant_id):
        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="teste")
        with pytest.raises(TaskStateError):
            adapt_and_resume(tenant_id, task.id, "nova instrução")

    def test_approve_without_project_never_touches_github(self, tenant_id):
        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="Só uma análise, sem repositório")

        with patch("integrations.services.create_task_branch_and_pr") as mock_git:
            result = approve_task(tenant_id, task.id, files={"analise.md": "# conteúdo"})

        mock_git.assert_not_called()
        assert result["pr_url"] is None
        assert result["task"].status == Task.Status.APPROVED

    def test_approve_with_project_triggers_real_branch_and_pr_call(self, tenant_id):
        agent = AgentFactory(tenant_id=tenant_id)
        project = ProjectFactory(tenant_id=tenant_id, github_full_name="IgorGBarros/teste-repo")
        task = create_task(tenant_id, agent.id, brief="Implementar endpoint novo", project_id=project.id)

        with patch("integrations.services.create_task_branch_and_pr") as mock_git:
            mock_git.return_value = {"branch": "feat/task-1", "pr_url": "https://github.com/IgorGBarros/teste-repo/pull/1", "pr_number": 1}
            result = approve_task(tenant_id, task.id, files={"api.py": "# código gerado"})

        mock_git.assert_called_once()
        call_args = mock_git.call_args
        assert call_args.args[1] == "IgorGBarros/teste-repo"
        assert call_args.kwargs["files"] == {"api.py": "# código gerado"}
        assert result["pr_url"] == "https://github.com/IgorGBarros/teste-repo/pull/1"

    def test_approve_never_undoes_decision_if_github_fails(self, tenant_id):
        """Falha de infraestrutura (Git fora do ar, credencial errada) não
        pode reverter uma aprovação humana já registrada."""
        from integrations.services import IntegrationConfigError

        agent = AgentFactory(tenant_id=tenant_id)
        project = ProjectFactory(tenant_id=tenant_id, github_full_name="IgorGBarros/teste-repo")
        task = create_task(tenant_id, agent.id, brief="teste", project_id=project.id)

        with patch("integrations.services.create_task_branch_and_pr", side_effect=IntegrationConfigError("token inválido")):
            result = approve_task(tenant_id, task.id, files={"a.py": "x"})

        assert result["task"].status == Task.Status.APPROVED
        assert result["pr_url"] is None

    def test_cannot_approve_twice(self, tenant_id):
        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="teste")
        approve_task(tenant_id, task.id)
        with pytest.raises(TaskStateError):
            approve_task(tenant_id, task.id)

    def test_reject_task(self, tenant_id):
        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="teste")
        rejected = reject_task(tenant_id, task.id, reason="Fora do escopo do setor")
        assert rejected.status == Task.Status.REJECTED


@pytest.mark.django_db
class TestExecuteTask:
    """
    execute_task é a peça que faltava no ciclo (criar/interromper/
    adaptar/aprovar já existiam, nada realmente RODAVA a tarefa). Mocka
    só a fronteira externa (harness.providers.chat_completion — a
    chamada de rede pro modelo), nunca a lógica de parsing/transição de
    estado, mesma filosofia do resto deste arquivo.
    """

    def test_success_parses_json_and_completes_with_full_progress(self, tenant_id):
        from agency.tasks import execute_task

        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="Gerar resumo de vendas")

        fake_response = '{"plan": "resumir vendas", "steps": ["ler dados", "resumir"], "output": "vendas ok", "needs_review": false}'
        with patch("harness.providers.chat_completion", return_value=fake_response) as mock_chat:
            updated = execute_task(tenant_id, task.id)

        assert mock_chat.called
        assert updated.status == Task.Status.IN_PROGRESS
        assert updated.progress == 1.0
        assert updated.result == {"plan": "resumir vendas", "steps": ["ler dados", "resumir"], "output": "vendas ok", "needs_review": False}

        agent.refresh_from_db()
        assert agent.work_status == Agent.WorkStatus.IDLE
        assert agent.current_task == ""

    def test_agent_shows_working_status_during_execution(self, tenant_id):
        """Prova que work_status muda de verdade DURANTE a chamada, não só antes/depois sem efeito real."""
        from agency.tasks import execute_task

        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="Tarefa qualquer")

        captured_status = {}

        def fake_chat_completion(*args, **kwargs):
            agent.refresh_from_db()
            captured_status["work_status"] = agent.work_status
            captured_status["current_task"] = agent.current_task
            return '{"plan": "x", "steps": [], "output": "ok", "needs_review": false}'

        with patch("harness.providers.chat_completion", side_effect=fake_chat_completion):
            execute_task(tenant_id, task.id)

        assert captured_status["work_status"] == Agent.WorkStatus.WORKING
        assert captured_status["current_task"] == "Tarefa qualquer"

    def test_malformed_json_falls_back_to_needs_review_instead_of_failing(self, tenant_id):
        from agency.tasks import execute_task

        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="teste")

        with patch("harness.providers.chat_completion", return_value="isso não é JSON válido"):
            updated = execute_task(tenant_id, task.id)

        assert updated.status == Task.Status.IN_PROGRESS, "resposta malformada não deveria derrubar a tarefa inteira"
        assert updated.result["needs_review"] is True
        assert updated.result["parse_error"] is True
        assert updated.result["output"] == "isso não é JSON válido"

    def test_strips_markdown_code_fence_before_parsing(self, tenant_id):
        from agency.tasks import execute_task

        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="teste")

        fenced = '```json\n{"plan": "x", "steps": [], "output": "ok", "needs_review": false}\n```'
        with patch("harness.providers.chat_completion", return_value=fenced):
            updated = execute_task(tenant_id, task.id)

        assert updated.result["output"] == "ok"

    def test_provider_error_rejects_task_and_frees_agent(self, tenant_id):
        from agency.tasks import execute_task
        from harness.providers import ProviderConfigError

        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="teste")

        with patch("harness.providers.chat_completion", side_effect=ProviderConfigError("Ollama fora do ar")):
            with pytest.raises(ProviderConfigError):
                execute_task(tenant_id, task.id)

        task.refresh_from_db()
        assert task.status == Task.Status.REJECTED
        assert "Ollama fora do ar" in task.result["error"]

        agent.refresh_from_db()
        assert agent.work_status == Agent.WorkStatus.IDLE, "agente não pode ficar 'working' para sempre se o modelo falhar"

    def test_cannot_execute_a_task_already_completed(self, tenant_id):
        from agency.tasks import execute_task

        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="teste")
        with patch("harness.providers.chat_completion", return_value='{"plan":"x","steps":[],"output":"ok","needs_review":false}'):
            execute_task(tenant_id, task.id)

        with pytest.raises(TaskStateError):
            execute_task(tenant_id, task.id)

    def test_can_execute_an_adapted_task(self, tenant_id):
        """CREATED e ADAPTED são os dois status válidos pra rodar — depois de uma interrupção+adapt, a tarefa precisa poder rodar de novo."""
        from agency.tasks import execute_task

        agent = AgentFactory(tenant_id=tenant_id)
        task = create_task(tenant_id, agent.id, brief="teste")
        interrupt_task(tenant_id, task.id, "pausa pra ajustar")
        adapted = adapt_and_resume(tenant_id, task.id, "novo brief")
        assert adapted.status == Task.Status.ADAPTED

        with patch("harness.providers.chat_completion", return_value='{"plan":"x","steps":[],"output":"ok","needs_review":false}'):
            updated = execute_task(tenant_id, task.id)
        assert updated.status == Task.Status.IN_PROGRESS
        assert updated.progress == 1.0
