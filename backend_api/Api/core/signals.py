# backend_api/Api/core/signals.py
"""
Sinais de observabilidade emitidos pelas camadas de base, sem saber quem ouve.

- `chamada_ia`: toda chamada de chat a um provedor de IA (harness.providers).
- `saida_http`: toda saída de rede dos conectores, MCP, redes sociais e
  integrações (ingestion.connectors.safe_http).

Quem mede (app `observabilidade`) se conecta a eles — o harness e o safe_http
não dependem de quem mede. Um receptor que falha nunca derruba a chamada
original (`send_robust`).
"""
from django.dispatch import Signal

# kwargs: tenant_id, provider, model, ok (bool), ms (int), erro (str)
chamada_ia = Signal()

# kwargs: host, method, status (int | None), ms (int), erro (str)
saida_http = Signal()
