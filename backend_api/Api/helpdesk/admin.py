from django.contrib import admin

from helpdesk.models import EquipamentoTI, InteracaoChamado, Ticket


class InteracaoInline(admin.TabularInline):
    model = InteracaoChamado
    extra = 0
    fields = ("tipo", "autor", "texto", "created_at")
    readonly_fields = fields


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ("id", "titulo", "prioridade", "status", "atendente", "origem", "created_at")
    list_filter = ("status", "prioridade", "categoria", "origem")
    search_fields = ("titulo", "solicitante")
    inlines = [InteracaoInline]


@admin.register(EquipamentoTI)
class EquipamentoTIAdmin(admin.ModelAdmin):
    list_display = ("codigo", "nome", "tipo", "status", "usuario")
