# backend_api/Api/User/urls.py
"""
NOTA DE AUDITORIA: os paths aqui eram prefixados com "api/" (ex:
'api/token/', 'api/users/') mas este arquivo é incluído em config/urls.py
sob o prefixo 'api/v1/users/' — o resultado real seria
'/api/v1/users/api/token/', duplicado e não bate com o que estava
documentado em docs/API.md. Corrigido: paths relativos, sem repetir
"api/".
"""
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    CustomTokenObtainPairView,
    CustomUserCreateView,
    FirebaseLoginView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    health_check,
)

urlpatterns = [
    path('', CustomUserCreateView.as_view(), name='create-user'),
    path('token/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('firebase-login/', FirebaseLoginView.as_view(), name='firebase-login'),
    path('health/', health_check, name='user_health_check'),
    path('password-reset/', PasswordResetRequestView.as_view(), name='password_reset_request'),
    path('password-reset-confirm/<uidb64>/<token>/', PasswordResetConfirmView.as_view(), name='password_reset_confirm'),
]
