# backend_api/Api/tests/integration/test_ti_observabilidade.py
"""
Setor de TI + observabilidade: métricas (API, IA, HTTP), erros do log,
verificações, incidentes (inclusive queda do banco registrada depois),
diagnóstico da IA com fatos citados, chamados atendidos por Tasks.
"""
import json
import logging
import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from observabilidade import coletor, motor
from observabilidade.models import PLATAFORMA, EstadoComponente, EventoErro, Incidente, Metrica
from observabilidade.registro import Resultado

HD = "/api/v1/helpdesk"
OBS = "/api/v1/observabilidade"

DIAGNOSTICO = {
    "causa_provavel": "O banco recusou conexões [F1].",
    "evidencias": ["Conexão recusada [F1]", "Fato que não existe [F99]"],
    "impacto": "Telas sem dados [F1].",
    "acoes": ["Subir o serviço do Postgres"],
    "prevencao": ["Healthcheck no container"],
    "confianca": "media",
}
ATENDIMENTO = {
    "resposta": "Não há queda em andamento [F1]. Limpe o cache e entre de novo.",
    "passos": ["Sair", "Limpar cache", "Entrar"],
    "perguntas": ["Desde quando?"],
    "prioridade_sugerida": "media",
    "encaminhar_para": "",
    "relacionado_a_incidente": False,
}


def fake_chat(resposta):
    def _chat(*a, **k):
        return json.dumps(resposta)

    return _chat


@pytest.fixture(autouse=True)
def ambiente(settings, monkeypatch):
    settings.CELERY_BROKER_URL = "memory://"
    coletor._buffer.clear()

    def na_hora(tarefa, *args):
        tarefa(*args)
        return False

    monkeypatch.setattr("helpdesk.tasks.despachar", na_hora)
    # Sem Redis nos testes: a anotação de queda do banco usa um dicionário
    monkeypatch.setattr(motor, "_redis", lambda: FakeRedis.inst)
    FakeRedis.inst = FakeRedis()


class FakeRedis:
    inst = None

    def __init__(self):
        self.d = {}

    def exists(self, k):
        return k in self.d

    def set(self, k, v):
        self.d[k] = v

    def get(self, k):
        return self.d.get(k)

    def delete(self, k):
        self.d.pop(k, None)


@pytest.fixture
def time_ti(auth_client):
    r = auth_client.post(f"{HD}/equipe/")
    assert r.status_code == 201
    return r.json()


def _falha(chave="plataforma.banco", grupo="plataforma", nome="Banco de dados (Postgres)"):
    return Resultado(
        chave,
        grupo,
        nome,
        "falha",
        "conexão recusada",
        causa="serviço parado",
        acao="subir o serviço",
        gravidade="critica",
    )


# ─── Observabilidade ─────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_coletor_soma_no_mesmo_minuto(tenant_id):
    coletor.registrar("ia", "openai:gpt", 100, tenant_id=tenant_id)
    coletor.registrar("ia", "openai:gpt", 300, erro=True, tenant_id=tenant_id)
    coletor.gravar()
    coletor.registrar("ia", "openai:gpt", 50, tenant_id=tenant_id)
    coletor.gravar()
    m = Metrica.objects.get(tenant_id=tenant_id, tipo="ia", chave="openai:gpt")
    assert (m.total, m.erros, m.ms_total, m.ms_max) == (3, 1, 450, 300)


@pytest.mark.django_db
def test_middleware_mede_api_por_rota_e_empresa(auth_client, tenant_id):
    auth_client.get(f"{HD}/painel/")
    auth_client.get(f"{HD}/tickets/999999/")
    coletor.gravar()
    chaves = dict(
        Metrica.objects.filter(tenant_id=tenant_id, tipo="api").values_list(
            "chave", "erros_cliente"
        )
    )
    assert chaves["GET /api/v1/helpdesk/painel/"] == 0
    assert any(k.startswith("GET /api/v1/helpdesk/tickets/") and "999999" not in k for k in chaves)


@pytest.mark.django_db
def test_sinais_de_ia_e_http_viram_metricas(tenant_id):
    from core.signals import chamada_ia, saida_http

    chamada_ia.send(
        None, tenant_id=tenant_id, provider="groq", model="llama", ok=False, ms=900, erro="401"
    )
    saida_http.send(None, host="api.exemplo.com", method="GET", status=503, ms=120, erro="")
    coletor.gravar()
    assert Metrica.objects.get(tenant_id=tenant_id, tipo="ia").erros == 1
    http = Metrica.objects.get(tenant_id=PLATAFORMA, tipo="http", chave="api.exemplo.com")
    assert http.erros == 1


@pytest.mark.django_db
def test_erro_do_log_agrupa_e_mascara_pii():
    # O handler está no logger raiz (settings LOGGING)
    log = logging.getLogger("teste.ti")
    for email in ("ana@exemplo.com", "beto@exemplo.com"):
        log.error("Falha ao enviar para %s", email)
    ev = EventoErro.objects.get(logger="teste.ti")
    assert ev.ocorrencias == 2
    assert "exemplo.com" not in ev.mensagem


def test_explicar_erro_do_banco_em_portugues():
    from observabilidade.banco import explicar

    causa, acao = explicar(
        Exception('connection to server at "db" (10.0.0.2), port 5432 failed: Connection refused')
    )
    assert "aceitando conexões" in causa.lower() and acao
    causa, _ = explicar(Exception("FATAL: sorry, too many clients already"))
    assert "conex" in causa.lower()


@pytest.mark.django_db
def test_saude_publica_sem_login_e_503_quando_cai(api_client, monkeypatch):
    from observabilidade import plataforma

    r = api_client.get(f"{OBS}/saude/")
    assert r.status_code in (200, 503) and r.json()["componentes"]
    assert all(set(c) == {"nome", "status", "causa", "acao"} for c in r.json()["componentes"])
    monkeypatch.setattr(plataforma, "todas", lambda com_banco=True: [_falha()])
    r = api_client.get(f"{OBS}/saude/")
    assert r.status_code == 503 and r.json()["status"] == "falha"


# ─── Incidente → chamado → diagnóstico ───────────────────────────────────────


@pytest.mark.django_db
def test_duas_falhas_abrem_incidente_chamado_e_diagnostico(auth_client, tenant_id, time_ti):
    from agency.models import Task
    from helpdesk.models import Ticket

    r = _falha("conector.1", "conector", "Conector Planilha")
    with patch("harness.providers.chat_completion", fake_chat(DIAGNOSTICO)):
        motor.aplicar(tenant_id, [r])
        assert not Incidente.objects.filter(tenant_id=tenant_id).exists()  # 1 falha não basta
        motor.aplicar(tenant_id, [r])
    inc = Incidente.objects.get(tenant_id=tenant_id, status="aberto")
    t = Ticket.objects.get(tenant_id=tenant_id, incidente_id=inc.id)
    assert inc.chamado_id == t.id and t.origem == "incidente" and t.prioridade == "critica"
    assert t.categoria == "integracao" and t.agente.name == "Analista de Integrações"
    assert t.task.task_type == "chamado" and t.task.status == Task.Status.IN_PROGRESS
    inc.refresh_from_db()
    d = inc.diagnostico
    assert d["causa_provavel"].endswith("[F1].") and d["citacoes_invalidas"] == ["[F99]"]
    assert "[F99]" not in " ".join(d["evidencias"]) and d["fatos"][0]["id"] == "F1"
    assert t.interacoes.filter(tipo="ia").exists()

    # voltou: chamado espera confirmação humana (não resolve sozinho)
    motor.aplicar(tenant_id, [Resultado("conector.1", "conector", "Conector Planilha", "ok")])
    inc.refresh_from_db()
    t.refresh_from_db()
    assert inc.status == "resolvido" and t.status == "aguardando"


@pytest.mark.django_db
def test_queda_do_banco_registrada_quando_volta(auth_client, tenant_id, time_ti, monkeypatch):
    from helpdesk.models import Ticket
    from observabilidade import plataforma

    monkeypatch.setattr(plataforma, "todas", lambda com_banco=True: [_falha()])
    motor.rodar_plataforma()
    motor.rodar_plataforma()
    assert not Incidente.objects.exists()  # banco fora: nada gravado, só anotado
    assert motor.CHAVE_QUEDA_BANCO in FakeRedis.inst.d

    ok = Resultado("plataforma.banco", "plataforma", "Banco de dados (Postgres)", "ok")
    monkeypatch.setattr(plataforma, "todas", lambda com_banco=True: [ok])
    with patch("harness.providers.chat_completion", fake_chat(DIAGNOSTICO)):
        motor.rodar_plataforma()
    inc = Incidente.objects.get(tenant_id=PLATAFORMA, chave="plataforma.banco")
    assert (
        inc.status == "resolvido"
        and inc.dados["registrado_depois"]
        and inc.causa == "serviço parado"
    )
    t = Ticket.objects.get(tenant_id=tenant_id, incidente_id=inc.id)
    assert t.categoria == "banco" and t.agente.name == "DBA" and t.status == "aguardando"
    assert motor.CHAVE_QUEDA_BANCO not in FakeRedis.inst.d


@pytest.mark.django_db
def test_incidente_da_plataforma_so_vai_pra_empresa_com_time_de_ti(auth_client, tenant_id, time_ti):
    from helpdesk.models import Ticket

    sem_ti = uuid.uuid4()
    with patch("harness.providers.chat_completion", fake_chat(DIAGNOSTICO)):
        motor.aplicar(PLATAFORMA, [_falha("plataforma.redis", nome="Redis")])
        motor.aplicar(PLATAFORMA, [_falha("plataforma.redis", nome="Redis")])
    assert Ticket.objects.filter(tenant_id=tenant_id, origem="incidente").count() == 1
    assert not Ticket.objects.filter(tenant_id=sem_ti).exists()


@pytest.mark.django_db
def test_diagnostico_sob_demanda_respeita_tenant(auth_client, api_client, tenant_id, time_ti):
    from User.models import CustomUser

    inc = Incidente.objects.create(
        tenant_id=tenant_id, chave="ia.setor.1", grupo="ia", titulo="IA fora"
    )
    with patch("harness.providers.chat_completion", fake_chat(DIAGNOSTICO)):
        r = auth_client.post(f"{HD}/incidentes/{inc.id}/diagnosticar/")
    assert r.status_code == 200 and r.json()["agente"]["nome"] == "Analista de Integrações"

    outro = CustomUser.objects.create_user(
        email="o@x.com", password="x" * 12, name="O", tenant_id=uuid.uuid4()
    )
    api_client.force_authenticate(outro)
    assert api_client.post(f"{HD}/incidentes/{inc.id}/diagnosticar/").status_code == 404


# ─── Chamados ────────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_montar_time_de_ti_e_idempotente(auth_client, tenant_id):
    from agency.models import Agent

    r1 = auth_client.post(f"{HD}/equipe/").json()
    assert r1["setor_criado"] and len(r1["criados"]) == 6
    r2 = auth_client.post(f"{HD}/equipe/").json()
    assert r2["criados"] == [] and len(r2["existentes"]) == 6
    head = Agent.objects.get(tenant_id=tenant_id, name="Head de TI")
    assert (
        head.access_level == "sector_orchestrator"
        and "Diagnóstico só com fato" in head.instructions
    )
    assert len(auth_client.get(f"{HD}/equipe/").json()["agentes"]) == 6


@pytest.mark.django_db
def test_ciclo_do_chamado_pelas_tasks(auth_client, tenant_id, time_ti):
    from agency.models import Task

    r = auth_client.post(
        f"{HD}/tickets/",
        {
            "titulo": "Banco lento",
            "descricao": "relatórios travando",
            "categoria": "banco",
            "prioridade": "alta",
        },
        format="json",
    )
    assert r.status_code == 201, r.content
    c = r.json()
    assert c["agente_nome"] == "DBA" and c["sla_horas"] == 8 and c["task_status"] == "created"
    assert 470 < c["sla_restante_min"] <= 480 and c["solicitante"] == "teste@example.com"

    with patch("harness.providers.chat_completion", fake_chat(ATENDIMENTO)):
        r = auth_client.post(
            f"{HD}/tickets/{c['id']}/atender-ia/", {"instrucoes": "seja breve"}, format="json"
        )
    assert r.status_code == 201 and r.json()["tipo"] == "ia" and r.json()["dados"]["passos"]
    t = auth_client.get(f"{HD}/tickets/{c['id']}/").json()
    assert t["status"] == "em_atendimento" and t["task_status"] == "in_progress"
    assert t["primeira_resposta_em"] is None  # sugestão da IA não é resposta

    auth_client.post(
        f"{HD}/tickets/{c['id']}/responder/", {"texto": "Olá, estamos vendo."}, format="json"
    )
    assert auth_client.get(f"{HD}/tickets/{c['id']}/").json()["primeira_resposta_em"]

    assert (
        auth_client.post(
            f"{HD}/tickets/{c['id']}/resolver/", {"solucao": ""}, format="json"
        ).status_code
        == 400
    )
    r = auth_client.post(
        f"{HD}/tickets/{c['id']}/resolver/", {"solucao": "índice criado"}, format="json"
    )
    assert r.json()["status"] == "resolvido" and r.json()["task_status"] == "approved"

    r = auth_client.post(f"{HD}/tickets/{c['id']}/reabrir/", {"motivo": "voltou"}, format="json")
    assert r.json()["status"] == "aberto" and r.json()["task_status"] == "created"
    assert Task.objects.filter(tenant_id=tenant_id, task_type="chamado").count() == 2
    tipos = [i["tipo"] for i in auth_client.get(f"{HD}/tickets/{c['id']}/interacoes/").json()]
    assert tipos[0] == "sistema" and "ia" in tipos and "resposta" in tipos


@pytest.mark.django_db
def test_aprovar_ou_rejeitar_a_task_no_quadro_move_o_chamado(auth_client, tenant_id, time_ti):
    c = auth_client.post(
        f"{HD}/tickets/", {"titulo": "Sem acesso", "categoria": "acesso"}, format="json"
    ).json()
    assert c["agente_nome"] == "Segurança da Informação"
    auth_client.post(f"{HD}/tickets/{c['id']}/responder/", {"texto": "ok"}, format="json")
    auth_client.post(f"/api/v1/agency/tasks/{c['task']}/reject/", {"reason": "não"}, format="json")
    assert auth_client.get(f"{HD}/tickets/{c['id']}/").json()["status"] == "aberto"

    t = auth_client.post(
        f"{HD}/tickets/{c['id']}/atribuir/", {"papel": "suporte"}, format="json"
    ).json()
    assert t["agente_nome"] == "Analista de Suporte" and t["task"] != c["task"]
    auth_client.post(f"/api/v1/agency/tasks/{t['task']}/approve/", {}, format="json")
    t = auth_client.get(f"{HD}/tickets/{c['id']}/").json()
    assert t["status"] == "resolvido" and t["solucao"]


@pytest.mark.django_db
def test_chamado_de_outro_tenant_nao_aparece(auth_client, api_client, tenant_id, time_ti):
    from helpdesk.services import abrir_chamado

    alheio = abrir_chamado(uuid.uuid4(), "alheio")
    assert auth_client.get(f"{HD}/tickets/{alheio.id}/").status_code == 404
    assert (
        auth_client.post(
            f"{HD}/tickets/{alheio.id}/resolver/", {"solucao": "x"}, format="json"
        ).status_code
        == 404
    )


@pytest.mark.django_db
def test_excluir_chamado_e_logico(auth_client, tenant_id):
    from helpdesk.models import Ticket

    c = auth_client.post(f"{HD}/tickets/", {"titulo": "x"}, format="json").json()
    assert auth_client.delete(f"{HD}/tickets/{c['id']}/").status_code == 204
    assert Ticket.objects.get(pk=c["id"]).is_active is False


@pytest.mark.django_db
def test_painel_ti(auth_client, tenant_id, time_ti):
    auth_client.post(f"{HD}/tickets/", {"titulo": "a", "prioridade": "critica"}, format="json")
    p = auth_client.get(f"{HD}/painel/").json()
    assert p["abertos"] == 1 and p["por_prioridade"] == {"critica": 1} and p["sem_resposta"] == 1
    assert p["tem_time"] is True


# ─── Verificações, funções da IA, observabilidade dos agentes ────────────────


@pytest.mark.django_db
def test_verificacoes_da_empresa(tenant_id, time_ti):
    from agency.models import Agent, Task
    from helpdesk import verificacoes
    from ingestion.models import KnowledgeSource

    KnowledgeSource.objects.create(
        tenant_id=tenant_id,
        name="Planilha",
        source_type="rest_api",
        last_sync_status="error",
        last_sync_message="401 Unauthorized",
    )
    r = verificacoes.verificar_conectores(tenant_id)
    assert r[0].status == "falha" and "401" in r[0].detalhe

    agent = Agent.objects.filter(tenant_id=tenant_id).first()
    Task.objects.create(
        tenant_id=tenant_id,
        agent=agent,
        brief="x",
        status="in_progress",
        updated_at=timezone.now() - timedelta(hours=2),
    )
    Task.objects.create(
        tenant_id=tenant_id,
        agent=agent,
        brief="y",
        status="rejected",
        result={"error": "Ollama fora"},
    )
    res = {x.chave: x for x in verificacoes.verificar_agentes(tenant_id)}
    assert res["agentes.tarefas_presas"].status == "alerta"
    assert res["agentes.falhas"].status == "alerta"

    ia = verificacoes.verificar_ia(tenant_id)
    assert any(x.chave.startswith("ia.setor.") for x in ia)


@pytest.mark.django_db
def test_rodar_tenant_guarda_estado(tenant_id, time_ti):
    motor.rodar_tenant(tenant_id, forcar=True)
    assert EstadoComponente.objects.filter(tenant_id=tenant_id, grupo="agentes").exists()


@pytest.mark.django_db
def test_funcoes_da_ia_do_ti(tenant_id, time_ti):
    from helpdesk.models import Ticket
    from orchestration import registry

    r = registry.execute(
        "ti_abrir_chamado",
        tenant_id,
        {
            "titulo": "Integração parou",
            "descricao": "avise joao@empresa.com",
            "categoria": "integracao",
            "prioridade": "urgentissima",
        },
    )
    t = Ticket.objects.get(pk=r["chamado"])
    assert (
        t.origem == "agente" and t.prioridade == "media" and "joao@empresa.com" not in t.descricao
    )
    assert registry.execute("ti_chamados_abertos", tenant_id, {})["total"] == 1
    assert "tudo_ok" in registry.execute("ti_status_sistema", tenant_id, {})


@pytest.mark.django_db
def test_observabilidade_de_todos_os_agentes(auth_client, tenant_id, time_ti):
    from agency.models import Agent, AgentInteraction

    a = Agent.objects.get(tenant_id=tenant_id, name="DBA")
    AgentInteraction.objects.create(
        tenant_id=tenant_id,
        agent=a,
        question="q",
        answer="a",
        tokens_used=100,
        estimated_cost_usd=0.01,
        provider="groq",
    )
    d = auth_client.get(f"{HD}/agentes/?horas=24").json()
    dba = next(x for x in d["agentes"] if x["nome"] == "DBA")
    assert dba["chamadas"] == 1 and dba["tokens"] == 100 and dba["provedor"] == "groq"
    assert d["setores"][0]["agentes"] == 6


@pytest.mark.django_db
def test_painel_de_observabilidade_escopo(auth_client, tenant_id, user):
    EstadoComponente.objects.create(
        tenant_id=PLATAFORMA,
        chave="plataforma.redis",
        grupo="plataforma",
        nome="Redis",
        status="ok",
    )
    EstadoComponente.objects.create(
        tenant_id=uuid.uuid4(), chave="conector.9", grupo="conector", nome="Alheio", status="falha"
    )
    p = auth_client.get(f"{OBS}/painel/").json()
    nomes = {c["nome"] for c in p["componentes"]}
    assert "Alheio" not in nomes and "erros" not in p or not p.get("erros")
    assert auth_client.get(f"{OBS}/erros/").status_code == 403
    user.is_staff = True
    user.save()
    assert auth_client.get(f"{OBS}/erros/").status_code == 200


@pytest.mark.django_db
def test_empresa_ve_plataforma_sem_detalhe_tecnico(auth_client, user):
    EstadoComponente.objects.create(
        tenant_id=PLATAFORMA,
        chave="plataforma.banco",
        grupo="plataforma",
        nome="Banco",
        status="falha",
        detalhe="host db:5432",
        causa="parado",
        dados={"tamanho": "2 GB"},
    )
    c = next(
        x for x in auth_client.get(f"{OBS}/painel/").json()["componentes"] if x["nome"] == "Banco"
    )
    assert c["causa"] == "parado" and c["detalhe"] == "" and c["dados"] == {}
    user.is_staff = True
    user.save()
    c = next(
        x for x in auth_client.get(f"{OBS}/painel/").json()["componentes"] if x["nome"] == "Banco"
    )
    assert c["detalhe"] == "host db:5432"


@pytest.mark.django_db
def test_incidente_da_plataforma_nao_expoe_ip_pra_empresa(auth_client, tenant_id, time_ti):
    from helpdesk import fatos
    from helpdesk.models import Ticket

    r = Resultado(
        "plataforma.banco",
        "plataforma",
        "Banco",
        "falha",
        'connection to server at "db" (172.18.0.3), port 5432 failed',
        causa="parado",
    )
    with patch("harness.providers.chat_completion", fake_chat(DIAGNOSTICO)):
        motor.aplicar(PLATAFORMA, [r])
        motor.aplicar(PLATAFORMA, [r])
    inc = Incidente.objects.get(tenant_id=PLATAFORMA)
    t = Ticket.objects.get(tenant_id=tenant_id, incidente_id=inc.id)
    assert "172.18" not in t.descricao and "parado" in t.descricao
    assert not any("172.18" in f for f in fatos.coletar(PLATAFORMA, inc))


def test_rota_do_router_fica_legivel():
    from observabilidade.middleware import rota_legivel

    assert rota_legivel("api/v1/helpdesk/tickets/(?P<pk>[^/.]+)/interacoes/$") == (
        "api/v1/helpdesk/tickets/<pk>/interacoes/"
    )
    assert rota_legivel("api/v1/x/<int:pk>/") == "api/v1/x/<int:pk>/"
