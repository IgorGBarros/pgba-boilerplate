# backend_api/Api/tests/unit/test_user_model.py
"""
Migrado de `User/tests.py` (removido — o nome do módulo colidia com o
pacote `tests/` na coleta do pytest: `User/tests.py` e `tests/` disputavam
o mesmo nome de módulo top-level, e o pytest recusava coletar os dois).
Reescrito no estilo pytest (fixtures) para bater com o resto da suíte.
"""
import pytest

from User.models import CustomUser


@pytest.mark.django_db
def test_create_user():
    user = CustomUser.objects.create_user(email="test@exemplo.com", password="senha123", name="Teste")
    assert user.email == "test@exemplo.com"
    assert user.check_password("senha123")


@pytest.mark.django_db
def test_create_superuser():
    admin = CustomUser.objects.create_superuser(email="admin@exemplo.com", password="admin123", name="Admin")
    assert admin.is_staff
    assert admin.is_superuser
