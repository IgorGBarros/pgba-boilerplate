# backend_api/Api/tests/integration/test_agency_project_creation.py
"""
Prova de que "setor de Desenvolvimento, crie um projeto X" funciona fim a
fim, sem bater na API real do GitHub (mockada via monkeypatch). Cobre os
dois caminhos: sucesso e falha de integração (nunca deve levantar
exceção para o chamador — sempre um Project com status coerente).
"""
import pytest

from agency.models import Project
from agency.services import create_project
from integrations.services import IntegrationConfigError
from tests.factories import AgentFactory


@pytest.mark.django_db
def test_create_project_success(tenant_id, monkeypatch):
    agent = AgentFactory(tenant_id=tenant_id, role="Orquestrador de Desenvolvimento")

    monkeypatch.setattr(
        "agency.services.create_project_repository",
        lambda tenant_id, name, description, private, template_files: {
            "html_url": f"https://github.com/minha-org/{name}",
            "full_name": f"minha-org/{name}",
            "clone_url": f"https://github.com/minha-org/{name}.git",
            "files_pushed": list(template_files.keys()),
        },
    )

    project = create_project(
        tenant_id=tenant_id, requesting_agent_id=agent.id,
        name="loja-cliente-x", description="Landing page simples",
    )

    assert project.status == Project.Status.READY
    assert project.github_repo_url == "https://github.com/minha-org/loja-cliente-x"
    assert project.github_full_name == "minha-org/loja-cliente-x"
    assert project.requested_by_id == agent.id


@pytest.mark.django_db
def test_create_project_never_raises_on_integration_failure(tenant_id, monkeypatch):
    agent = AgentFactory(tenant_id=tenant_id, role="Orquestrador de Desenvolvimento")

    def _boom(*args, **kwargs):
        raise IntegrationConfigError("Nenhuma credencial ativa para 'github'.")

    monkeypatch.setattr("agency.services.create_project_repository", _boom)

    project = create_project(tenant_id=tenant_id, requesting_agent_id=agent.id, name="projeto-sem-token")

    assert project.status == Project.Status.FAILED
    assert "credencial" in project.error_message.lower()
    assert project.github_repo_url == ""


@pytest.mark.django_db
def test_simple_commercial_template_loads_and_replaces_placeholder():
    from agency.services import _load_simple_commercial_template

    files = _load_simple_commercial_template("minha-loja")

    assert "package.json" in files
    assert "src/App.tsx" in files
    assert "PROJECT_NAME_PLACEHOLDER" not in files["package.json"]
    assert "minha-loja" in files["package.json"]
    assert "package-lock.json" not in files
