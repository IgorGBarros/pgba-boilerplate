# backend_api/Api/tests/integration/test_agency_api.py
"""
Teste de integração de referência: bate num endpoint real via APIClient
e confirma o isolamento por tenant fim a fim — o princípio não-negociável
nº 1 do CLAUDE.md, testado de verdade, não só documentado.
"""
import uuid

import pytest

from tests.factories import SectorFactory


@pytest.mark.django_db
def test_agent_endpoint_requires_authentication(api_client):
    response = api_client.get("/api/v1/agency/agents/")
    assert response.status_code == 401


@pytest.mark.django_db
def test_sectors_endpoint_only_returns_own_tenant_data(auth_client, user):
    SectorFactory(name="Setor do meu tenant", tenant_id=user.tenant_id)
    SectorFactory(name="Setor de outro tenant", tenant_id=uuid.uuid4())

    response = auth_client.get("/api/v1/agency/sectors/")

    assert response.status_code == 200
    names = [s["name"] for s in response.data["results"]]
    assert "Setor do meu tenant" in names
    assert "Setor de outro tenant" not in names
