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
from harness.serializers import GenerateCodeSerializer

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
      "validation_error": "TS2322..."  # opcional, etapa de autocorreção
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

        provider = getattr(settings, "CHAT_PROVIDER", "ollama")
        model = getattr(settings, "OLLAMA_CHAT_MODEL", "llama3")

        try:
            raw = chat_completion(
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
