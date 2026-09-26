# backend_api/Api/tests/integration/test_integracoes_admin.py
"""
Painel administrativo: caixas de e-mail por setor (Hostinger/SMTP), e-mail
de saída (rascunho → pessoa envia), Compras mandando cotação/pedido pela
caixa do setor, n8n (workflows/execuções), servidores (VPS) e credenciais.
"""
import uuid
from unittest import mock

import httpx
import pytest
from cryptography.fernet import Fernet

from ingestion.connectors import safe_http
from integrations.models import EmailAccount, OutboundEmail, ServiceCredential

API = "/api/v1/integrations"
PUBLIC_IP = "93.184.216.34"


@pytest.fixture(autouse=True)
def chave(settings, monkeypatch):
    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    settings.CONNECTORS_ALLOWED_PRIVATE_HOSTS = ""
    monkeypatch.setattr(safe_http, "_resolve", lambda host, port: [PUBLIC_IP])


class FakeSMTP:
    sent: list = []
    logins: list = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host = host

    def login(self, user, password):
        if password != "senha-certa":
            import smtplib

            raise smtplib.SMTPAuthenticationError(535, b"bad")
        FakeSMTP.logins.append(user)

    def send_message(self, msg):
        FakeSMTP.sent.append(msg)

    def quit(self):
        pass


@pytest.fixture
def smtp(monkeypatch):
    FakeSMTP.sent, FakeSMTP.logins = [], []
    monkeypatch.setattr("integrations.email.smtplib.SMTP_SSL", FakeSMTP)
    from integrations.tasks import send_outbound_task

    # sem worker no teste: a fila roda na hora
    monkeypatch.setattr(send_outbound_task, "delay", lambda *a: send_outbound_task(*a))
    return FakeSMTP


@pytest.fixture
def compras(tenant_id):
    from tests.factories import SectorFactory

    return SectorFactory(tenant_id=tenant_id, name="Compras", slug="compras")


@pytest.mark.django_db
def test_caixa_do_setor_sem_email_ainda_e_depois_hostinger(auth_client, compras, smtp):
    # Sem e-mail ainda: a caixa fica reservada, "aguardando configuração"
    res = auth_client.post(
        f"{API}/email-accounts/", {"sector": compras.id, "provider": "hostinger"}, format="json"
    )
    assert res.status_code == 201, res.data
    acc = res.data
    assert acc["status"] == "pending" and acc["configured"] is False
    assert acc["smtp_host"] == "smtp.hostinger.com" and acc["smtp_port"] == 465  # preset
    ov = auth_client.get(f"{API}/email-accounts/overview/").data
    assert ov["sectors"][0]["account"]["id"] == acc["id"]

    # Depois chega o e-mail: senha cifrada, nunca volta na API
    res = auth_client.patch(
        f"{API}/email-accounts/{acc['id']}/",
        {"address": "compras@empresa.com.br", "password": "senha-certa", "display_name": "Compras"},
        format="json",
    )
    assert res.data["has_password"] is True and "password" not in res.data
    raw = EmailAccount.objects.get(pk=acc["id"])
    assert "senha-certa" not in raw.password_encrypted and raw.password == "senha-certa"

    res = auth_client.post(f"{API}/email-accounts/{acc['id']}/test/", {}, format="json")
    assert res.status_code == 200 and res.data["account"]["status"] == "ready", res.data
    assert smtp.logins == ["compras@empresa.com.br"]

    # Um setor só tem uma caixa
    dup = auth_client.post(f"{API}/email-accounts/", {"sector": compras.id}, format="json")
    assert dup.status_code == 400


@pytest.mark.django_db
def test_senha_errada_marca_erro(auth_client, compras, smtp):
    res = auth_client.post(
        f"{API}/email-accounts/",
        {"sector": compras.id, "address": "c@empresa.com.br", "password": "errada"},
        format="json",
    )
    res = auth_client.post(f"{API}/email-accounts/{res.data['id']}/test/", {}, format="json")
    assert res.status_code == 400 and "recusados" in res.data["detail"]
    assert res.data["account"]["status"] == "error"


@pytest.mark.django_db
def test_cotacao_por_email_rascunho_espera_caixa_e_so_pessoa_envia(
    auth_client, tenant_id, compras, smtp
):
    from compras.models import Fornecedor, ItemOrcamento, Orcamento
    from crm.models import Deal

    forn = Fornecedor.objects.create(
        tenant_id=tenant_id, nome="Aço Forte", email="vendas@acoforte.com"
    )
    deal = Deal.objects.create(tenant_id=tenant_id, titulo="Obra Centro")
    orc = Orcamento.objects.create(tenant_id=tenant_id, deal=deal, fornecedor=forn)
    ItemOrcamento.objects.create(
        tenant_id=tenant_id, orcamento=orc, nome="Vergalhão 10mm", quantidade=40, unidade="br"
    )

    res = auth_client.post(
        f"/api/v1/compras/orcamentos/{orc.id}/rascunho-email/", {}, format="json"
    )
    assert res.status_code == 201, res.data
    draft = res.data
    assert draft["status"] == "draft" and draft["to"] == ["vendas@acoforte.com"]
    assert "Vergalhão 10mm: 40 br" in draft["body"] and draft["sector"] == compras.id

    # Ainda sem caixa: não envia, rascunho continua
    res = auth_client.post(f"{API}/outbound-emails/{draft['id']}/send/", {}, format="json")
    assert res.status_code == 400 and "rascunho continua salvo" in res.data["detail"]
    assert OutboundEmail.objects.get(pk=draft["id"]).status == "draft"
    orc.refresh_from_db()
    assert orc.status == "rascunho"

    # Chegou a caixa do setor → pessoa envia → cotação vira "enviado"
    auth_client.post(
        f"{API}/email-accounts/",
        {"sector": compras.id, "address": "compras@empresa.com.br", "password": "senha-certa"},
        format="json",
    )
    res = auth_client.post(f"{API}/outbound-emails/{draft['id']}/send/", {}, format="json")
    assert res.status_code == 200 and res.data["status"] == "sent", res.data
    assert res.data["from_address"] == "compras@empresa.com.br"
    assert smtp.sent[0]["To"] == "vendas@acoforte.com"
    orc.refresh_from_db()
    assert orc.status == "enviado" and orc.enviado_em is not None

    # Enviado não reenvia nem edita
    assert (
        auth_client.post(
            f"{API}/outbound-emails/{draft['id']}/send/", {}, format="json"
        ).status_code
        == 400
    )
    assert (
        auth_client.patch(
            f"{API}/outbound-emails/{draft['id']}/", {"subject": "x"}, format="json"
        ).status_code
        == 400
    )


@pytest.mark.django_db
def test_fornecedor_sem_email(auth_client, tenant_id, compras):
    from compras.models import Fornecedor, Orcamento
    from crm.models import Deal

    forn = Fornecedor.objects.create(tenant_id=tenant_id, nome="Sem Email")
    orc = Orcamento.objects.create(
        tenant_id=tenant_id,
        deal=Deal.objects.create(tenant_id=tenant_id, titulo="X"),
        fornecedor=forn,
    )
    res = auth_client.post(
        f"/api/v1/compras/orcamentos/{orc.id}/rascunho-email/", {}, format="json"
    )
    assert res.status_code == 400 and "não tem e-mail" in res.data["detail"]


@pytest.mark.django_db
def test_agente_so_cria_rascunho(tenant_id, compras):
    from orchestration import registry

    out = registry.execute(
        "email_rascunho_setor",
        tenant_id,
        {
            "setor": "compras",
            "para": "a@forn.com; b@forn.com",
            "assunto": "Cotação",
            "corpo": "Olá",
        },
    )
    assert out["caixa_pronta"] is False and "não tem caixa" in out["aviso"]
    email = OutboundEmail.objects.get(pk=out["rascunho_id"])
    assert (
        email.status == "draft"
        and email.to == ["a@forn.com", "b@forn.com"]
        and email.origin == "agente"
    )
    assert registry.execute(
        "email_rascunho_setor",
        tenant_id,
        {"setor": "Compras", "para": "nao-e-email", "assunto": "x", "corpo": "y"},
    )["erro"]


@pytest.mark.django_db
def test_caixa_de_outro_tenant_invisivel(auth_client, tenant_id):
    EmailAccount.objects.create(tenant_id=uuid.uuid4(), address="x@outra.com")
    assert auth_client.get(f"{API}/email-accounts/").data["results"] == []


@pytest.mark.django_db
def test_n8n_painel_liga_desliga(auth_client, tenant_id, monkeypatch):
    calls = []

    def handler(request: httpx.Request):
        calls.append((request.method, request.url.path, request.headers.get("x-n8n-api-key")))
        path = request.url.path
        if path == "/api/v1/workflows":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": "a1",
                            "name": "Novo lead → CRM",
                            "active": True,
                            "nodes": [
                                {"type": "n8n-nodes-base.webhook"},
                                {"type": "n8n-nodes-base.httpRequest"},
                            ],
                        },
                        {
                            "id": "b2",
                            "name": "Relatório semanal",
                            "active": False,
                            "nodes": [{"type": "n8n-nodes-base.scheduleTrigger"}],
                        },
                    ],
                    "nextCursor": None,
                },
            )
        if path == "/api/v1/executions":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": "9",
                            "workflowId": "a1",
                            "status": "error",
                            "mode": "webhook",
                            "startedAt": "2026-09-26T10:00:00Z",
                        },
                        {
                            "id": "8",
                            "workflowId": "a1",
                            "status": "success",
                            "mode": "webhook",
                            "startedAt": "2026-09-26T09:00:00Z",
                        },
                    ],
                    "nextCursor": None,
                },
            )
        if path == "/api/v1/workflows/b2/activate":
            return httpx.Response(200, json={"id": "b2", "active": True})
        return httpx.Response(404)

    monkeypatch.setattr(safe_http, "_transport", httpx.MockTransport(handler))

    assert auth_client.get(f"{API}/n8n/overview/").status_code == 400  # não configurado
    res = auth_client.post(
        f"{API}/credentials/",
        {
            "provider": "n8n",
            "account_ref": "https://n8n.empresa.com/",
            "token": "n8n-api-key-123456",
        },
        format="json",
    )
    assert res.status_code == 201 and res.data["token_masked"].endswith("3456")
    assert "n8n-api-key-123456" not in str(res.data)

    test = auth_client.post(f"{API}/credentials/n8n/test/", {}, format="json").data
    assert test["ok"] and "2 workflow(s), 1 ativo(s)" in test["detail"]

    ov = auth_client.get(f"{API}/n8n/overview/").data
    wf = {w["id"]: w for w in ov["workflows"]}
    assert wf["a1"]["trigger"] == "webhook" and wf["a1"]["recent"]["error"] == 1
    assert wf["b2"]["trigger"] == "agendado" and ov["totals"]["active"] == 1
    assert calls[0][2] == "n8n-api-key-123456"

    res = auth_client.post(f"{API}/n8n/workflows/b2/active/", {"active": True}, format="json")
    assert res.data == {"id": "b2", "active": True}

    from orchestration import registry

    resumo = registry.execute("n8n_automacoes_resumo", tenant_id, {})
    assert resumo["totais"]["workflows"] == 2


@pytest.mark.django_db
def test_n8n_na_rede_interna_bloqueado(auth_client, tenant_id, monkeypatch):
    monkeypatch.setattr(safe_http, "_resolve", lambda host, port: ["10.0.0.5"])
    ServiceCredential(tenant_id=tenant_id, provider="n8n", account_ref="https://n8n.local").save()
    cred = ServiceCredential.objects.get(tenant_id=tenant_id, provider="n8n")
    cred.token = "k"
    cred.save()
    res = auth_client.get(f"{API}/n8n/overview/")
    assert res.status_code == 400 and "interno" in res.data["detail"]


@pytest.mark.django_db
def test_servidor_oracle_sem_ip_ainda_e_depois_ssh(auth_client):
    res = auth_client.post(
        f"{API}/servers/",
        {
            "name": "VPS Oracle (grátis)",
            "provider": "oracle",
            "private_key": "-----BEGIN KEY-----abc",
        },
        format="json",
    )
    assert res.status_code == 201 and res.data["has_private_key"] and "private_key" not in res.data
    sid = res.data["id"]
    res = auth_client.post(f"{API}/servers/{sid}/check/", {}, format="json")
    assert res.data["ok"] is False and "Sem endereço" in res.data["detail"]

    class Sock:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def settimeout(self, t):
            pass

        def recv(self, n):
            return b"SSH-2.0-OpenSSH_9.6\r\n"

    auth_client.patch(f"{API}/servers/{sid}/", {"host": "150.230.1.2"}, format="json")
    with mock.patch("integrations.servers.socket.create_connection", return_value=Sock()):
        res = auth_client.post(f"{API}/servers/{sid}/check/", {}, format="json")
    assert res.data["ok"] is True and "OpenSSH" in res.data["detail"]
    # Excluir é lógico
    assert auth_client.delete(f"{API}/servers/{sid}/").status_code == 204
    assert auth_client.get(f"{API}/servers/").data["results"] == []


@pytest.mark.django_db
def test_credencial_exige_token_e_provedor_valido(auth_client):
    assert (
        auth_client.post(
            f"{API}/credentials/", {"provider": "xpto", "token": "a"}, format="json"
        ).status_code
        == 400
    )
    assert (
        auth_client.post(
            f"{API}/credentials/", {"provider": "hostinger"}, format="json"
        ).status_code
        == 400
    )
    ok = auth_client.post(
        f"{API}/credentials/", {"provider": "hostinger", "token": "tok-abcdefgh1234"}, format="json"
    )
    assert ok.status_code == 201
    # mandar o mascarado de volta mantém o token
    auth_client.post(
        f"{API}/credentials/",
        {"provider": "hostinger", "token": ok.data["token_masked"], "label": "Conta"},
        format="json",
    )
    cred = ServiceCredential.objects.get(provider="hostinger", is_active=True)
    assert cred.token == "tok-abcdefgh1234" and cred.label == "Conta"
