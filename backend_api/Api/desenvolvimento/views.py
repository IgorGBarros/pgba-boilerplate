from rest_framework import viewsets, filters
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from core.mixins import TenantContextMixin
from agency.views import TenantScopedMixin
from desenvolvimento.models import Sprint, SprintTask, PullRequest, Pipeline
from desenvolvimento.serializers import (
    SprintSerializer, SprintTaskSerializer, PullRequestSerializer, PipelineSerializer
)


class SprintViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Sprint.objects.prefetch_related("tasks").all()
    serializer_class = SprintSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["numero", "data_inicio"]


class SprintTaskViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = SprintTask.objects.select_related("sprint").all()
    serializer_class = SprintTaskSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["sprint", "status", "tipo", "prioridade"]
    search_fields = ["titulo", "responsavel"]
    ordering_fields = ["created_at", "pontos", "prioridade"]


class PullRequestViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = PullRequest.objects.all()
    serializer_class = PullRequestSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "conflitos"]
    search_fields = ["titulo", "autor", "branch"]
    ordering_fields = ["numero", "data_criacao"]


class PipelineViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Pipeline.objects.all()
    serializer_class = PipelineSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "branch"]
    search_fields = ["nome", "autor", "commit_sha"]
    ordering_fields = ["executado_em"]
