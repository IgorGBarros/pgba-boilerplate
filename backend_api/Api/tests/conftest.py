# backend_api/Api/tests/conftest.py
"""
Fixtures compartilhadas por todos os testes (pytest-django). Ficavam
vazias desde o audit original do boilerplate — preenchidas com o mínimo
que qualquer teste de uma vertical precisa: um tenant e um usuário
autenticado, já que TODO model de negócio herda `TenantMixin`.
"""
import uuid

import pytest
from rest_framework.test import APIClient


@pytest.fixture
def tenant_id():
    """UUID de tenant novo a cada teste — isolamento entre testes também."""
    return uuid.uuid4()


@pytest.fixture
def user(db, tenant_id):
    from User.models import CustomUser

    return CustomUser.objects.create_user(
        email="teste@example.com",
        password="senha-forte-123",
        name="Usuário de Teste",
        tenant_id=tenant_id,
    )


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def auth_client(api_client, user):
    """Cliente DRF autenticado — para testar views com IsAuthenticated."""
    api_client.force_authenticate(user=user)
    return api_client
