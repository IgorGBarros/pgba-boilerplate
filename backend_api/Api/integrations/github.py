# backend_api/Api/integrations/github.py
"""
Cliente GitHub minimalista via REST API — de propósito, sem depender do
binário `git` no processo do Django (que exigiria clonar/commitar/dar
push localmente, mais frágil num backend web). Cria o repositório e
envia os arquivos iniciais via Contents API (um PUT por arquivo).

Suficiente para o caso de uso: "setor de Desenvolvimento cria um projeto
novo" → repositório novo + poucos arquivos de template. Não é (nem tenta
ser) um cliente Git completo.
"""
from __future__ import annotations

import base64
import logging

import httpx

logger = logging.getLogger(__name__)

GITHUB_API = "https://api.github.com"


class GitHubError(Exception):
    pass


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def create_repository(
    token: str, name: str, description: str = "", private: bool = True, org: str | None = None,
) -> dict:
    """
    Cria um repositório novo. Se `org` for informado, cria dentro dessa
    organização (`POST /orgs/{org}/repos`); senão, na conta do dono do
    token (`POST /user/repos`).

    Retorna o JSON da API do GitHub (inclui `html_url`, `full_name`,
    `clone_url`, `ssh_url`, etc.) — não filtramos os campos de propósito,
    quem chama decide o que usar.
    """
    url = f"{GITHUB_API}/orgs/{org}/repos" if org else f"{GITHUB_API}/user/repos"
    payload = {
        "name": name,
        "description": description,
        "private": private,
        "auto_init": True,  # já cria com um commit inicial (README) — necessário
        # para o Contents API conseguir referenciar a branch default depois.
    }

    try:
        resp = httpx.post(url, headers=_headers(token), json=payload, timeout=20.0)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.json().get("message", exc.response.text) if exc.response is not None else str(exc)
        if org and exc.response is not None and exc.response.status_code == 404:
            # Sintoma clássico: account_ref foi configurado com um usuário
            # pessoal, não uma Organization de verdade — GitHub só aceita
            # POST /orgs/{org}/repos para organizações reais.
            detail += (
                f" — confira se '{org}' é mesmo uma GitHub Organization (não um usuário "
                f"pessoal). Se for conta pessoal, limpe com: "
                f"configure_service_credential --provider github --token ... --clear-account-ref"
            )
        logger.error("Falha ao criar repositório GitHub '%s': %s", name, detail)
        raise GitHubError(f"Falha ao criar repositório: {detail}") from exc
    except httpx.HTTPError as exc:
        raise GitHubError(f"Falha ao criar repositório: {exc}") from exc


def _get_existing_file_sha(token: str, owner: str, repo: str, path: str, branch: str = "main") -> str | None:
    """
    A Contents API do GitHub exige o `sha` do arquivo atual quando você
    está ATUALIZANDO um arquivo que já existe — só omite `sha` quando o
    arquivo é novo. Como `create_repository()` usa `auto_init=True`
    (necessário pra já existir uma branch), o GitHub cria um `README.md`
    sozinho — e a primeira tentativa de enviar o `README.md` do template
    sempre bate nesse arquivo já existente. Sem checar o sha antes, o
    GitHub responde 422 "sha wasn't supplied". Retorna None se o arquivo
    realmente não existir ainda (caso normal para os demais arquivos).
    """
    url = f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}"
    try:
        resp = httpx.get(url, headers=_headers(token), params={"ref": branch}, timeout=15.0)
        if resp.status_code == 200:
            return resp.json().get("sha")
        return None
    except httpx.HTTPError:
        return None


def create_or_update_file(
    token: str, owner: str, repo: str, path: str, content: str, message: str, branch: str = "main",
) -> dict:
    """
    Cria (ou atualiza) um único arquivo via Contents API
    (`PUT /repos/{owner}/{repo}/contents/{path}`). Conteúdo precisa ir em
    base64 — a API do GitHub não aceita texto puro. Busca o `sha` atual
    primeiro (ver `_get_existing_file_sha`) para o caso de estar
    sobrescrevendo um arquivo que já existe (ex: o README.md do auto_init).
    """
    url = f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}"
    encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
    payload = {"message": message, "content": encoded, "branch": branch}

    sha = _get_existing_file_sha(token, owner, repo, path, branch)
    if sha:
        payload["sha"] = sha

    try:
        resp = httpx.put(url, headers=_headers(token), json=payload, timeout=20.0)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.json().get("message", exc.response.text) if exc.response is not None else str(exc)
        logger.error("Falha ao enviar arquivo '%s' para %s/%s: %s", path, owner, repo, detail)
        raise GitHubError(f"Falha ao enviar '{path}': {detail}") from exc
    except httpx.HTTPError as exc:
        raise GitHubError(f"Falha ao enviar '{path}': {exc}") from exc


def push_template_files(
    token: str, owner: str, repo: str, files: dict[str, str], branch: str = "main",
) -> list[str]:
    """
    Envia um conjunto de arquivos (path relativo -> conteúdo) para o
    repositório, um PUT por arquivo. Retorna a lista de paths enviados
    com sucesso; propaga o erro no primeiro que falhar (evita um
    repositório "pela metade" sem que ninguém perceba).
    """
    sent = []
    for path, content in files.items():
        create_or_update_file(
            token, owner, repo, path, content,
            message=f"chore: adiciona {path} (template inicial)", branch=branch,
        )
        sent.append(path)
    return sent
