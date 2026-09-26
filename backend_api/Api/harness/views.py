# backend_api/Api/harness/views.py
"""
Endpoint de geração de código via LLM — a ponte que qualquer automação
(o script `frontend/scripts/generate-page.mjs`, um agente, um comando de
management) usa para pedir código gerado, SEM duplicar lógica de chamada
a provedor de IA fora do `harness`.

Isto conserta duas coisas que existiam soltas num gerador de frontend
irmão deste projeto (create-ia-frontend): (1) a chamada ao provedor de
IA era hardcoded (Ollama + um modelo fixo, sem opção de trocar sem editar
código) — aqui vem de `harness.providers`, então herda tudo que já existe
(resolução de credencial por tenant, OpenRouter/Kimi K2, etc); (2) o
código gerado era escrito em disco sem NENHUMA validação — aqui o
endpoint aceita `previous_code` + `validation_error` para dar uma segunda
(ou terceira) chance ao modelo corrigir o próprio código, mas quem decide
quando parar de tentar é sempre o chamador (o script Node roda o
typecheck de verdade — o Django não tem como validar TSX).
"""
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from django.conf import settings

from core.mixins import TenantContextMixin
from harness.guardrails import extract_code_block
from harness.providers import chat_completion, ProviderConfigError
from harness.serializers import GenerateCodeSerializer, AIProviderCredentialSerializer

_PROVIDER_PRIORITY = ["openrouter", "groq", "openai", "anthropic", "ollama"]


def _resolve_chat_provider(tenant_id) -> str:
    """
    Escolhe o provider de chat para este tenant. Ordem:
    1. Credencial ativa no banco para este tenant (respeitando _PROVIDER_PRIORITY)
    2. Credencial ativa global (tenant_id nulo, mesma prioridade)
    3. settings.CHAT_PROVIDER (fallback global)
    """
    from harness.models import AIProviderCredential

    priority_map = {p: i for i, p in enumerate(_PROVIDER_PRIORITY)}

    tenant_creds = list(
        AIProviderCredential.objects.filter(tenant_id=tenant_id, is_active=True)
    )
    if tenant_creds:
        return min(tenant_creds, key=lambda c: priority_map.get(c.provider, 99)).provider

    global_creds = list(
        AIProviderCredential.objects.filter(tenant_id__isnull=True, is_active=True)
    )
    if global_creds:
        return min(global_creds, key=lambda c: priority_map.get(c.provider, 99)).provider

    return getattr(settings, "CHAT_PROVIDER", "ollama")


DEFAULT_SYSTEM_PROMPT = (
    "Você é um especialista em React + TypeScript + TailwindCSS trabalhando "
    "no frontend do PGBA Boilerplate. Gere APENAS o código completo do "
    "arquivo pedido, sem explicação antes ou depois. Regras obrigatórias: "
    "use React.FC com export default; estilize exclusivamente com classes "
    "Tailwind usando os tokens já definidos (brand.*, surface.*, "
    "font-display, font-body) — nunca cores hexadecimais soltas; se o "
    "componente falar com a API, importe de '@/lib/api' — nunca use fetch "
    "direto; sempre trate estado de loading e erro.\n\n"
    "Regras de performance (adaptadas das react-best-practices da Vercel "
    "para um SPA Vite — sem Next.js/RSC, então ignore qualquer regra de "
    "Server Component/Server Action):\n"
    "- Nunca dispare requisições em cascata: se duas chamadas são "
    "independentes, use Promise.all(), nunca await uma antes de iniciar a outra.\n"
    "- Nunca derive estado com useEffect quando dá pra calcular direto no "
    "render (ex: nada de `useEffect(() => setX(a+b), [a,b])`).\n"
    "- setState dentro de callback deve ser a forma funcional "
    "(`setX(prev => ...)`), nunca capturar o valor antigo do estado.\n"
    "- Valor inicial caro de useState deve vir de uma função "
    "(`useState(() => caro())`), nunca ser calculado toda renderização.\n"
    "- Prefira o operador ternário a `&&` para renderização condicional "
    "quando o lado falso puder ser 0/NaN (evita renderizar '0' na tela).\n"
    "- Componente pesado renderizado condicionalmente: use import() dinâmico "
    "(`React.lazy`), nunca importe estático se só é usado às vezes.\n"
    "- Saia cedo de funções (early return) em vez de aninhar if/else fundo.\n\n"
    "Retorne o código dentro de um bloco ```tsx."
)


class GenerateCodeView(TenantContextMixin, APIView):
    """
    POST /api/v1/harness/generate/

    {
      "prompt": "um card de boas-vindas com botão verde",
      "language": "tsx",
      "previous_code": "...",          # opcional, etapa de autocorreção
      "validation_error": "TS2322...", # opcional, etapa de autocorreção
      "provider": "anthropic",         # opcional: fixa o provedor (padrão: o do tenant)
      "model": "..."                   # opcional
    }

    Resposta: {"code": "...", "language": "tsx"}
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)

        serializer = GenerateCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user_prompt = data["prompt"]
        if data.get("previous_code") and data.get("validation_error"):
            # Etapa de autocorreção do loop de feedback: manda o código que
            # falhou + o erro de validação real (typecheck/lint/build),
            # nunca só "tente de novo" sem contexto do que deu errado.
            user_prompt = (
                f"O código abaixo foi gerado para o pedido: \"{data['prompt']}\"\n\n"
                f"CÓDIGO ATUAL:\n{data['previous_code']}\n\n"
                f"ERRO DE VALIDAÇÃO (typecheck/lint/build):\n{data['validation_error']}\n\n"
                "Corrija o código para resolver esse erro especificamente, "
                "mantendo o resto do comportamento pedido. Retorne o arquivo "
                "completo corrigido, não só o trecho alterado."
            )

        provider = data.get("provider") or _resolve_chat_provider(request.tenant_id)
        model = data.get("model") or None

        try:
            raw = chat_completion(
                # model=None -> resolve por get_credential().default_model
                request.tenant_id, provider, model,
                messages=[
                    {"role": "system", "content": data.get("system_prompt") or DEFAULT_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
            )
            code = extract_code_block(raw, language=data["language"])
        except ProviderConfigError as exc:
            return Response({"detail": f"Falha ao consultar o modelo: {exc}"}, status=502)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=502)

        return Response({"code": code, "language": data["language"]})


class AIProviderCredentialListCreateView(TenantContextMixin, APIView):
    """
    GET  /api/v1/harness/providers/        — lista credenciais do tenant (chave mascarada)
    POST /api/v1/harness/providers/        — cria ou substitui credencial ativa

    Um tenant só tem 1 credencial ativa por provedor (UniqueConstraint no model).
    POST desativa a anterior do mesmo provider antes de criar a nova para evitar
    violar esse constraint sem precisar de upsert manual.
    """

    permission_classes = [IsAuthenticated]

    def _qs(self, tenant_id):
        from harness.models import AIProviderCredential
        return AIProviderCredential.objects.filter(tenant_id=tenant_id).order_by("provider", "-updated_at")

    def get(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)
        qs = self._qs(request.tenant_id)
        data = AIProviderCredentialSerializer(qs, many=True).data
        return Response(data)

    def post(self, request):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)

        ser = AIProviderCredentialSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        from harness.models import AIProviderCredential

        # Desativa a credencial anterior do mesmo provider para não violar o
        # UniqueConstraint(is_active=True, tenant_id, provider).
        AIProviderCredential.objects.filter(
            tenant_id=request.tenant_id, provider=d["provider"], is_active=True
        ).update(is_active=False)

        cred = AIProviderCredential(
            tenant_id=request.tenant_id,
            provider=d["provider"],
            label=d.get("label", ""),
            base_url=d.get("base_url", ""),
            default_model=d.get("default_model", ""),
            is_active=d.get("is_active", True),
        )
        if d.get("api_key"):
            cred.api_key = d["api_key"]
        cred.save()

        return Response(AIProviderCredentialSerializer(cred).data, status=201)


class AIProviderCredentialDetailView(TenantContextMixin, APIView):
    """
    DELETE /api/v1/harness/providers/{id}/  — desativa (soft-delete) a credencial
    PATCH  /api/v1/harness/providers/{id}/  — atualiza campos sem recriar
    """

    permission_classes = [IsAuthenticated]

    def _get_cred(self, request, pk):
        from harness.models import AIProviderCredential
        try:
            return AIProviderCredential.objects.get(pk=pk, tenant_id=request.tenant_id)
        except AIProviderCredential.DoesNotExist:
            return None

    def delete(self, request, pk):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)
        cred = self._get_cred(request, pk)
        if not cred:
            return Response({"detail": "Não encontrada."}, status=404)
        cred.is_active = False
        cred.save(update_fields=["is_active", "updated_at"])
        return Response(status=204)

    def patch(self, request, pk):
        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)
        cred = self._get_cred(request, pk)
        if not cred:
            return Response({"detail": "Não encontrada."}, status=404)

        ser = AIProviderCredentialSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        for field in ("label", "base_url", "default_model", "is_active"):
            if field in d:
                setattr(cred, field, d[field])
        if d.get("api_key"):
            cred.api_key = d["api_key"]
        cred.save()
        return Response(AIProviderCredentialSerializer(cred).data)


class AIProviderStatusView(TenantContextMixin, APIView):
    """
    GET /api/v1/harness/providers/status/ — para cada provedor: se está pronto
    (credencial + modelo, `provider_readiness`, sem chamar o provedor), de
    onde vem a chave (tenant/global/env) e o modelo padrão.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from harness.models import AIProviderCredential
        from harness.providers import (
            credential_source, get_active_provider, provider_readiness, resolve_model,
        )

        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)
        rows = []
        for provider in AIProviderCredential.Provider.values:
            problem = provider_readiness(request.tenant_id, provider)
            try:
                model = resolve_model(request.tenant_id, provider, None) if problem is None else ""
            except ProviderConfigError:
                model = ""
            rows.append({
                "provider": provider,
                "ready": problem is None,
                "detail": problem or "",
                "source": credential_source(request.tenant_id, provider),
                "default_model": model,
            })
        active = get_active_provider(request.tenant_id)
        return Response({"active_provider": active, "providers": rows})


class AIProviderTestView(TenantContextMixin, APIView):
    """
    POST /api/v1/harness/providers/test/ {"provider": "...", "model"?: "..."} —
    faz UMA chamada curta de verdade ("responda só: ok") pra confirmar que a
    chave e o modelo funcionam. Custa alguns tokens; devolve latência, modelo
    e tokens, ou o erro do provedor.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        import time

        from harness.models import AIProviderCredential
        from harness.providers import chat_completion_with_usage, resolve_model

        if not getattr(request, "tenant_id", None):
            return Response({"detail": "Acesso requer tenant válido"}, status=403)
        provider = request.data.get("provider")
        if provider not in AIProviderCredential.Provider.values:
            return Response({"detail": "Provedor desconhecido."}, status=400)
        model = (request.data.get("model") or "").strip() or None
        start = time.monotonic()
        try:
            resolved = resolve_model(request.tenant_id, provider, model)
            reply, tokens_in, tokens_out = chat_completion_with_usage(
                request.tenant_id, provider, resolved,
                messages=[{"role": "user", "content": "Teste de conexão. Responda apenas: ok"}],
                temperature=0, timeout=30,
            )
        except ProviderConfigError as exc:
            return Response({"ok": False, "error": str(exc)})
        return Response({
            "ok": True,
            "model": resolved,
            "reply": reply[:80],
            "latency_ms": int((time.monotonic() - start) * 1000),
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
        })
