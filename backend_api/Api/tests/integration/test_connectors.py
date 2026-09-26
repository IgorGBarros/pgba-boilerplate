# backend_api/Api/tests/integration/test_connectors.py
"""
Conectores externos: segredos cifrados, anti-SSRF, sincronização real (com as
APIs simuladas), webhook assinado, consultas estruturadas só leitura e o
escopo por setor (várias fontes por setor).
"""
import hashlib
import hmac
import json
import sqlite3
import uuid

import httpx
import pytest
from cryptography.fernet import Fernet

from ingestion.connectors import ConnectorError, safe_http
from ingestion.connectors.structured import soql_literal
from ingestion.models import Document, KnowledgeSource, SourceSyncRun
from ingestion.sync import sources_due, sync_source

API = "/api/v1/ingestion"
PUBLIC_IP = "93.184.216.34"


@pytest.fixture(autouse=True)
def chave(settings):
    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    settings.CONNECTORS_ALLOWED_PRIVATE_HOSTS = ""


@pytest.fixture
def rede(monkeypatch):
    """Toda saída de rede passa por aqui: DNS público falso + respostas simuladas."""
    routes = {}

    def handler(request: httpx.Request):
        key = f"{request.method} {request.url.host}{request.url.path}"
        if key not in routes:
            return httpx.Response(404, text=f"sem rota: {key}")
        fn = routes[key]
        return fn(request) if callable(fn) else fn

    monkeypatch.setattr(safe_http, "_resolve", lambda host, port: [PUBLIC_IP])
    monkeypatch.setattr(safe_http, "_transport", httpx.MockTransport(handler))
    return routes


def _source(tenant_id, source_type, config, secrets=None, **kw):
    src = KnowledgeSource(
        tenant_id=tenant_id,
        name=kw.pop("name", source_type),
        source_type=source_type,
        config=config,
        **kw,
    )
    src.set_secrets(secrets or {})
    src.save()
    return src


# ─── 1. Segurança ────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_segredo_cifrado_e_nunca_devolvido(auth_client):
    res = auth_client.post(
        f"{API}/sources/",
        {
            "name": "ERP legado",
            "source_type": "rest_api",
            "config": {
                "url": "https://api.exemplo.com/v1/itens",
                "auth_type": "bearer",
                "api_key": "tok-super-secreto-123456",
            },
        },
        format="json",
    )
    assert res.status_code == 201, res.data
    src = KnowledgeSource.objects.get(id=res.data["id"])
    assert "api_key" not in src.config and "tok-super" not in src.secret_config
    assert src.get_secrets() == {"api_key": "tok-super-secreto-123456"}
    assert res.data["config"]["api_key"] == "••••3456" and res.data["secrets_set"] == ["api_key"]
    listing = json.dumps(auth_client.get(f"{API}/sources/").data)
    assert "tok-super-secreto" not in listing
    # Editar mandando o valor mascarado de volta mantém o segredo
    auth_client.patch(
        f"{API}/sources/{src.id}/",
        {"config": {**res.data["config"], "data_path": "items"}},
        format="json",
    )
    src.refresh_from_db()
    assert (
        src.get_secrets()["api_key"] == "tok-super-secreto-123456"
        and src.config["data_path"] == "items"
    )


@pytest.mark.django_db
def test_sem_encryption_key_nao_salva_segredo(auth_client, settings):
    settings.ENCRYPTION_KEY = ""
    res = auth_client.post(
        f"{API}/sources/",
        {
            "name": "Slack",
            "source_type": "slack",
            "config": {"bot_token": "xoxb-1", "channel_ids": "C1"},
        },
        format="json",
    )
    assert res.status_code == 400 and "ENCRYPTION_KEY" in str(res.data)


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "gopher://x",
        "http://127.0.0.1:5432/",
        "http://localhost/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/",
        "http://user:pw@exemplo.com/",
    ],
)
def test_bloqueia_rede_interna_e_esquemas(url):
    with pytest.raises(ConnectorError):
        safe_http.check_url(url)


def test_host_liberado_explicitamente(settings):
    settings.CONNECTORS_ALLOWED_PRIVATE_HOSTS = "erp.interno"
    safe_http.check_host("erp.interno", 443)  # não levanta


def test_redirect_para_rede_interna_e_bloqueado(monkeypatch):
    monkeypatch.setattr(
        safe_http,
        "_resolve",
        lambda host, port: ["10.0.0.1"] if host == "interno.exemplo" else [PUBLIC_IP],
    )
    monkeypatch.setattr(
        safe_http,
        "_transport",
        httpx.MockTransport(
            lambda r: httpx.Response(302, headers={"location": "http://interno.exemplo/admin"})
        ),
    )
    with pytest.raises(ConnectorError, match="interno"):
        safe_http.request("GET", "https://api.exemplo.com/")


@pytest.mark.django_db
def test_teste_de_conexao_faz_chamada_real(auth_client, rede):
    rede["GET api.exemplo.com/v1/itens"] = httpx.Response(
        200, json={"items": [{"id": 1}, {"id": 2}]}
    )
    ok = auth_client.post(
        f"{API}/sources/test-config/",
        {
            "source_type": "rest_api",
            "config": {"url": "https://api.exemplo.com/v1/itens", "data_path": "items"},
        },
        format="json",
    )
    assert ok.data == {"ok": True, "message": "Conectou: 2 registro(s) na resposta."}
    ruim = auth_client.post(
        f"{API}/sources/test-config/",
        {
            "source_type": "rest_api",
            "config": {"url": "http://127.0.0.1:8000/admin/"},
        },
        format="json",
    )
    assert ruim.status_code == 400 and "interno" in ruim.data["message"]


# ─── 2. Sincronização ────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_rest_api_sincroniza_mascara_pii_e_remove_o_que_sumiu(tenant_id, rede):
    itens = [
        {
            "id": 7,
            "nome": "Pedido Acme",
            "contato": "joao@acme.com",
            "tel": "(11) 98765-4321",
            "total": 1500,
        },
        {"id": 8, "nome": "Pedido Beta", "total": 300},
    ]
    rede["GET api.exemplo.com/pedidos"] = lambda r: httpx.Response(200, json={"data": itens})
    src = _source(
        tenant_id,
        "rest_api",
        {
            "url": "https://api.exemplo.com/pedidos",
            "data_path": "data",
            "title_field": "nome",
            "auth_type": "bearer",
        },
        {"api_key": "k"},
    )
    run = sync_source(src)
    assert (run.status, run.created) == ("ok", 2), run.message
    doc = Document.objects.get(source=src, external_id="item:7")
    assert doc.title == "Pedido Acme" and "total: 1500" in doc.content
    assert "joao@acme.com" not in doc.content and "98765-4321" not in doc.content  # LGPD

    assert sync_source(src).unchanged == 2
    itens.pop()  # o pedido 8 sumiu da fonte
    run = sync_source(src)
    assert run.removed == 1
    assert Document.objects.get(source=src, external_id="item:8").is_active is False
    src.refresh_from_db()
    assert src.last_sync_status == "ok" and src.last_synced_at is not None
    assert SourceSyncRun.objects.filter(source=src).count() == 3


@pytest.mark.django_db
def test_erro_de_sync_fica_registrado(tenant_id, rede):
    rede["GET api.exemplo.com/x"] = httpx.Response(401, text="no")
    src = _source(tenant_id, "rest_api", {"url": "https://api.exemplo.com/x"})
    run = sync_source(src)
    src.refresh_from_db()
    assert run.status == "error" and "credencial" in run.message
    assert src.last_sync_status == "error" and src.last_synced_at is None


@pytest.mark.django_db
def test_google_sheets_publica_vira_blocos_de_linhas(tenant_id, rede):
    csv_text = "Cliente,Plano,Valor\nAcme,Pro,1000\nBeta,Basic,200\n"
    rede["GET docs.google.com/spreadsheets/d/ABC/gviz/tq"] = httpx.Response(
        200, text=csv_text, headers={"content-type": "text/csv"}
    )
    src = _source(tenant_id, "google_sheets", {"spreadsheet_id": "ABC", "sheet_name": "Clientes"})
    assert sync_source(src).created == 1
    doc = Document.objects.get(source=src)
    assert "Linha 2 — Cliente: Acme; Plano: Pro; Valor: 1000" in doc.content


@pytest.mark.django_db
def test_notion_paginas_com_propriedades_e_blocos(tenant_id, rede):
    rede["POST api.notion.com/v1/databases/db1/query"] = httpx.Response(
        200,
        json={
            "results": [
                {
                    "id": "p1",
                    "url": "https://notion.so/p1",
                    "properties": {
                        "Nome": {
                            "type": "title",
                            "title": [{"plain_text": "Política de reembolso"}],
                        },
                        "Status": {"type": "select", "select": {"name": "Publicado"}},
                    },
                }
            ],
            "has_more": False,
        },
    )
    rede["GET api.notion.com/v1/blocks/p1/children"] = httpx.Response(
        200,
        json={
            "results": [
                {
                    "type": "paragraph",
                    "paragraph": {"rich_text": [{"plain_text": "Reembolso em até 7 dias."}]},
                },
            ],
            "has_more": False,
        },
    )
    src = _source(tenant_id, "notion", {"database_id": "db1"}, {"integration_token": "secret_x"})
    run = sync_source(src)
    doc = Document.objects.get(source=src)
    assert run.status == "ok" and doc.title == "Política de reembolso"
    assert "Status: Publicado" in doc.content and "7 dias" in doc.content


@pytest.mark.django_db
def test_slack_um_documento_por_canal_e_dia(tenant_id, rede):
    rede["GET slack.com/api/conversations.info"] = httpx.Response(
        200, json={"ok": True, "channel": {"name": "vendas"}}
    )
    rede["GET slack.com/api/conversations.history"] = httpx.Response(
        200,
        json={
            "ok": True,
            "messages": [
                {
                    "ts": "1790000000.0001",
                    "user": "U1",
                    "text": "Fechamos com a Acme, falar com ana@acme.com",
                },
            ],
            "has_more": False,
        },
    )
    src = _source(tenant_id, "slack", {"channel_ids": "C1"}, {"bot_token": "xoxb-1"})
    run = sync_source(src)
    doc = Document.objects.get(source=src)
    assert run.status == "ok" and doc.title.startswith("#vendas — ")
    assert "Fechamos com a Acme" in doc.content and "ana@acme.com" not in doc.content


@pytest.mark.django_db
def test_url_com_seletor(tenant_id, rede):
    html = (
        "<html><head><title>Docs</title><script>x()</script></head><body><nav>menu</nav>"
        "<article class='content'><h1>Instalação</h1><p>Rode o instalador.</p></article>"
        "</body></html>"
    )
    rede["GET docs.exemplo.com/guia"] = httpx.Response(
        200, text=html, headers={"content-type": "text/html"}
    )
    src = _source(
        tenant_id,
        "url",
        {"url": "https://docs.exemplo.com/guia", "css_selector": "article.content"},
    )
    sync_source(src)
    doc = Document.objects.get(source=src)
    assert doc.title == "Docs" and doc.content == "Instalação\nRode o instalador."


@pytest.mark.django_db
def test_email_imap_somente_leitura(tenant_id, monkeypatch):
    raw = (
        b"From: Ana <ana@cliente.com>\r\nSubject: Pedido 42\r\nMessage-ID: <m1@x>\r\n"
        b"Date: Fri, 25 Sep 2026 10:00:00 -0300\r\n\r\nPreciso de 3 licencas."
    )
    selected = {}

    class FakeImap:
        def __init__(self, host, port, timeout=None):
            pass

        def login(self, user, pw):
            assert pw == "senha-app"

        def select(self, folder, readonly=False):
            selected["readonly"] = readonly
            return "OK", [b"1"]

        def search(self, *a):
            return "OK", [b"1"]

        def fetch(self, num, what):
            return "OK", [(b"1 (RFC822)", raw)]

        def logout(self):
            pass

    monkeypatch.setattr(safe_http, "_resolve", lambda host, port: [PUBLIC_IP])
    monkeypatch.setattr("ingestion.connectors.documents.imaplib.IMAP4_SSL", FakeImap)
    src = _source(
        tenant_id,
        "email",
        {"host": "imap.exemplo.com", "user": "c@x.com"},
        {"password": "senha-app"},
    )
    run = sync_source(src)
    doc = Document.objects.get(source=src)
    assert run.status == "ok" and selected["readonly"] is True
    assert (
        doc.title == "Pedido 42"
        and "3 licencas" in doc.content
        and "ana@cliente.com" not in doc.content
    )


@pytest.mark.django_db
def test_webhook_assinado(api_client, tenant_id):
    src = _source(tenant_id, "webhook", {"expected_field": "texto"}, {"secret": "s3gredo"})
    url = f"{API}/webhooks/{src.public_id}/"
    body = json.dumps(
        {"id": "evt-1", "title": "Novo chamado", "texto": "Impressora parou"}
    ).encode()
    sig = "sha256=" + hmac.new(b"s3gredo", body, hashlib.sha256).hexdigest()
    res = api_client.post(url, body, content_type="application/json", HTTP_X_WEBHOOK_SIGNATURE=sig)
    assert res.status_code == 202, res.data
    doc = Document.objects.get(source=src)
    assert (doc.external_id, doc.title, doc.content) == (
        "webhook:evt-1",
        "Novo chamado",
        "Impressora parou",
    )
    bad = api_client.post(
        url, body, content_type="application/json", HTTP_X_WEBHOOK_SIGNATURE="sha256=00"
    )
    assert bad.status_code == 401
    assert (
        api_client.post(
            f"{API}/webhooks/{uuid.uuid4()}/",
            body,
            content_type="application/json",
            HTTP_X_WEBHOOK_SECRET="s3gredo",
        ).status_code
        == 404
    )


@pytest.mark.django_db
def test_sync_via_api_e_agendamento(auth_client, tenant_id, rede):
    rede["GET api.exemplo.com/a"] = httpx.Response(200, json=[{"id": 1, "x": "y"}])
    src = _source(
        tenant_id, "rest_api", {"url": "https://api.exemplo.com/a"}, sync_interval_minutes=15
    )
    assert src in sources_due()
    res = auth_client.post(f"{API}/sources/{src.id}/sync/")
    assert res.status_code in (200, 202)
    sync_source(src)
    assert src not in sources_due()  # acabou de rodar
    upload = _source(tenant_id, "upload", {})
    assert auth_client.post(f"{API}/sources/{upload.id}/sync/").status_code == 400


@pytest.mark.django_db
def test_excluir_conector_e_logico(auth_client, tenant_id):
    src = _source(tenant_id, "url", {"url": "https://x.com"})
    Document.objects.create(tenant_id=tenant_id, source=src, external_id="a", content="x")
    assert auth_client.delete(f"{API}/sources/{src.id}/").status_code == 204
    src.refresh_from_db()
    assert src.is_active is False and Document.objects.filter(source=src).count() == 1
    assert auth_client.get(f"{API}/sources/").data["count"] == 0


# ─── 3. Consulta estruturada ─────────────────────────────────────────────────


@pytest.fixture
def banco_sqlite(tmp_path, settings):
    settings.CONNECTORS_SQLITE_ROOT = str(tmp_path)
    conn = sqlite3.connect(tmp_path / "vendas.db")
    conn.execute(
        "CREATE TABLE pedidos (id INTEGER, cliente TEXT, email TEXT, mes TEXT, total REAL)"
    )
    conn.executemany(
        "INSERT INTO pedidos VALUES (?,?,?,?,?)",
        [
            (1, "Acme", "compras@acme.com", "2026-03", 1000.0),
            (2, "Beta", "b@beta.com", "2026-03", 250.5),
            (3, "Acme", "compras@acme.com", "2026-04", 90.0),
        ],
    )
    conn.commit()
    conn.close()
    return "vendas.db"


CONSULTAS = [
    {
        "nome": "vendas_do_mes",
        "descricao": "Total vendido e pedidos por cliente num mês (AAAA-MM).",
        "consulta": "SELECT cliente, email, count(*) AS pedidos, sum(total) AS total FROM pedidos "
        "WHERE mes = :mes GROUP BY cliente, email ORDER BY total DESC",
        "parametros": ["mes"],
    }
]


@pytest.mark.django_db
def test_consulta_sql_so_leitura_com_parametro_ligado(auth_client, banco_sqlite):
    res = auth_client.post(
        f"{API}/sources/",
        {
            "name": "Vendas",
            "source_type": "sql",
            "config": {"engine": "sqlite", "database": banco_sqlite, "consultas": CONSULTAS},
        },
        format="json",
    )
    assert res.status_code == 201, res.data
    sid = res.data["id"]
    assert res.data["mode"] == "structured"
    out = auth_client.post(
        f"{API}/sources/{sid}/run-query/",
        {"nome": "vendas_do_mes", "params": {"mes": "2026-03"}},
        format="json",
    ).data
    assert out["colunas"] == ["cliente", "email", "pedidos", "total"]
    assert out["linhas"][0][0] == "Acme" and out["linhas"][0][3] == 1000.0
    assert "compras@acme.com" not in json.dumps(out)  # PII mascarada no resultado
    # Tentativa de injeção vira só um valor que não casa
    inj = auth_client.post(
        f"{API}/sources/{sid}/run-query/",
        {"nome": "vendas_do_mes", "params": {"mes": "x' OR '1'='1"}},
        format="json",
    ).data
    assert inj["linhas"] == []
    # Não sincroniza (consulta na hora)
    assert auth_client.post(f"{API}/sources/{sid}/sync/").status_code == 400


@pytest.mark.parametrize(
    "consulta,erro",
    [
        ("DELETE FROM pedidos", "leitura"),
        ("SELECT 1; DROP TABLE pedidos", "uma instrução"),
        ("SELECT * FROM pedidos WHERE id = :id", "declare"),
    ],
)
@pytest.mark.django_db
def test_consulta_invalida_nao_salva(auth_client, consulta, erro):
    res = auth_client.post(
        f"{API}/sources/",
        {
            "name": "x",
            "source_type": "sql",
            "config": {
                "engine": "sqlite",
                "database": "a.db",
                "consultas": [
                    {
                        "nome": "consulta_teste",
                        "descricao": "uma consulta qualquer",
                        "consulta": consulta,
                    }
                ],
            },
        },
        format="json",
    )
    assert res.status_code == 400 and erro in str(res.data)


@pytest.mark.django_db
def test_consultas_viram_funcoes_da_ia_no_escopo_do_setor(tenant_id, banco_sqlite):
    from agency.services import _rag_scope_for
    from orchestration import registry
    from tests.factories import AgentFactory, SectorFactory

    vendas = _source(
        tenant_id,
        "sql",
        {"engine": "sqlite", "database": banco_sqlite, "consultas": CONSULTAS},
        name="Vendas",
    )
    nome = f"fonte{vendas.id}_vendas_do_mes"
    comercial = SectorFactory(tenant_id=tenant_id, name="Comercial")
    rh = SectorFactory(tenant_id=tenant_id, name="RH")
    comercial.extra_knowledge_sources.add(vendas)  # 4. várias fontes por setor
    ana = AgentFactory(tenant_id=tenant_id, sector=comercial)
    bia = AgentFactory(tenant_id=tenant_id, sector=rh)

    assert nome in registry.catalog_for_prompt(tenant_id, _rag_scope_for(ana))
    assert nome not in registry.catalog_for_prompt(tenant_id, _rag_scope_for(bia))
    assert nome not in registry.catalog_for_prompt(uuid.uuid4(), None)  # outro tenant
    out = registry.execute(nome, tenant_id, {"mes": "2026-04"}, _rag_scope_for(ana))
    assert out["linhas"][0][3] == 90.0
    with pytest.raises(LookupError):
        registry.execute(nome, tenant_id, {"mes": "2026-04"}, _rag_scope_for(bia))


@pytest.mark.django_db
def test_agente_responde_com_consulta_do_conector(tenant_id, banco_sqlite, monkeypatch):
    from agency.services import ask_as_agent
    from tests.factories import AgentFactory, SectorFactory

    vendas = _source(
        tenant_id, "sql", {"engine": "sqlite", "database": banco_sqlite, "consultas": CONSULTAS}
    )
    setor = SectorFactory(tenant_id=tenant_id, knowledge_source=vendas)
    agente = AgentFactory(tenant_id=tenant_id, sector=setor)
    monkeypatch.setattr("harness.providers.get_active_provider", lambda tenant_id: "groq")
    calls = []

    def fake_chat(tenant_id, provider, model, messages, **kw):
        calls.append(messages)
        if kw.get("json_mode"):
            assert f"fonte{vendas.id}_vendas_do_mes" in messages[0]["content"]
            return json.dumps(
                {"function": f"fonte{vendas.id}_vendas_do_mes", "params": {"mes": "2026-03"}}
            )
        assert "1250.5" in messages[1]["content"] or "1000.0" in messages[1]["content"]
        return "Em março: Acme R$ 1.000,00 e Beta R$ 250,50."

    monkeypatch.setattr("orchestration.services.chat_completion", fake_chat)
    monkeypatch.setattr("ingestion.services.semantic_search", lambda *a, **k: [])
    result = ask_as_agent(tenant_id, agente.id, "Quanto vendemos em março?")
    assert (
        "Acme" in result["answer"]
        and result["function_called"] == f"fonte{vendas.id}_vendas_do_mes"
    )


@pytest.mark.django_db
def test_hubspot_busca_com_filtro(tenant_id, rede):
    seen = {}

    def search(request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "id": "11",
                        "properties": {
                            "dealname": "Acme Pro",
                            "amount": "5000",
                            "dealstage": "closedwon",
                        },
                    },
                ]
            },
        )

    rede["POST api.hubapi.com/crm/v3/objects/deals/search"] = search
    from ingestion.connectors.structured import HubSpotConnector

    src = _source(
        tenant_id,
        "hubspot",
        {
            "consultas": [
                {
                    "nome": "negocios_por_etapa",
                    "descricao": "Negócios do HubSpot numa etapa do funil.",
                    "objeto": "deals",
                    "propriedades": "dealname,amount",
                    "filtro_propriedade": "dealstage",
                }
            ]
        },
        {"api_key": "pat-1"},
    )
    out = HubSpotConnector(src).run("negocios_por_etapa", {"valor": "closedwon"})
    assert seen["body"]["filterGroups"][0]["filters"][0] == {
        "propertyName": "dealstage",
        "operator": "EQ",
        "value": "closedwon",
    }
    assert out["colunas"] == ["id", "dealname", "amount"] and out["linhas"] == [
        ["11", "Acme Pro", "5000"]
    ]


@pytest.mark.django_db
def test_salesforce_escapa_parametro(tenant_id, rede):
    seen = {}
    rede["POST acme.my.salesforce.com/services/oauth2/token"] = httpx.Response(
        200, json={"access_token": "t", "instance_url": "https://acme.my.salesforce.com"}
    )

    def query(request):
        seen["q"] = request.url.params["q"]
        return httpx.Response(
            200,
            json={
                "done": True,
                "records": [
                    {"attributes": {}, "Name": "Acme", "AnnualRevenue": 10},
                ],
            },
        )

    rede["GET acme.my.salesforce.com/services/data/v60.0/query"] = query
    from ingestion.connectors.structured import SalesforceConnector

    src = _source(
        tenant_id,
        "salesforce",
        {
            "client_id": "cid",
            "instance_url": "https://acme.my.salesforce.com",
            "consultas": [
                {
                    "nome": "contas_por_nome",
                    "descricao": "Contas do Salesforce pelo nome.",
                    "consulta": "SELECT Name, AnnualRevenue FROM Account WHERE Name = :nome",
                    "parametros": ["nome"],
                }
            ],
        },
        {"client_secret": "sec"},
    )
    out = SalesforceConnector(src).run("contas_por_nome", {"nome": "x' OR Name != '"})
    assert (
        seen["q"]
        == "SELECT Name, AnnualRevenue FROM Account WHERE Name = 'x\\' OR Name != \\'' LIMIT 200"
    )
    assert out["linhas"] == [["Acme", 10]]
    assert soql_literal(12) == "12"


# ─── 4 e 5. Acesso por setor e painel ────────────────────────────────────────


@pytest.mark.django_db
def test_painel_e_acesso_por_setor(auth_client, tenant_id, rede):
    from tests.factories import AgentFactory, CeoAgentFactory, SectorFactory

    rede["GET api.exemplo.com/kb"] = httpx.Response(
        200, json=[{"id": 1, "texto": "Garantia de 12 meses"}]
    )
    src = _source(
        tenant_id, "rest_api", {"url": "https://api.exemplo.com/kb"}, name="Base de suporte"
    )
    sync_source(src)
    comercial = SectorFactory(tenant_id=tenant_id, name="Comercial")
    SectorFactory(tenant_id=tenant_id, name="Suporte", knowledge_source=src)
    AgentFactory(tenant_id=tenant_id, sector=comercial)
    CeoAgentFactory(tenant_id=tenant_id, name="Clara CEO")

    ov = auth_client.get(f"{API}/sources/{src.id}/overview/").data
    assert ov["documents"]["active"] == 1 and ov["runs"][0]["status"] == "ok"
    assert "Garantia" in ov["recent_documents"][0]["excerpt"]

    access = auth_client.get(f"/api/v1/agency/source-access/?source={src.id}").data
    rows = {r["name"]: r["access"] for r in access["sectors"]}
    assert rows == {"Comercial": None, "Suporte": "principal"} and access["full_access"] == [
        "Clara CEO"
    ]
    access = auth_client.post(
        "/api/v1/agency/source-access/",
        {"source": src.id, "sectors": [comercial.id]},
        format="json",
    ).data
    assert {r["name"]: r["access"] for r in access["sectors"]} == {
        "Comercial": "adicional",
        "Suporte": "principal",
    }
    sector = auth_client.get(f"/api/v1/agency/sectors/{comercial.id}/").data
    assert sector["knowledge_source_ids"] == [src.id] and sector[
        "extra_knowledge_source_names"
    ] == ["Base de suporte"]


@pytest.mark.django_db
def test_setor_nao_aceita_fonte_de_outro_tenant(auth_client, tenant_id):
    from tests.factories import SectorFactory

    alheia = _source(uuid.uuid4(), "url", {"url": "https://x.com"})
    setor = SectorFactory(tenant_id=tenant_id)
    res = auth_client.patch(
        f"/api/v1/agency/sectors/{setor.id}/",
        {"extra_knowledge_sources": [alheia.id]},
        format="json",
    )
    assert res.status_code == 400


@pytest.mark.django_db
def test_registros_busca_ficha_e_previa_do_agente(auth_client, tenant_id, rede, monkeypatch):
    from ingestion import views
    from ingestion.services import EmbeddingError, RetrievedChunk

    rede["GET api.exemplo.com/produtos"] = httpx.Response(
        200,
        json=[
            {"id": i, "nome": f"Produto {i}", "garantia": "12 meses" if i == 3 else "sem"}
            for i in range(30)
        ],
    )
    src = _source(
        tenant_id,
        "rest_api",
        {"url": "https://api.exemplo.com/produtos", "title_field": "nome"},
        name="Catálogo",
    )
    sync_source(src)

    page = auth_client.get(f"{API}/sources/{src.id}/records/").data
    assert (page["count"], page["pages"], len(page["results"])) == (30, 2, 25)
    assert len(auth_client.get(f"{API}/sources/{src.id}/records/?page=2").data["results"]) == 5
    found = auth_client.get(f"{API}/sources/{src.id}/records/?search=12 meses").data
    assert found["count"] == 1 and found["results"][0]["title"] == "Produto 3"

    doc_id = found["results"][0]["id"]
    ficha = auth_client.get(f"{API}/sources/{src.id}/records/{doc_id}/").data
    assert "garantia: 12 meses" in ficha["content"] and ficha["external_id"] == "item:3"
    # registro de outra fonte não aparece por esta rota
    outra = _source(tenant_id, "url", {"url": "https://x.com"})
    assert auth_client.get(f"{API}/sources/{outra.id}/records/{doc_id}/").status_code == 404

    # sem embeddings: prévia por palavra, avisando
    def sem_embeddings(*a, **k):
        raise EmbeddingError("Ollama fora do ar")

    monkeypatch.setattr(views, "semantic_search", sem_embeddings)
    prev = auth_client.post(
        f"{API}/sources/{src.id}/agent-preview/", {"question": "garantia 12 meses"}, format="json"
    ).data
    assert prev["mode"] == "texto" and "Ollama fora do ar" in prev["notice"]
    assert prev["results"][0]["title"] == "Produto 3"

    # com embeddings: a MESMA busca do agente, restrita a esta fonte
    chamadas = {}

    def busca(q, tenant_id, top_k, source_ids):
        chamadas["source_ids"] = source_ids
        return [RetrievedChunk("garantia: 12 meses", "Produto 3", "Catálogo", 0.2, doc_id)]

    monkeypatch.setattr(views, "semantic_search", busca)
    prev = auth_client.post(
        f"{API}/sources/{src.id}/agent-preview/", {"question": "garantia"}, format="json"
    ).data
    assert prev["mode"] == "semantica" and prev["results"][0]["score"] == 0.8
    assert chamadas["source_ids"] == [src.id]
    assert (
        auth_client.post(f"{API}/sources/{src.id}/agent-preview/", {}, format="json").status_code
        == 400
    )


def _fake_mcp(rede, calls):
    """Servidor MCP falso: initialize em JSON, tools/list e tools/call em SSE."""

    def handler(request: httpx.Request):
        msg = json.loads(request.content)
        calls.append((msg.get("method"), request.headers.get("mcp-session-id"), request.headers.get("authorization")))
        if msg.get("method") == "initialize":
            return httpx.Response(
                200,
                headers={"mcp-session-id": "sess-1"},
                json={"jsonrpc": "2.0", "id": msg["id"], "result": {"protocolVersion": "2025-06-18"}},
            )
        if "id" not in msg:  # notificação
            return httpx.Response(202)
        if msg["method"] == "tools/list":
            result = {"tools": [
                {"name": "buscar_cliente", "description": "Busca cliente pelo nome",
                 "inputSchema": {"type": "object", "properties": {"nome": {"type": "string"}, "limite": {"type": "integer"}},
                                 "required": ["nome"]},
                 "annotations": {"readOnlyHint": True}},
                {"name": "criar_ticket", "description": "Abre um ticket",
                 "inputSchema": {"type": "object", "properties": {"titulo": {"type": "string"}}}},
            ]}
        elif msg["method"] == "tools/call":
            args = msg["params"]["arguments"]
            result = {"content": [{"type": "text", "text": f"Cliente {args['nome']} — contato ana@cliente.com, limite {args.get('limite')}"}]}
        else:
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": msg["id"], "error": {"message": "?"}})
        body = f"event: message\ndata: {json.dumps({'jsonrpc': '2.0', 'id': msg['id'], 'result': result})}\n\n"
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=body)

    rede["POST mcp.exemplo.com/mcp"] = handler


@pytest.mark.django_db
def test_mcp_so_ferramentas_liberadas_viram_funcoes(auth_client, tenant_id, rede):
    from orchestration import registry

    calls = []
    _fake_mcp(rede, calls)
    res = auth_client.post(
        f"{API}/sources/",
        {"name": "CRM via MCP", "source_type": "mcp",
         "config": {"url": "https://mcp.exemplo.com/mcp", "auth_type": "bearer", "api_key": "tok-mcp-123456789"}},
        format="json",
    )
    assert res.status_code == 201, res.data
    sid = res.data["id"]
    assert res.data["mode"] == "structured" and "tok-mcp" not in str(res.data)

    test = auth_client.post(f"{API}/sources/{sid}/test-connection/").data
    assert test["ok"] and "2 ferramenta(s)" in test["message"], test
    assert calls[0] == ("initialize", None, "Bearer tok-mcp-123456789")
    assert calls[-1][1] == "sess-1"  # sessão reaproveitada

    tools = auth_client.post(f"{API}/sources/{sid}/mcp-discover/").data["tools"]
    assert {t["nome"]: t["somente_leitura"] for t in tools} == {"buscar_cliente": True, "criar_ticket": False}

    # Nada liberado ainda: nenhuma função pros agentes
    assert not [f for f in registry.dynamic_functions(tenant_id) if f.name.startswith(f"fonte{sid}_")]

    # Pessoa libera as duas; sem risco escolhido, quem escreve nasce "medium"
    res = auth_client.post(
        f"{API}/sources/{sid}/mcp-tools/",
        {"ferramentas": [{"nome": "buscar_cliente"}, {"nome": "criar_ticket"}]},
        format="json",
    )
    assert res.data["ferramentas"] == [
        {"nome": "buscar_cliente", "risco": "low"},
        {"nome": "criar_ticket", "risco": "medium"},
    ]
    bad = auth_client.post(f"{API}/sources/{sid}/mcp-tools/", {"ferramentas": ["apagar_tudo"]}, format="json")
    assert bad.status_code == 400

    funcs = {f.name: f for f in registry.dynamic_functions(tenant_id)}
    assert funcs[f"fonte{sid}_criar_ticket"].risk == "medium"
    # Escopo por setor: fonte fora do escopo não aparece
    assert not registry.dynamic_functions(tenant_id, source_ids=[])

    out = registry.execute(f"fonte{sid}_buscar_cliente", tenant_id, {"nome": "Acme", "limite": "3"})
    assert "Cliente Acme" in out["resultado"] and "ana@cliente.com" not in out["resultado"]  # LGPD
    assert "limite 3" in out["resultado"]  # "3" virou inteiro pelo schema

    ov = auth_client.get(f"{API}/sources/{sid}/overview/").data
    assert [q["nome"] for q in ov["queries"]] == ["buscar_cliente", "criar_ticket"]
    assert {t["nome"]: t["liberada"] for t in ov["mcp_tools"]} == {"buscar_cliente": True, "criar_ticket": True}

    # Editar o token não perde as ferramentas liberadas
    auth_client.patch(
        f"{API}/sources/{sid}/",
        {"config": {"url": "https://mcp.exemplo.com/mcp", "auth_type": "bearer", "api_key": "••••6789"}},
        format="json",
    )
    src = KnowledgeSource.objects.get(pk=sid)
    assert len(src.config["ferramentas"]) == 2 and src.get_secrets()["api_key"] == "tok-mcp-123456789"
