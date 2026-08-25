# backend_api/Api/harness/serializers.py
from rest_framework import serializers


class GenerateCodeSerializer(serializers.Serializer):
    """
    Payload genérico de geração de código via LLM configurado no harness.
    Não é exclusivo de frontend — qualquer automação do projeto (o
    `frontend/scripts/generate-page.mjs`, um comando de management, uma
    task Celery) pode chamar este mesmo endpoint.
    """

    prompt = serializers.CharField(max_length=4000)
    system_prompt = serializers.CharField(max_length=4000, required=False, allow_blank=True)
    language = serializers.ChoiceField(
        choices=["tsx", "ts", "python", "json"], required=False, default="tsx"
    )
    # Permite reenviar código + erro de validação para o modelo corrigir
    # (etapa de autocorreção do loop de feedback) sem duplicar o prompt.
    previous_code = serializers.CharField(required=False, allow_blank=True)
    validation_error = serializers.CharField(required=False, allow_blank=True)

    def validate_prompt(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("prompt não pode ser vazio.")
        return value
