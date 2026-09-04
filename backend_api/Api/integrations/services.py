# backend_api/Api/integrations/services.py
from __future__ import annotations

from integrations.models import ServiceCredential


class IntegrationConfigError(Exception):
    pass


def get_credential(tenant_id, provider: str) -> ServiceCredential:
    """
    Resolve a credencial ativa: tenant específico -> global do projeto
    (tenant_id nulo). Sem fallback de variável de ambiente aqui (diferente
    do `harness`) — token de deploy/infra é sensível o bastante para
    exigir configuração explícita, nunca um default de dev.
    """
    qs = ServiceCredential.objects.filter(provider=provider, is_active=True)

    cred = None
    if tenant_id:
        cred = qs.filter(tenant_id=tenant_id).first()
    if cred is None:
        cred = qs.filter(tenant_id__isnull=True).first()

    if cred is None:
        raise IntegrationConfigError(
            f"Nenhuma credencial ativa para '{provider}'. Configure com "
            f"`python manage.py configure_service_credential --provider {provider} --token ...` "
            f"ou pelo Django admin."
        )
    return cred


def create_project_repository(
    tenant_id, name: str, description: str = "", private: bool = True, template_files: dict[str, str] | None = None,
) -> dict:
    """
    Cria um repositório GitHub para um projeto novo e (opcionalmente)
    envia os arquivos de um template. Usado pelo fluxo "setor de
    Desenvolvimento cria um projeto" (`agency.services.create_project`).

    Retorna: {"html_url", "full_name", "clone_url", "files_pushed"}
    """
    from integrations.github import create_repository, push_template_files, GitHubError

    cred = get_credential(tenant_id, ServiceCredential.Provider.GITHUB)
    org = cred.account_ref or None

    try:
        repo = create_repository(cred.token, name=name, description=description, private=private, org=org)
    except GitHubError as exc:
        raise IntegrationConfigError(str(exc)) from exc

    files_pushed: list[str] = []
    if template_files:
        owner, repo_name = repo["full_name"].split("/", 1)
        try:
            files_pushed = push_template_files(cred.token, owner, repo_name, template_files)
        except GitHubError as exc:
            # O repositório já existe; não desfazemos a criação, só reportamos
            # que o push de arquivos falhou parcialmente — quem chama decide o que fazer.
            raise IntegrationConfigError(
                f"Repositório criado ({repo['html_url']}), mas falha ao enviar arquivos: {exc}"
            ) from exc

    return {
        "html_url": repo["html_url"],
        "full_name": repo["full_name"],
        "clone_url": repo["clone_url"],
        "files_pushed": files_pushed,
    }


def create_task_branch_and_pr(
    tenant_id, github_full_name: str, branch: str, files: dict[str, str], commit_message: str,
    pr_title: str, pr_body: str = "", base_branch: str = "main",
) -> dict:
    """
    Usado por `agency.tasks.approve_task`: uma tarefa aprovada vira uma
    branch própria (nunca commit direto na base) + PR — dá pra revisar e
    reverter uma tarefa isoladamente das outras.

    `github_full_name`: "owner/repo" (vem de `agency.Project.github_full_name`).
    Retorna: {"branch", "pr_url", "pr_number"}.
    """
    from integrations.github import create_branch, push_template_files, create_pull_request, GitHubError

    cred = get_credential(tenant_id, ServiceCredential.Provider.GITHUB)
    owner, repo_name = github_full_name.split("/", 1)

    try:
        create_branch(cred.token, owner, repo_name, branch, from_branch=base_branch)
        push_template_files(cred.token, owner, repo_name, files, branch=branch)
        pr = create_pull_request(
            cred.token, owner, repo_name, branch=branch, title=pr_title, body=pr_body, base=base_branch,
        )
    except GitHubError as exc:
        raise IntegrationConfigError(str(exc)) from exc

    return {"branch": branch, "pr_url": pr["html_url"], "pr_number": pr["number"]}
