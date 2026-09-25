from rest_framework.routers import DefaultRouter
from scraping.views import ScrapingJobViewSet

router = DefaultRouter()
router.register(r"jobs", ScrapingJobViewSet, basename="scraping-job")

urlpatterns = router.urls
