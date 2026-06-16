# admin.py
from django.contrib import admin
from .models import CustomUser, Plan, Role, SubscriptionPlan, Subscription,UserAnalytics
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

@admin.register(CustomUser)
class CustomUserAdmin(BaseUserAdmin):
    list_display = ('email', 'name', 'role', 'plan', 'is_staff', 'is_active')
    list_filter = ('role', 'plan', 'is_staff', 'is_superuser', 'is_active')
    search_fields = ('email', 'name')
    ordering = ('email',)

    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Informações pessoais', {'fields': ('name', 'role', 'plan')}),
        ('Permissões', {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Datas importantes', {'fields': ('last_login',)}),
    )

    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('email', 'name', 'password1', 'password2', 'role', 'plan', 'is_active', 'is_staff', 'is_superuser')}
        ),
    )

# Registrar os outros modelos
admin.site.register(Plan)
admin.site.register(Role)
admin.site.register(SubscriptionPlan)
admin.site.register(Subscription)
admin.site.register(UserAnalytics)
