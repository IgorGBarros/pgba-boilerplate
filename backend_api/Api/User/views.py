from rest_framework_simplejwt.views import TokenObtainPairView,TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken
from .serializer import CustomTokenObtainPairSerializer, CustomUserSerializer
from .models import CustomUser, Plan

from rest_framework.permissions import AllowAny

from rest_framework.response import Response

from rest_framework.views import APIView

from django.contrib.auth import get_user_model

from django.shortcuts import render
from django.contrib.auth.decorators import login_required

from .permissions import IsAdminRole

from django.http import HttpResponse

from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes
from django.core.mail import send_mail
from django.conf import settings
from rest_framework import status, generics


from django.shortcuts import get_object_or_404

def health_check(request):
    return HttpResponse("OK")

# Create your views here.
class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer


class CustomUserCreateView(generics.CreateAPIView):
    queryset = CustomUser.objects.all()
    serializer_class = CustomUserSerializer
    permission_classes = [AllowAny]  # Permissão para qualquer usuário


User = get_user_model()


class FirebaseLoginView(APIView):
    def post(self, request, *args, **kwargs):
        firebase_token = request.data.get("firebase_token")
        
        if not firebase_token:
            return Response({"error": "Token do Firebase é obrigatório."}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            # Cria ou obtém o usuário usando o token do Firebase
            user = User.objects.create_user_with_firebase(firebase_token)
            print(f"Usuário autenticado com sucesso: {user.email}")  # Log da mensagem no console do Docker

            return Response({"message": "Usuário autenticado com sucesso.", "email": user.email})

        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)




class AdminOnlyView(APIView):
    permission_classes = [IsAdminRole]

    def get(self, request):
        return Response({"message": "Você é um Administrador!"})



@login_required
def upgrade_plan(request):
    plans = Plan.objects.all().order_by('-is_free')  # gratuitos primeiro
    return render(request, 'users/upgrade_plan.html', {'plans': plans})


# views.py (adicione no final)



class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    
    def post(self, request):
        email = request.data.get("email")
        if not email:
            return Response(
                {"error": "Email é obrigatório"}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            user = CustomUser.objects.get(email=email)
            # Gera token seguro
            token = default_token_generator.make_token(user)
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            
            # Cria link de redefinição
            reset_link = f"{settings.FRONTEND_URL}/reset-password/{uid}/{token}"
            
            # Envia e-mail (será impresso no console)
            send_mail(
                subject="Redefinição de senha",
                message=f"Use este link para redefinir sua senha: {reset_link}",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email],
                fail_silently=False,
            )
            return Response({"message": "E-mail de recuperação enviado com sucesso."})
        except CustomUser.DoesNotExist:
            # Não revela se o e-mail existe (segurança)
            return Response({"message": "E-mail de recuperação enviado com sucesso."})


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    
    def post(self, request, uidb64, token):
        try:
            # Decodifica o UID
            uid = urlsafe_base64_decode(uidb64).decode()
            user = CustomUser.objects.get(pk=uid)
            
            # Verifica token
            if not default_token_generator.check_token(user, token):
                return Response(
                    {"error": "Token inválido ou expirado"}, 
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Atualiza senha
            new_password = request.data.get("password")
            if not new_password:
                return Response(
                    {"error": "Nova senha é obrigatória"}, 
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            user.set_password(new_password)
            user.save()
            
            return Response({"message": "Senha redefinida com sucesso!"})
        except (TypeError, ValueError, OverflowError, CustomUser.DoesNotExist):
            return Response(
                {"error": "Link inválido"}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        


from rest_framework.decorators import api_view, permission_classes
from .permissions import IsProUser, IsAdmin

@api_view(['GET'])
@permission_classes([IsProUser])
def pro_feature(request):
    return Response({"message": "Acesso permitido para usuários Pro!"})

@api_view(['POST'])
@permission_classes([IsAdmin])
def create_team(request):
    # Lógica para criar time
    pass