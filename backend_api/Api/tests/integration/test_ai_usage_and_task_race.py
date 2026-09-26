# backend_api/Api/tests/integration/test_ai_usage_and_task_race.py
"""
Custo com tokens reais (informados pelo provedor) e preço por modelo;
Claude atual sem `temperature`; e execute_task não sobrescrevendo uma Task
pausada/decidida enquanto o modelo rodava.
"""
from decimal import Decimal
from unittest.mock import patch

import pytest

from agency.models import AgentInteraction, Task
from agency.services import record_interaction
from agency.tasks import execute_task, interrupt_task
from harness.pricing import estimate_cost, price_per_mtok
from harness.providers import ChatUsage, ResolvedCredential, chat_completion, track_usage
from tests.factories import AgentFactory, SectorFactory


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload
        self.is_success = True
        self.status_code = 200

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


def _anthropic_cred(monkeypatch, model="claude-sonnet-5"):
    monkeypatch.setattr(
        "harness.providers.get_credential",
        lambda tenant_id, provider: ResolvedCredential(
            provider, "k", "https://api.anthropic.test/v1", model
        ),
    )


# --- Preço por modelo -----------------------------------------------------------


def test_price_uses_longest_matching_prefix():
    assert price_per_mtok("anthropic", "claude-opus-5-5") == (Decimal("4"), Decimal("20"))
    assert price_per_mtok("anthropic", "claude-opus-5") == (Decimal("5"), Decimal("25"))
    assert price_per_mtok("anthropic", "claude-sonnet-5") == (Decimal("2"), Decimal("10"))
    assert price_per_mtok("ollama", "llama3") == (Decimal("0"), Decimal("0"))
    # 1M de entrada + 1M de saída no Sonnet 5 = 2 + 10
    assert estimate_cost("anthropic", "claude-sonnet-5", 1_000_000, 1_000_000) == Decimal("12")


def test_price_override_from_settings(settings):
    settings.AI_MODEL_PRICES = '{"groq:llama-3.3-70b": [0.59, 0.79], "groq": [0.1, 0.1]}'
    assert price_per_mtok("groq", "llama-3.3-70b-versatile") == (Decimal("0.59"), Decimal("0.79"))
    assert price_per_mtok("groq", "outro") == (Decimal("0.1"), Decimal("0.1"))


# --- Tokens reais + Claude sem temperature --------------------------------------


@pytest.mark.django_db
def test_anthropic_call_reports_real_tokens_and_omits_temperature(monkeypatch, tenant_id):
    _anthropic_cred(monkeypatch)
    sent = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        sent["body"] = json
        return _FakeResponse(
            {
                "content": [{"type": "text", "text": "oi"}],
                "stop_reason": "end_turn",
                "usage": {
                    "input_tokens": 1200,
                    "cache_read_input_tokens": 300,
                    "output_tokens": 80,
                },
            }
        )

    monkeypatch.setattr("harness.providers.httpx.post", fake_post)
    with track_usage() as outer:
        with track_usage() as inner:
            text = chat_completion(tenant_id, "anthropic", None, [{"role": "user", "content": "x"}])
    assert text == "oi"
    assert "temperature" not in sent["body"]  # Sonnet 5 recusa amostragem com 400
    assert inner == outer == [ChatUsage("anthropic", "claude-sonnet-5", 1500, 80)]


@pytest.mark.django_db
def test_older_claude_still_gets_temperature(monkeypatch, tenant_id):
    _anthropic_cred(monkeypatch, model="claude-haiku-4-5")
    sent = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        sent["body"] = json
        return _FakeResponse({"content": [{"type": "text", "text": "ok"}], "usage": {}})

    monkeypatch.setattr("harness.providers.httpx.post", fake_post)
    chat_completion(
        tenant_id, "anthropic", None, [{"role": "user", "content": "x"}], temperature=0.2
    )
    assert sent["body"]["temperature"] == 0.2


@pytest.mark.django_db
def test_record_interaction_prices_real_usage(tenant_id):
    agent = AgentFactory(tenant_id=tenant_id, sector=SectorFactory(tenant_id=tenant_id))
    usage = [
        ChatUsage("anthropic", "claude-sonnet-5", 500_000, 0),
        ChatUsage("anthropic", "claude-sonnet-5", 500_000, 100_000),
    ]
    i = record_interaction(agent, "q", "a", "anthropic", usage=usage)
    assert (i.tokens_used, i.tokens_estimated, i.model) == (1_100_000, False, "claude-sonnet-5")
    assert i.estimated_cost_usd == Decimal("3")  # 1M × $2 + 100k × $10

    guess = record_interaction(agent, "pergunta", "resposta", "groq")
    assert guess.tokens_estimated is True


@pytest.mark.django_db
def test_report_result_records_claude_code_cost(auth_client, tenant_id):
    agent = AgentFactory(tenant_id=tenant_id, sector=SectorFactory(tenant_id=tenant_id))
    task = Task.objects.create(tenant_id=tenant_id, agent=agent, brief="Refatorar X")
    auth_client.post(f"/api/v1/agency/tasks/{task.id}/start-external/")
    res = auth_client.post(
        f"/api/v1/agency/tasks/{task.id}/report-result/",
        {
            "success": True,
            "result": {"output": "feito", "runner": "claude-code"},
            "current_files": ["a.py"],
            "usage": {
                "provider": "anthropic",
                "model": "claude-code",
                "tokens_in": 9000,
                "tokens_out": 700,
                "cost_usd": "0.42",
            },
        },
        format="json",
    )
    assert res.status_code == 200, res.data
    i = AgentInteraction.objects.get(task=task)
    assert (i.provider, i.model, i.tokens_used, i.tokens_estimated) == (
        "anthropic",
        "claude-code",
        9700,
        False,
    )
    assert i.estimated_cost_usd == Decimal("0.42")


# --- execute_task x intervenção humana no meio -----------------------------------


@pytest.mark.django_db
def test_execute_task_does_not_overwrite_task_paused_mid_run(tenant_id, monkeypatch):
    monkeypatch.setattr("harness.providers.get_active_provider", lambda tenant_id: "groq")
    agent = AgentFactory(tenant_id=tenant_id, sector=SectorFactory(tenant_id=tenant_id))
    task = Task.objects.create(tenant_id=tenant_id, agent=agent, brief="Relatório longo")

    def slow_model(*args, **kwargs):
        # O CEO pausa enquanto o modelo ainda está respondendo
        interrupt_task(tenant_id, task.id, "Espera, foca só no Q3")
        return '{"output": "relatório completo", "needs_review": false}'

    with patch("harness.providers.chat_completion", side_effect=slow_model):
        execute_task(tenant_id, task.id)

    task.refresh_from_db()
    agent.refresh_from_db()
    assert task.status == Task.Status.PAUSED_CEO
    assert task.result == {}  # a pausa vale; o resultado velho não entra
    assert task.progress < 1.0
    assert agent.work_status == "paused"  # continua pausado, não "ocioso"
    assert AgentInteraction.objects.filter(task=task).count() == 1  # a chamada foi paga


@pytest.mark.django_db
def test_execute_task_still_completes_when_untouched(tenant_id, monkeypatch):
    monkeypatch.setattr("harness.providers.get_active_provider", lambda tenant_id: "groq")
    agent = AgentFactory(tenant_id=tenant_id, sector=SectorFactory(tenant_id=tenant_id))
    task = Task.objects.create(tenant_id=tenant_id, agent=agent, brief="Resumo")
    with patch(
        "harness.providers.chat_completion", return_value='{"output": "ok", "needs_review": false}'
    ):
        execute_task(tenant_id, task.id)
    task.refresh_from_db()
    assert (task.status, task.progress, task.result["output"]) == ("in_progress", 1.0, "ok")


# --- Configuração de IA pelo navegador (status + testar conexão) -----------------


@pytest.mark.django_db
def test_provider_status_and_test_endpoints(auth_client, tenant_id, settings, monkeypatch):
    from cryptography.fernet import Fernet

    from harness.models import AIProviderCredential

    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    for p in ("GROQ", "ANTHROPIC", "OPENAI", "OPENROUTER"):
        setattr(settings, f"{p}_API_KEY", "")
        setattr(settings, f"{p}_CHAT_MODEL", "")
    AIProviderCredential.objects.create(
        tenant_id=tenant_id,
        provider="anthropic",
        api_key="k",
        default_model="claude-sonnet-5",
        is_active=True,
    )
    res = auth_client.get("/api/v1/harness/providers/status/")
    rows = {r["provider"]: r for r in res.data["providers"]}
    assert rows["anthropic"] == {
        "provider": "anthropic",
        "ready": True,
        "detail": "",
        "source": "tenant",
        "default_model": "claude-sonnet-5",
    }
    assert rows["groq"]["ready"] is False and rows["groq"]["source"] is None

    def fake_post(url, headers=None, json=None, timeout=None):
        return _FakeResponse(
            {
                "content": [{"type": "text", "text": "ok"}],
                "usage": {"input_tokens": 12, "output_tokens": 1},
            }
        )

    monkeypatch.setattr("harness.providers.httpx.post", fake_post)
    ok = auth_client.post(
        "/api/v1/harness/providers/test/", {"provider": "anthropic"}, format="json"
    )
    assert (
        ok.data["ok"] is True and ok.data["reply"] == "ok" and ok.data["model"] == "claude-sonnet-5"
    )
    missing = auth_client.post(
        "/api/v1/harness/providers/test/", {"provider": "groq"}, format="json"
    )
    assert missing.data["ok"] is False and "groq" in missing.data["error"]
    assert (
        auth_client.post(
            "/api/v1/harness/providers/test/", {"provider": "x"}, format="json"
        ).status_code
        == 400
    )
