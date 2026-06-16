from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth import authenticate
from rest_framework.exceptions import AuthenticationFailed

from django.contrib.auth import get_user_model
from .models import CustomUser,Role

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        # Adiciona claims personalizados ao token
        token['email'] = user.email
        token['name'] = user.name
        token['is_staff'] = user.is_staff  # Adicione se necessário
        return token

    def validate(self, attrs):
        email = attrs.get("email")
        password = attrs.get("password")
        if not email or not password:
            raise AuthenticationFailed("Email e senha são obrigatórios")

        # Autenticação usando email como USERNAME_FIELD
        user = authenticate(
            request=self.context.get('request'),
            username=email,  # <-- Correção crucial: usa 'username' como parâmetro
            password=password
        )

        if not user:
            raise AuthenticationFailed("Conta inativa ou credenciais inválidas")
        
        if not user.is_active:
            raise AuthenticationFailed("Esta conta está desativada")

        # Adiciona o usuário ao contexto para o método get_token
        attrs['user'] = user
        return super().validate(attrs)
    

class CustomUserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)  # Oculta a senha na resposta

    class Meta:
        model = CustomUser
        fields = ['email', 'name', 'password']

    def create(self, validated_data):
        user = CustomUser.objects.create_user(
            email=validated_data['email'],
            password=validated_data['password'],
            name=validated_data['name']
        )
        return user


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ['id', 'name']

class UserSerializer(serializers.ModelSerializer):
    role = RoleSerializer()

    class Meta:
        model = CustomUser
        fields = ['id', 'email', 'name', 'role']
