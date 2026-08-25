# backend_api/Api/harness/admin.py
from django import forms
from django.contrib import admin

from harness.models import AIProviderCredential


class AIProviderCredentialForm(forms.ModelForm):
    # tenant_id vem do TenantMixin com editable=False, então precisa ser
    # campo explícito do form (não pode entrar em Meta.fields).
    tenant_id = forms.UUIDField(
        required=False,
        help_text="Deixe em branco para uma credencial GLOBAL (default do projeto).",
    )
    # Campo de texto puro só para digitação — nunca fica exposto depois de salvo.
    api_key_input = forms.CharField(
        label="API key",
        required=False,
        widget=forms.PasswordInput(render_value=False),
        help_text="Deixe em branco para manter a chave atual. Não é necessária para Ollama local.",
    )

    class Meta:
        model = AIProviderCredential
        fields = [
            "provider", "label", "base_url",
            "default_model", "is_active",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk:
            self.fields["tenant_id"].initial = self.instance.tenant_id

    def save(self, commit=True):
        instance = super().save(commit=False)
        instance.tenant_id = self.cleaned_data.get("tenant_id") or None
        new_key = self.cleaned_data.get("api_key_input")
        if new_key:
            instance.api_key = new_key  # passa pela property -> criptografa
        if commit:
            instance.save()
        return instance


@admin.register(AIProviderCredential)
class AIProviderCredentialAdmin(admin.ModelAdmin):
    form = AIProviderCredentialForm
    list_display = (
        "provider", "label", "tenant_scope", "masked_key_display",
        "default_model", "is_active", "updated_at",
    )
    list_filter = ("provider", "is_active")
    search_fields = ("label",)

    @admin.display(description="Escopo")
    def tenant_scope(self, obj):
        return str(obj.tenant_id) if obj.tenant_id else "🌐 Global (todos os tenants)"

    @admin.display(description="API key")
    def masked_key_display(self, obj):
        return obj.masked_api_key
