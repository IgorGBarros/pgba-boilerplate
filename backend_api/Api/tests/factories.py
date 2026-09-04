# backend_api/Api/tests/factories.py
"""
Factories (factory_boy) para os testes. Como `conftest.py`, ficava vazio
desde o audit original apesar de `factory-boy` estar no requirements.txt.

Convenção: uma factory por model de negócio relevante para testes,
sempre aceitando `tenant_id` explícito (nunca gerando um tenant "escondido"
dentro da factory — isolamento por tenant é um dos princípios não
negociáveis do CLAUDE.md, então os testes devem ser explícitos sobre qual
tenant estão usando).
"""
import factory
from factory.django import DjangoModelFactory

from User.models import CustomUser


class UserFactory(DjangoModelFactory):
    class Meta:
        model = CustomUser
        django_get_or_create = ("email",)

    email = factory.Sequence(lambda n: f"user{n}@example.com")
    name = factory.Faker("name", locale="pt_BR")
    tenant_id = factory.Faker("uuid4")

    @factory.post_generation
    def password(self, create, extracted, **kwargs):
        if not create:
            return
        self.set_password(extracted or "senha-forte-123")
        self.save(update_fields=["password"])


# Exemplo de factory de vertical (agency) — mostra o padrão para quem for
# escrever a factory da própria vertical do projeto: sempre recebendo
# tenant_id do chamador, nunca gerando um por conta própria.
class SectorFactory(DjangoModelFactory):
    class Meta:
        model = "agency.Sector"

    name = factory.Sequence(lambda n: f"Setor {n}")
    tenant_id = factory.Faker("uuid4")


class AgentFactory(DjangoModelFactory):
    """Agente operacional (default) — pertence a um setor, acesso restrito a ele."""

    class Meta:
        model = "agency.Agent"

    name = factory.Faker("name", locale="pt_BR")
    role = "Analista"
    access_level = "operational"
    sector = factory.SubFactory(SectorFactory)
    tenant_id = factory.SelfAttribute("sector.tenant_id")


class SectorOrchestratorFactory(AgentFactory):
    """Orquestrador de um setor — mesmo setor do AgentFactory, mas pode mediar."""

    role = "Orquestrador de Setor"
    access_level = "sector_orchestrator"


class ProjectFactory(DjangoModelFactory):
    class Meta:
        model = "agency.Project"

    name = factory.Sequence(lambda n: f"projeto-{n}")
    tenant_id = factory.Faker("uuid4")
    status = "ready"


class GeneralOrchestratorFactory(DjangoModelFactory):
    """Orquestrador-geral — sem setor, acesso total, medeia qualquer par de setores."""

    class Meta:
        model = "agency.Agent"

    name = factory.Faker("name", locale="pt_BR")
    role = "Orquestrador-Geral"
    access_level = "general_orchestrator"
    sector = None
    tenant_id = factory.Faker("uuid4")


class CeoAgentFactory(DjangoModelFactory):
    """CEO — sem setor, acesso total."""

    class Meta:
        model = "agency.Agent"

    name = factory.Faker("name", locale="pt_BR")
    role = "CEO"
    access_level = "ceo"
    sector = None
    tenant_id = factory.Faker("uuid4")
