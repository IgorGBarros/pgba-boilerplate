# backend_api/Api/tests/integration/test_ingestion_graph_api.py
"""GET /api/v1/ingestion/graph/ — isolamento por tenant e soft delete."""
import uuid

import pytest

from ingestion.models import Document, KnowledgeSource

URL = "/api/v1/ingestion/graph/"


def _source(tenant_id, name="Vault"):
    return KnowledgeSource.objects.create(
        tenant_id=tenant_id, name=name, source_type=KnowledgeSource.SourceType.OBSIDIAN,
        config={"vault_path": "/vaults/x"},
    )


def _doc(source, path, content=""):
    return Document.objects.create(
        tenant_id=source.tenant_id, source=source, external_id=path,
        title=path.removesuffix(".md"), content=content,
    )


@pytest.mark.django_db
def test_graph_never_leaks_other_tenant(auth_client, tenant_id):
    mine = _source(tenant_id)
    a = _doc(mine, "a.md", "liga [[b]] e [[segredo]]")
    b = _doc(mine, "b.md")
    other = _source(uuid.uuid4(), name="Outro cliente")
    _doc(other, "segredo.md", "dado de outro tenant")

    res = auth_client.get(URL)

    assert res.status_code == 200
    ids = {n["id"] for n in res.data["nodes"]}
    assert ids == {a.id, b.id}
    assert res.data["edges"] == [[a.id, b.id]]
    # o link pra nota do outro tenant NÃO é resolvido — conta como não resolvido
    assert res.data["unresolved"] == 1


@pytest.mark.django_db
def test_graph_excludes_soft_deleted_and_filters_by_source(auth_client, tenant_id):
    s1, s2 = _source(tenant_id, "Vault 1"), _source(tenant_id, "Vault 2")
    keep = _doc(s1, "keep.md")
    gone = _doc(s1, "gone.md")
    gone.delete()  # soft delete
    other = _doc(s2, "other.md")

    all_ids = {n["id"] for n in auth_client.get(URL).data["nodes"]}
    assert all_ids == {keep.id, other.id}

    only_s1 = auth_client.get(URL, {"source": s1.id}).data["nodes"]
    assert [n["id"] for n in only_s1] == [keep.id]
    assert auth_client.get(URL, {"source": "x"}).status_code == 400


@pytest.mark.django_db
def test_graph_requires_authentication(api_client):
    assert api_client.get(URL).status_code in (401, 403)
