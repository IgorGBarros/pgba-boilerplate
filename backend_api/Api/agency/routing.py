# backend_api/Api/agency/routing.py
from django.urls import re_path

from agency.consumers import AgencyConsumer

websocket_urlpatterns = [
    re_path(r"^ws/agency/$", AgencyConsumer.as_asgi()),
]
