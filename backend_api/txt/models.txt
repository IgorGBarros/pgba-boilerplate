from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.utils import timezone
# Create your models here.
from firebase_admin import auth
import firebase_admin

from django.conf import settings

class Plan(models.Model):
    name = models.CharField(max_length=50)
    description = models.TextField(blank=True)
    is_free = models.BooleanField(default=False)
    max_projects = models.IntegerField(default=1)
    max_users = models.IntegerField(default=1)
    max_storage_mb = models.IntegerField(default=100)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Role(models.Model):
    name = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.name

class CustomUserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("O usuário deve ter um email")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        if password:  # Certifique-se de que a senha foi fornecida
            user.set_password(password)
        else:
            user.set_unusable_password()  # Define uma senha inutilizável
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
    
        if extra_fields.get('is_staff') is not True:
            raise ValueError("Superuser deve ter is_staff=True.")
        if extra_fields.get('is_superuser') is not True:
            raise ValueError("Superuser deve ter is_superuser=True.")

        return self.create_user(email, password, **extra_fields)
    
    def create_user_with_firebase(self, firebase_token, **extra_fields):
        try:
            # Verifica o token do Firebase e obtém informações do usuário
            decoded_token = auth.verify_id_token(firebase_token)
            email = decoded_token.get('email')
            uid = decoded_token.get('uid')

            # Verifica se o usuário já existe no banco de dados
            user, created = self.get_or_create(email=email, defaults={'name': uid, **extra_fields})

            if created:
                user.set_unusable_password()  # Define uma senha inutilizável, pois o login é gerenciado pelo Firebase
                user.save(using=self._db)

            return user

        except Exception as e:
            raise ValueError("Erro ao verificar o token do Firebase ou ao criar usuário:", e)

class CustomUser(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    is_superuser = models.BooleanField(default=False)

    
    plan = models.ForeignKey(Plan, on_delete=models.SET_NULL, null=True, blank=True)
    role = models.ForeignKey('User.Role', on_delete=models.SET_NULL, null=True, blank=True)
    objects = CustomUserManager()
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['name']

    def __str__(self):
        return self.email
    

class SubscriptionPlan(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=8, decimal_places=2)
    stripe_price_id = models.CharField(max_length=255, blank=True, null=True)  # usado na integração com Stripe
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Subscription(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.SET_NULL, null=True)
    valid_until = models.DateTimeField()
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.user.email} - {self.plan.name}"


# models.py

    