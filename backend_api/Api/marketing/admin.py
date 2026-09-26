from django.contrib import admin

from marketing.models import ContaSocial, JobVideo, Midia, PerfilMarca, Publicacao


@admin.register(PerfilMarca)
class PerfilMarcaAdmin(admin.ModelAdmin):
    list_display = ("nome", "ramo", "tenant_id")


@admin.register(ContaSocial)
class ContaSocialAdmin(admin.ModelAdmin):
    list_display = ("rede", "nome", "status", "tenant_id")
    list_filter = ("rede", "status")
    exclude = ("_token", "_refresh")  # segredo nunca aparece no admin


@admin.register(Publicacao)
class PublicacaoAdmin(admin.ModelAdmin):
    list_display = ("titulo", "status", "agendada_para", "tenant_id")
    list_filter = ("status", "formato")


@admin.register(Midia)
class MidiaAdmin(admin.ModelAdmin):
    list_display = ("titulo", "tipo", "origem", "formato", "tenant_id")


@admin.register(JobVideo)
class JobVideoAdmin(admin.ModelAdmin):
    list_display = ("titulo", "tipo", "status", "progresso", "tenant_id")
