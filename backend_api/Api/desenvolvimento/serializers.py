from django.db.models import Sum
from rest_framework import serializers
from desenvolvimento.models import Sprint, SprintTask, PullRequest, Pipeline


class SprintSerializer(serializers.ModelSerializer):
    pontos_concluidos = serializers.SerializerMethodField()
    pontos_totais = serializers.SerializerMethodField()

    class Meta:
        model = Sprint
        fields = [
            "id", "nome", "numero", "data_inicio", "data_fim", "status",
            "velocidade_planejada", "pontos_concluidos", "pontos_totais", "created_at",
        ]
        read_only_fields = ["id", "pontos_concluidos", "pontos_totais", "created_at"]

    def get_pontos_concluidos(self, obj):
        return obj.tasks.filter(status="done").aggregate(total=Sum("pontos"))["total"] or 0

    def get_pontos_totais(self, obj):
        return obj.tasks.aggregate(total=Sum("pontos"))["total"] or 0


class SprintTaskSerializer(serializers.ModelSerializer):
    sprint_nome = serializers.CharField(source="sprint.nome", read_only=True)

    class Meta:
        model = SprintTask
        fields = [
            "id", "sprint", "sprint_nome", "titulo", "tipo", "pontos",
            "responsavel", "status", "prioridade", "descricao", "created_at",
        ]
        read_only_fields = ["id", "sprint_nome", "created_at"]


class PullRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = PullRequest
        fields = [
            "id", "numero", "titulo", "autor", "branch", "status",
            "revisoes", "conflitos", "data_criacao", "merged_em", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class PipelineSerializer(serializers.ModelSerializer):
    class Meta:
        model = Pipeline
        fields = [
            "id", "nome", "status", "branch", "duracao", "commit_sha",
            "autor", "executado_em", "created_at",
        ]
        read_only_fields = ["id", "created_at"]
