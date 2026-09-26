# backend_api/Api/tests/integration/test_knowledge_usage.py
"""
#10: links/trecho gravados na indexação + "quem consultou esta nota".
"""
import uuid

import pytest

from agency.models import AgentInteraction
from agency.services import ask_as_agent
from ingestion.models import Document, KnowledgeSource
from ingestion.services import index_document
from tests.factories import AgentFactory, SectorFactory


def _source(tenant_id):
    return KnowledgeSource.objects.create(tenant_id=tenant_id, name="Vault", source_type="obsidian")


@pytest.mark.django_db
def test_index_document_stores_links_and_excerpt(tenant_id, monkeypatch):
    monkeypatch.setattr(
        "ingestion.services.EmbeddingClient.embed", lambda self, text, tenant_id=None: [0.0] * 768
    )
    doc = Document.objects.create(
        tenant_id=tenant_id,
        source=_source(tenant_id),
        external_id="a.md",
        title="a",
        content="# A\nLiga [[b]] e [[c|apelido]].",
        metadata={"tags": ["x"]},
    )
    index_document(doc)
    doc.refresh_from_db()
    assert doc.metadata["links"] == ["b", "c"]
    assert doc.metadata["excerpt"].startswith("A Liga b e apelido")
    assert doc.metadata["tags"] == ["x"]  # não apaga o que já existia


@pytest.mark.django_db
def test_graph_uses_stored_links_without_content(auth_client, tenant_id):
    s = _source(tenant_id)
    # metadata diz que "a" liga pra "b", mas o conteúdo não tem link nenhum:
    # se o grafo usar metadata (sem ler content), a aresta existe.
    a = Document.objects.create(
        tenant_id=tenant_id,
        source=s,
        external_id="a.md",
        title="a",
        content="sem links",
        metadata={"links": ["b"], "excerpt": "trecho salvo"},
    )
    b = Document.objects.create(
        tenant_id=tenant_id, source=s, external_id="b.md", title="b", content="nota antiga [[a]]"
    )  # sem metadata: cai no conteúdo
    res = auth_client.get("/api/v1/ingestion/graph/")
    assert sorted(res.data["edges"]) == sorted([[a.id, b.id], [b.id, a.id]])
    assert next(n for n in res.data["nodes"] if n["id"] == a.id)["excerpt"] == "trecho salvo"


@pytest.mark.django_db
def test_ask_as_agent_records_consulted_documents(tenant_id, monkeypatch):
    monkeypatch.setattr(
        "orchestration.services.answer_question",
        lambda tenant_id, question, **kw: {
            "answer": "ok",
            "function_called": None,
            "status": "ok",
            "sources": [
                {"document": "a", "source": "Vault", "document_id": 7},
                {"document": "a", "source": "Vault", "document_id": 7},
                {"document": "b", "source": "Vault", "document_id": 3},
            ],
        },
    )
    agent = AgentFactory(
        tenant_id=tenant_id, sector=SectorFactory(tenant_id=tenant_id, name="Comercial")
    )
    ask_as_agent(tenant_id, agent.id, "pergunta")
    assert AgentInteraction.objects.get(agent=agent).source_document_ids == [3, 7]


@pytest.mark.django_db
def test_knowledge_usage_endpoint_counts_and_isolates_tenant(auth_client, tenant_id):
    sector = SectorFactory(tenant_id=tenant_id, name="Comercial")
    vendedor = AgentFactory(tenant_id=tenant_id, sector=sector, name="Vendedor")
    outro = AgentFactory(tenant_id=tenant_id, sector=sector, name="Outro")
    for ids in ([7, 9], [7], [9]):
        AgentInteraction.objects.create(
            tenant_id=tenant_id, agent=vendedor, question="q", source_document_ids=ids
        )
    AgentInteraction.objects.create(
        tenant_id=tenant_id, agent=outro, question="q", source_document_ids=[9]
    )
    # outro tenant consultando um documento com o mesmo id: nunca aparece
    other_tenant = uuid.uuid4()
    estranho = AgentFactory(
        tenant_id=other_tenant, sector=SectorFactory(tenant_id=other_tenant, name="X")
    )
    AgentInteraction.objects.create(
        tenant_id=other_tenant, agent=estranho, question="q", source_document_ids=[7]
    )

    res = auth_client.get("/api/v1/agency/knowledge-usage/", {"document": 7})
    assert res.status_code == 200
    assert [(r["agent_name"], r["count"]) for r in res.data] == [("Vendedor", 2)]
    assert auth_client.get("/api/v1/agency/knowledge-usage/", {"document": "x"}).status_code == 400
