from django.contrib import admin

from observabilidade.models import EstadoComponente, EventoErro, Incidente


@admin.register(Incidente)
class IncidenteAdmin(admin.ModelAdmin):
    list_display = ("titulo", "status", "gravidade", "aberto_em", "resolvido_em")
    list_filter = ("status", "gravidade", "grupo")


@admin.register(EstadoComponente)
class EstadoAdmin(admin.ModelAdmin):
    list_display = ("nome", "grupo", "status", "verificado_em")
    list_filter = ("status", "grupo")


@admin.register(EventoErro)
class EventoErroAdmin(admin.ModelAdmin):
    list_display = ("logger", "mensagem", "ocorrencias", "ultimo", "resolvido")
    list_filter = ("resolvido", "nivel")
