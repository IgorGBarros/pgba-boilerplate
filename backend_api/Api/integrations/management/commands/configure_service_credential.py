# backend_api/Api/integrations/management/commands/configure_service_credential.py
"""
Uso:
    # Conta PESSOAL do GitHub (mais comum): não passe --account-ref.
    # O token já identifica o dono — GitHub cria em /user/repos.
    python manage.py configure_service_credential --provider github --token ghp_...

    # Organização de verdade do GitHub (não confundir com usuário pessoal —
    # ver nota abaixo):
    python manage.py configure_service_credential --provider github \
        --token ghp_... --account-ref minha-organizacao

    python manage.py configure_service_credential --provider supabase \
        --token sbp_... --account-ref https://xxxx.supabase.co

    # Limpar um account_ref configurado por engano (ex: usou seu usuário
    # pessoal onde deveria ficar vazio):
    python manage.py configure_service_credential --provider github --token ghp_... --clear-account-ref

NOTA IMPORTANTE (causa real de um bug de produção): a API do GitHub trata
"organização" e "usuário pessoal" como duas coisas diferentes — repositório
de organização vai em POST /orgs/{org}/repos, repositório pessoal vai em
POST /user/repos (sem nome nenhum, o token já identifica o dono). Se você
configurar `account_ref` com o seu USUÁRIO pessoal (ex: sua própria conta,
não uma Organization de verdade), `integrations.github.create_repository()`
tenta usar a rota de organização e o GitHub responde 404 Not Found — erro
confuso que não deixa óbvio a causa. Deixe `account_ref` vazio a menos que
você realmente tenha uma GitHub Organization.
"""
from django.core.management.base import BaseCommand, CommandError

from integrations.models import ServiceCredential


class Command(BaseCommand):
    help = "Configura (cria ou atualiza) a credencial de um serviço externo (GitHub, Vercel, Render, Supabase)."

    def add_arguments(self, parser):
        parser.add_argument("--provider", required=True, choices=[c[0] for c in ServiceCredential.Provider.choices])
        parser.add_argument("--token", required=True)
        parser.add_argument(
            "--account-ref", default=None,
            help="Para GitHub: só preencha se for uma ORGANIZAÇÃO de verdade (não seu usuário pessoal — "
                 "ver nota no topo deste arquivo). Deixe de fora para conta pessoal. "
                 "Para Supabase: URL do projeto.",
        )
        parser.add_argument(
            "--clear-account-ref", action="store_true",
            help="Remove um account_ref já configurado (útil se foi setado por engano).",
        )
        parser.add_argument("--tenant", default=None, help="UUID do tenant (omitir = credencial global).")
        parser.add_argument("--label", default="")

    def handle(self, *args, **options):
        if not options["token"]:
            raise CommandError("--token é obrigatório.")

        cred, created = ServiceCredential.objects.get_or_create(
            tenant_id=options["tenant"], provider=options["provider"], defaults={"label": options["label"]},
        )
        cred.token = options["token"]

        if options["clear_account_ref"]:
            cred.account_ref = ""
        elif options["account_ref"] is not None:
            cred.account_ref = options["account_ref"]

        if options["label"]:
            cred.label = options["label"]
        cred.is_active = True
        cred.save()

        scope = f"tenant={options['tenant']}" if options["tenant"] else "global"
        action = "Criada" if created else "Atualizada"
        ref_note = f" (account_ref='{cred.account_ref}')" if cred.account_ref else " (conta pessoal, sem account_ref)"
        self.stdout.write(self.style.SUCCESS(f"{action} credencial de '{options['provider']}' ({scope}){ref_note}."))
