# tests/test_models.py
from django.test import TestCase
from .models import CustomUser

class UserModelTest(TestCase):
    def test_create_user(self):
        user = CustomUser.objects.create_user(email="test@exemplo.com", password="senha123")
        self.assertEqual(user.email, "test@exemplo.com")
        self.assertTrue(user.check_password("senha123"))

    def test_create_superuser(self):
        admin = CustomUser.objects.create_superuser(email="admin@exemplo.com", password="admin123")
        self.assertTrue(admin.is_staff)
        self.assertTrue(admin.is_superuser)