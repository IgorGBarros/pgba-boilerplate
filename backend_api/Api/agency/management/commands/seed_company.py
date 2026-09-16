# backend_api/Api/agency/management/commands/seed_company.py
"""
Uso:
    python manage.py seed_company --tenant <uuid>

Cria (ou confirma que já existem) os setores e agentes do MVP descrito
no documento "Agentic Enterprise OS" (secao 45, "Primeiro Vertical", e
secao 46, "MVP") — nao inventa uma estrutura nova, materializa a que ja
foi definida.

Idempotente: rodar duas vezes nao duplica nada (get_or_create por
tenant_id + name). Seguro re-executar sempre que quiser conferir o
estado ou adicionar tenant novo.

Todo agente nasce com autonomy_level=OBSERVER (o padrao mais seguro,
ver agency/models.py) — subir autonomia e uma decisao explicita
posterior, nunca o ponto de partida.
"""
from django.core.management.base import BaseCommand, CommandError

from agency.models import Agent, Sector
from ingestion.models import KnowledgeSource

# (nome do setor, descricao) — ordem importa so para a impressao no terminal
SECTORS = [
    ("Comercial", "Prospeccao, propostas, relacionamento com clientes."),
    ("Operacoes", "Planejamento de producao/capacidade, MRP, cronograma."),
    ("Compras", "Sourcing de fornecedores, RFQ, cotacoes, pedidos de compra."),
    ("Financeiro", "Contas a pagar/receber, fluxo de caixa, margem."),
    ("Controladoria", "Governanca, politicas, auditoria, compliance."),
]

# (nome do agente, cargo, setor ou None, access_level)
AGENTS = [
    ("CEO Virtual", "CEO", None, Agent.AccessLevel.CEO),
    ("AI Vendedor", "Vendas", "Comercial", Agent.AccessLevel.OPERATIONAL),
    ("AI Planejador", "Planejamento", "Operacoes", Agent.AccessLevel.OPERATIONAL),
    ("AI Comprador", "Compras", "Compras", Agent.AccessLevel.OPERATIONAL),
    ("AI Financeiro", "CFO", "Financeiro", Agent.AccessLevel.OPERATIONAL),
    # Controller e transversal por natureza (secao 14 do documento) — por
    # isso sector=None aqui, igual o CEO: a constraint do banco
    # (agent_sector_matches_access_level) EXIGE sector nulo para
    # general_orchestrator/ceo, nunca permite os dois ao mesmo tempo.
    # O setor "Controladoria" continua existindo — so nao e a "casa" fixa
    # deste agente especifico.
    ("AI Controller", "Controller", None, Agent.AccessLevel.GENERAL_ORCHESTRATOR),
]


class Command(BaseCommand):
    help = "Cria os setores e agentes iniciais do MVP (Agentic Enterprise OS, secoes 45-46)."

    def add_arguments(self, parser):
        parser.add_argument("--tenant", required=True, help="UUID do tenant (o mesmo do seu config.json).")

    def handle(self, *args, **options):
        tenant_id = options["tenant"]

        sectors_by_name = {}
        for name, description in SECTORS:
            sector, created = Sector.objects.get_or_create(
                tenant_id=tenant_id, name=name, defaults={"description": description},
            )
            sectors_by_name[name] = sector
            label = "Criado" if created else "Ja existia"
            self.stdout.write(f"  [Setor] {label}: {name}")

        self.stdout.write("")

        for name, role, sector_name, access_level in AGENTS:
            sector = sectors_by_name[sector_name] if sector_name else None
            needs_no_sector = access_level in (Agent.AccessLevel.GENERAL_ORCHESTRATOR, Agent.AccessLevel.CEO)

            if needs_no_sector and sector is not None:
                raise CommandError(
                    f"Agente '{name}' tem access_level='{access_level}' mas foi definido com setor "
                    f"'{sector_name}' — a constraint do banco exige sector=None para general_orchestrator/ceo."
                )
            if not needs_no_sector and sector is None:
                raise CommandError(
                    f"Agente '{name}' tem access_level='{access_level}' mas nao tem setor — "
                    f"a constraint do banco exige setor definido para operational/sector_orchestrator."
                )

            agent, created = Agent.objects.get_or_create(
                tenant_id=tenant_id, name=name,
                defaults={"role": role, "sector": sector, "access_level": access_level},
            )
            label = "Criado" if created else "Ja existia"
            escopo = sector.name if sector else "acesso total"
            self.stdout.write(f"  [Agente] {label}: {name} ({role}) — {escopo}")

        self.stdout.write("")

        # RAG escopado por setor de verdade (secao 9 do CLAUDE.md) — antes
        # disso, TODO setor compartilhava a mesma fonte (o vault inteiro),
        # contrariando a propria regra que documentamos: um agente
        # operacional conseguia ver nota de outro setor.
        #
        # Estrategia de migracao suave: pra cada setor, procura primeiro
        # uma fonte com o nome exato "Vault <Setor>" (criada rodando
        # `sync_obsidian --name "Vault <Setor>" --path /vaults/06-Agentes/<slug>`
        # numa subpasta dedicada) — se ainda nao existir, cai pro
        # "Vault Principal" compartilhado (o que ja funciona hoje). Assim,
        # criar as subpastas e sincronizar cada uma eleva a precisao sem
        # exigir nenhuma mudanca de codigo depois.
        shared_source = KnowledgeSource.objects.filter(
            tenant_id=tenant_id, source_type=KnowledgeSource.SourceType.OBSIDIAN, name="Vault Principal",
        ).first()

        linked_specific = 0
        linked_shared = 0
        for sector in sectors_by_name.values():
            specific_source = KnowledgeSource.objects.filter(
                tenant_id=tenant_id, source_type=KnowledgeSource.SourceType.OBSIDIAN, name=f"Vault {sector.name}",
            ).first()

            target = specific_source or shared_source
            if target is None:
                continue
            if sector.knowledge_source_id == target.id:
                continue  # ja esta ligado a fonte certa, nada a fazer

            sector.knowledge_source = target
            sector.save(update_fields=["knowledge_source"])
            if specific_source:
                linked_specific += 1
            else:
                linked_shared += 1

        if linked_specific or linked_shared:
            self.stdout.write(
                f"  [RAG] {linked_specific} setor(es) ligado(s) a fonte PROPRIA, "
                f"{linked_shared} ligado(s) ao vault compartilhado (fallback)."
            )
        elif shared_source is None:
            self.stdout.write(self.style.WARNING(
                "  [RAG] Nenhuma KnowledgeSource encontrada ainda — rode 'pgbasync' "
                "(ou sync_obsidian por setor) pra os agentes terem contexto real pra buscar."
            ))
        else:
            self.stdout.write("  [RAG] Todos os setores ja estavam ligados a fonte correta — nada mudou.")

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(
            f"Empresa configurada: {len(SECTORS)} setores, {len(AGENTS)} agentes (tenant {tenant_id})."
        ))