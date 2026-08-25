# backend_api/Api/agency/apps.py
from django.apps import AppConfig


class AgencyConfig(AppConfig):
    """
    Agentes e Setores — modelo organizacional de uma "equipe de IA".

    Inspirado no conceito de escritório virtual (agentes por setor, um
    orquestrador por setor, hierarquia de comando), mas sem a
    visualização 3D — aqui é o modelo de dados + métricas reais de custo
    e uso, ligado ao `orchestration.QueryLog` (nunca dado mockado).

    Serve como exemplo de referência do "Padrão de Vertical" (CLAUDE.md,
    seção 7): um domínio de negócio construído em cima do core do
    boilerplate, sem tocar em nada fora desta pasta (+ uma extensão
    pontual em orchestration/models.py para linkar QueryLog a um Agent).
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "agency"
    verbose_name = "Agentes & Setores"
