# backend_api/Api/integrations/signals.py
from django.dispatch import Signal

# Disparado quando um OutboundEmail sai de verdade (status "sent").
# Args: email (OutboundEmail). A vertical que criou o rascunho (ex.: compras,
# pela `origin`) reage — `integrations` não sabe o que é cotação ou pedido.
email_sent = Signal()
