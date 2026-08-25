# backend_api/Api/integrations/admin.py
from django import forms
from django.contrib import admin

from integrations.models import ServiceCredential


class ServiceCredentialForm(forms.ModelForm):
    tenant_id = forms.UUIDField(
        required=False, help_text="Deixe em branco para uma credencial GLOBAL (default do projeto).",
    )
    token_input = forms.CharField(
        label="Token", required=False, widget=forms.PasswordInput(render_value=False),
        help_text="Deixe em branco para manter o token atual.",
    )

    class Meta:
        model = ServiceCredential
        fields = ["provider", "label", "account_ref", "is_active"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk:
            self.fields["tenant_id"].initial = self.instance.tenant_id

    def save(self, commit=True):
        instance = super().save(commit=False)
        instance.tenant_id = self.cleaned_data.get("tenant_id") or None
        new_token = self.cleaned_data.get("token_input")
        if new_token:
            instance.token = new_token
        if commit:
            instance.save()
        return instance


@admin.register(ServiceCredential)
class ServiceCredentialAdmin(admin.ModelAdmin):
    form = ServiceCredentialForm
    list_display = ("provider", "label", "tenant_scope", "account_ref", "masked_token_display", "is_active")
    list_filter = ("provider", "is_active")

    @admin.display(description="Escopo")
    def tenant_scope(self, obj):
        return str(obj.tenant_id) if obj.tenant_id else "🌐 Global"

    @admin.display(description="Token")
    def masked_token_display(self, obj):
        return obj.masked_token
