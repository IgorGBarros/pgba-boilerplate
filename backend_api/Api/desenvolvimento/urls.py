from django.urls import path, include
from rest_framework.routers import DefaultRouter
from desenvolvimento.views import SprintViewSet, SprintTaskViewSet, PullRequestViewSet, PipelineViewSet

router = DefaultRouter()
router.register("sprints", SprintViewSet, basename="sprint")
router.register("tasks", SprintTaskViewSet, basename="sprint-task")
router.register("pull-requests", PullRequestViewSet, basename="pull-request")
router.register("pipelines", PipelineViewSet, basename="pipeline")

urlpatterns = [path("", include(router.urls))]
