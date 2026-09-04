# backend_api/Api/agency/consumers.py
"""
Um grupo Channels por tenant (`tenant_{uuid}`) — todo update de
Task/Agent daquele tenant chega pra qualquer cliente conectado, sem
polling. Ver `agency/realtime.py` para quem publica, `agency/ws_auth.py`
para como a conexão se autentica (JWT via query string, não header).
"""
from channels.generic.websocket import AsyncJsonWebsocketConsumer


class AgencyConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated or not getattr(user, "tenant_id", None):
            await self.close(code=4001)
            return

        self.group_name = f"tenant_{user.tenant_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    # Nome do método = "type" do group_send com "." trocado por "_"
    # (convenção do Channels) — ver agency/realtime.py.
    async def task_update(self, event):
        await self.send_json(event["data"])

    async def agent_update(self, event):
        await self.send_json(event["data"])

    async def pending_approval_update(self, event):
        await self.send_json(event["data"])