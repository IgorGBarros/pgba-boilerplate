# backend_api/Api/harness/serializers.py
import re

from rest_framework import serializers

from harness.models import AIProviderCredential

# Remove bytes de controle C0 (0x00-0x1F, exceto \t \n \r) e o DEL (0x7F).
# Existe por causa de um caso real: um modelo local pequeno (ex: llama3
# genérico, não especializado em código) às vezes produz saída com
# caracteres de controle quando "sai dos trilhos" tentando gerar TSX. Se
# isso entra em `previous_code`/`validation_error` no reenvio da etapa de
# autocorreção, o \x00 chega cru no corpo JSON — e o parser do Ollama (Go)
# rejeita com "invalid character '\x00' looking for beginning of value".
# json.dumps do Python escaparia certo um \x00 dentro de uma string, mas
# é mais seguro nunca deixar o caractere chegar até lá.
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def strip_control_chars(value: str) -> str:
    return _CONTROL_CHARS_RE.sub("", value or "")


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
    # Opcionais: fixa o provedor/modelo desta geração (ex: o agente que vai
    # gerar a página é do setor Desenvolvimento, que usa Claude). Sem eles,
    # vale o provedor ativo do tenant, como sempre.
    provider = serializers.ChoiceField(
        choices=AIProviderCredential.Provider.values, required=False,
    )
    model = serializers.CharField(max_length=100, required=False, allow_blank=True)

    def validate_prompt(self, value):
        value = strip_control_chars(value).strip()
        if not value:
            raise serializers.ValidationError("prompt não pode ser vazio.")
        return value

    def validate_system_prompt(self, value):
        return strip_control_chars(value)

    def validate_previous_code(self, value):
        return strip_control_chars(value)

    def validate_validation_error(self, value):
        return strip_control_chars(value)


class AIProviderCredentialSerializer(serializers.Serializer):
    """Leitura/escrita de credencial de provedor de IA pelo painel de configuração."""

    PROVIDERS = ["ollama", "openai", "anthropic", "groq", "openrouter"]

    id = serializers.IntegerField(read_only=True)
    provider = serializers.ChoiceField(choices=PROVIDERS)
    label = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    base_url = serializers.URLField(required=False, allow_blank=True, default="")
    # Ao ler: sempre mascarado. Ao escrever: texto puro (armazenado criptografado).
    api_key = serializers.CharField(required=False, allow_blank=True, default="", write_only=True)
    api_key_masked = serializers.SerializerMethodField(read_only=True)
    default_model = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    is_active = serializers.BooleanField(default=True)
    updated_at = serializers.DateTimeField(read_only=True)

    def get_api_key_masked(self, obj) -> str:
        return obj.masked_api_key
