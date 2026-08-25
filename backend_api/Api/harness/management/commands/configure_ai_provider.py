# backend_api/Api/harness/management/commands/configure_ai_provider.py
"""
Uso:
    # Credencial global (vale para todos os tenants que não têm a própria)
    python manage.py configure_ai_provider --provider groq --api-key gsk_... \
        --model openai/gpt-oss-20b

    # Credencial específica de um tenant
    python manage.py configure_ai_provider --provider openai --api-key sk-... \
        --tenant <uuid> --model gpt-4o-mini

    # Ollama local não precisa de api-key
    python manage.py configure_ai_provider --provider ollama --model llama3

Forma mais fácil de "plugar token e API key" sem precisar editar .env,
redeploy, ou tocar em código — e sem a chave passar em texto puro por
histórico de shell além deste comando pontual (fica criptografada no banco).
"""
from django.core.management.base import BaseCommand, CommandError

from harness.models import AIProviderCredential


class Command(BaseCommand):
    help = "Configura (cria ou atualiza) a credencial de um provedor de IA."

    def add_arguments(self, parser):
        parser.add_argument("--provider", required=True, choices=[c[0] for c in AIProviderCredential.Provider.choices])
        parser.add_argument("--api-key", default="", help="Não necessário para Ollama.")
        parser.add_argument("--base-url", default="", help="Sobrescreve a URL padrão do provedor.")
        parser.add_argument("--model", default="", help="Modelo padrão para este provedor.")
        parser.add_argument("--tenant", default=None, help="UUID do tenant (omitir = credencial global).")
        parser.add_argument("--label", default="")

    def handle(self, *args, **options):
        provider = options["provider"]
        if provider != "ollama" and not options["api_key"]:
            raise CommandError(f"--api-key é obrigatório para o provedor '{provider}'.")

        cred, created = AIProviderCredential.objects.get_or_create(
            tenant_id=options["tenant"],
            provider=provider,
            defaults={"label": options["label"]},
        )
        if options["api_key"]:
            cred.api_key = options["api_key"]
        if options["base_url"]:
            cred.base_url = options["base_url"]
        if options["model"]:
            cred.default_model = options["model"]
        if options["label"]:
            cred.label = options["label"]
        cred.is_active = True
        cred.save()

        scope = f"tenant={options['tenant']}" if options["tenant"] else "global"
        action = "Criada" if created else "Atualizada"
        self.stdout.write(self.style.SUCCESS(f"{action} credencial de '{provider}' ({scope})."))
