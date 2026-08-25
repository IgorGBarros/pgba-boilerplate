# backend_api/Api/tests/unit/test_user_factory.py
"""
Prova de que `conftest.py`/`factories.py` funcionam de verdade — as
pastas tests/unit e tests/integration existiam só com __init__.py vazio
antes desta revisão, sem nenhum teste real.
"""
import pytest

from tests.factories import UserFactory


@pytest.mark.django_db
def test_user_factory_creates_user_with_tenant():
    user = UserFactory()

    assert user.pk is not None
    assert user.tenant_id is not None
    assert user.check_password("senha-forte-123")


@pytest.mark.django_db
def test_user_fixture_has_usable_tenant(user, tenant_id):
    assert user.tenant_id == tenant_id
