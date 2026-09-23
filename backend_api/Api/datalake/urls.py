from django.urls import path, include
from rest_framework.routers import DefaultRouter
from datalake.views import SyncEventViewSet, schema_catalog, obsidian_notes

router = DefaultRouter()
router.register("sync-events", SyncEventViewSet, basename="sync-event")

urlpatterns = [
    path("", include(router.urls)),
    path("schema/", schema_catalog, name="datalake-schema"),
    path("obsidian-notes/", obsidian_notes, name="datalake-obsidian-notes"),
]
