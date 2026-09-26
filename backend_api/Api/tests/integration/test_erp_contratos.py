# backend_api/Api/tests/integration/test_erp_contratos.py
"""
ERP no conceito SAP B1: parceiros de negócio, itens serviço/material,
contratos de serviço (do projeto do CRM até fatura, baixa de estoque e NF
rascunho), integração com Compras e exclusão lógica.
"""
import uuid
from datetime import date
from decimal import Decimal

import pytest

from crm.models import Deal, Project
from erp.models import (
    ContratoServico,
    ItemEstoque,
    LancamentoFinanceiro,
    MovimentacaoEstoque,
    NotaFiscal,
    ParceiroNegocio,
)
from erp.services import parcelas_previstas

API = "/api/v1/erp"


def _cliente(tenant_id, **kw):
    dados = {
        "tipo": "cliente",
        "nome": "Acme Ltda",
        "cpf_cnpj": "12.345.678/0001-90",
        "municipio": "São Paulo",
        "uf": "SP",
    }
    dados.update(kw)
    return ParceiroNegocio.objects.create(tenant_id=tenant_id, **dados)


def _projeto(tenant_id, **kw):
    deal = Deal.objects.create(
        tenant_id=tenant_id,
        titulo="Portal Acme",
        empresa="Acme Ltda",
        valor=Decimal("12000"),
        sera_contrato=True,
        contrato_com_material=kw.pop("com_material", False),
    )
    dados = {
        "deal": deal,
        "titulo": "Portal Acme",
        "empresa": "Acme Ltda",
        "sera_contrato": True,
        "data_inicio": date(2026, 1, 1),
        "data_fim_previsto": date(2026, 12, 31),
        "observacoes": "Manutenção do portal",
    }
    dados.update(kw)
    return Project.objects.create(tenant_id=tenant_id, **dados)


# ─── Parceiros ───────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_parceiro_ganha_codigo_por_tipo_e_cpf_sai_mascarado(auth_client):
    c = auth_client.post(f"{API}/parceiros/", {"tipo": "cliente", "nome": "Ana"}, format="json")
    f = auth_client.post(
        f"{API}/parceiros/", {"tipo": "fornecedor", "nome": "Aço SA"}, format="json"
    )
    pf = auth_client.post(
        f"{API}/parceiros/",
        {"tipo": "cliente", "nome": "João", "cpf_cnpj": "123.456.789-09"},
        format="json",
    )
    assert (c.data["codigo"], f.data["codigo"], pf.data["codigo"]) == ("C00001", "F00001", "C00002")
    assert "*" in pf.data["cpf_cnpj"] and pf.data["pessoa_fisica"] is True
    # Salvar de volta o valor mascarado não apaga o CPF verdadeiro
    auth_client.patch(
        f"{API}/parceiros/{pf.data['id']}/", {"cpf_cnpj": pf.data["cpf_cnpj"]}, format="json"
    )
    assert ParceiroNegocio.objects.get(id=pf.data["id"]).cpf_cnpj == "123.456.789-09"
    # Rota antiga só mostra fornecedor
    nomes = [p["nome"] for p in auth_client.get(f"{API}/fornecedores/").data["results"]]
    assert nomes == ["Aço SA"]
    bad = auth_client.post(f"{API}/parceiros/", {"nome": "X", "cpf_cnpj": "123"}, format="json")
    assert bad.status_code == 400


@pytest.mark.django_db
def test_exclusao_e_logica(auth_client, tenant_id):
    p = _cliente(tenant_id)
    assert auth_client.delete(f"{API}/parceiros/{p.id}/").status_code == 204
    p.refresh_from_db()
    assert p.is_active is False and p.deleted_at is not None
    assert auth_client.get(f"{API}/parceiros/").data["count"] == 0


@pytest.mark.django_db
def test_fk_de_outro_tenant_e_recusada(auth_client, tenant_id):
    alheio = _cliente(uuid.uuid4(), nome="Cliente de outro tenant")
    res = auth_client.post(
        f"{API}/contratos/",
        {
            "nome_projeto": "X",
            "parceiro": alheio.id,
            "data_inicio": "2026-01-01",
            "data_fim": "2026-02-01",
            "valor_total": "100",
        },
        format="json",
    )
    assert res.status_code == 400 and "parceiro" in res.data


# ─── Contrato a partir do CRM ────────────────────────────────────────────────


@pytest.mark.django_db
def test_projeto_do_crm_marcado_vira_contrato(auth_client, tenant_id):
    projeto = _projeto(tenant_id)
    _projeto(tenant_id, titulo="Sem contrato", sera_contrato=False)
    pend = auth_client.get(f"{API}/contratos/projetos-pendentes/").data
    assert [p["titulo"] for p in pend] == ["Portal Acme"] and pend[0]["valor"] == 12000.0

    res = auth_client.post(f"{API}/contratos/de-projeto/", {"projeto": projeto.id}, format="json")
    assert res.status_code == 201, res.data
    c = res.data
    assert c["numero"] == "CT-2026-0001" and c["status"] == "rascunho"
    assert (c["nome_projeto"], c["descricao"]) == ("Portal Acme", "Manutenção do portal")
    assert (c["data_inicio"], c["data_fim"], c["valor_total"]) == (
        "2026-01-01",
        "2026-12-31",
        "12000.00",
    )
    assert c["parceiro_nome"] == "Acme Ltda" and c["projeto"] == projeto.id
    # Some da lista e aparece no projeto do CRM; não cria dois
    assert auth_client.get(f"{API}/contratos/projetos-pendentes/").data == []
    proj = auth_client.get(f"/api/v1/crm/projects/{projeto.id}/").data
    assert proj["sera_contrato"] is True and proj["contrato"]["numero"] == "CT-2026-0001"
    again = auth_client.post(f"{API}/contratos/de-projeto/", {"projeto": projeto.id}, format="json")
    assert again.status_code == 400


@pytest.mark.django_db
def test_deal_ganho_passa_sera_contrato_pro_projeto(auth_client, tenant_id):
    from crm.models import Pipeline, Stage

    pipe = Pipeline.objects.create(tenant_id=tenant_id, name="P")
    Stage.objects.create(tenant_id=tenant_id, pipeline=pipe, main_stage="project", name="Kickoff")
    deal = Deal.objects.create(
        tenant_id=tenant_id,
        pipeline=pipe,
        titulo="Suporte",
        sera_contrato=True,
        contrato_com_material=True,
    )
    res = auth_client.post(
        f"/api/v1/crm/deals/{deal.id}/set-outcome/", {"outcome": "ganho"}, format="json"
    )
    assert res.status_code == 200, res.data
    p = Project.objects.get(deal=deal)
    assert p.sera_contrato is True and p.contrato_com_material is True


# ─── Ciclo do contrato ───────────────────────────────────────────────────────


@pytest.mark.django_db
def test_contrato_com_material_fatura_baixa_estoque_e_gera_nf(auth_client, tenant_id):
    cliente = _cliente(tenant_id)
    cabo = ItemEstoque.objects.create(
        tenant_id=tenant_id,
        codigo="CABO",
        nome="Cabo de rede",
        quantidade=10,
        preco_venda=Decimal("50"),
    )
    suporte = ItemEstoque.objects.create(
        tenant_id=tenant_id,
        codigo="SUP",
        nome="Suporte mensal",
        tipo_item="servico",
        preco_venda=Decimal("1000"),
        codigo_servico="01.07",
    )
    c = auth_client.post(
        f"{API}/contratos/",
        {
            "nome_projeto": "Rede Acme",
            "descricao": "Instalação + suporte",
            "parceiro": cliente.id,
            "data_inicio": "2026-01-05",
            "data_fim": "2026-03-31",
            "periodicidade": "mensal",
            "dia_vencimento": 10,
            "com_material": True,
        },
        format="json",
    ).data
    cid = c["id"]
    # Sem material não ativa
    assert auth_client.post(f"{API}/contratos/{cid}/ativar/").status_code == 400
    # A tela manda descricao="" quando escolhe um item do cadastro
    servico = auth_client.post(
        f"{API}/contratos-itens/",
        {"contrato": cid, "item": suporte.id, "quantidade": 3, "descricao": ""},
        format="json",
    )
    assert servico.status_code == 201, servico.data
    assert servico.data["descricao"] == "Suporte mensal" and servico.data["tipo"] == "servico"
    linha = auth_client.post(
        f"{API}/contratos-itens/",
        {"contrato": cid, "item": cabo.id, "quantidade": 4},
        format="json",
    ).data
    assert linha["tipo"] == "material" and linha["valor_unitario"] == "50.00"
    contrato = auth_client.get(f"{API}/contratos/{cid}/").data
    assert contrato["valor_total"] == "3200.00"  # 3×1000 + 4×50

    assert auth_client.post(f"{API}/contratos/{cid}/ativar/").data["status"] == "ativo"
    # 3 parcelas (10/01, 10/02, 10/03), soma exata
    fat = auth_client.post(f"{API}/contratos/{cid}/gerar-faturas/").data
    assert [f["vencimento"] for f in fat["criadas"]] == ["2026-01-10", "2026-02-10", "2026-03-10"]
    assert sum(Decimal(f["valor"]) for f in fat["criadas"]) == Decimal("3200.00")
    assert fat["criadas"][0]["parceiro"] == cliente.id and fat["criadas"][0]["origem"] == "contrato"
    # Idempotente
    assert auth_client.post(f"{API}/contratos/{cid}/gerar-faturas/").data["criadas"] == []
    assert LancamentoFinanceiro.objects.filter(contrato_id=cid).count() == 3

    baixa = auth_client.post(f"{API}/contratos/{cid}/baixar-material/")
    assert baixa.status_code == 200, baixa.data
    cabo.refresh_from_db()
    assert cabo.quantidade == 6
    assert MovimentacaoEstoque.objects.get(item=cabo).referencia == "CT-2026-0001"
    assert (
        auth_client.post(f"{API}/contratos/{cid}/baixar-material/").status_code == 400
    )  # nada pendente

    fatura = LancamentoFinanceiro.objects.filter(contrato_id=cid).order_by("vencimento").first()
    nf = auth_client.post(
        f"{API}/contratos/{cid}/gerar-nota-fiscal/", {"lancamento": fatura.id}, format="json"
    ).data
    assert nf["status"] == "rascunho" and nf["codigo_servico"] == "01.07"
    assert Decimal(nf["valor"]) == fatura.valor and "Rede Acme" in nf["discriminacao"]
    assert NotaFiscal.objects.filter(contrato_id=cid).count() == 1

    # Em vigor não exclui; cancelado exclui (lógico)
    assert auth_client.delete(f"{API}/contratos/{cid}/").status_code == 400
    assert auth_client.post(f"{API}/contratos/{cid}/cancelar/").data["status"] == "cancelado"
    assert auth_client.delete(f"{API}/contratos/{cid}/").status_code == 204
    assert ContratoServico.objects.get(id=cid).is_active is False


@pytest.mark.django_db
def test_baixa_sem_estoque_nao_baixa_nada(auth_client, tenant_id):
    cliente = _cliente(tenant_id)
    a = ItemEstoque.objects.create(tenant_id=tenant_id, codigo="A", nome="A", quantidade=10)
    b = ItemEstoque.objects.create(tenant_id=tenant_id, codigo="B", nome="B", quantidade=1)
    c = ContratoServico.objects.create(
        tenant_id=tenant_id,
        nome_projeto="X",
        parceiro=cliente,
        data_inicio=date(2026, 1, 1),
        data_fim=date(2026, 1, 31),
        valor_total=Decimal("100"),
        status="ativo",
        com_material=True,
    )
    for item, q in ((a, 2), (b, 5)):
        c.itens.create(
            tenant_id=tenant_id, item=item, tipo="material", descricao=item.nome, quantidade=q
        )
    res = auth_client.post(f"{API}/contratos/{c.id}/baixar-material/")
    assert res.status_code == 400 and "insuficiente" in res.data["detail"]
    a.refresh_from_db()
    assert a.quantidade == 10  # rollback: a linha A não foi baixada sozinha


def test_parcelas_unica_e_contrato_curto():
    base = {"valor_total": Decimal("100"), "dia_vencimento": 10}
    unica = ContratoServico(
        periodicidade="unica", data_inicio=date(2026, 5, 20), data_fim=date(2026, 6, 1), **base
    )
    assert [(p["vencimento"], p["valor"]) for p in parcelas_previstas(unica)] == [
        (date(2026, 5, 20), Decimal("100"))
    ]
    curto = ContratoServico(
        periodicidade="mensal", data_inicio=date(2026, 5, 20), data_fim=date(2026, 6, 5), **base
    )
    assert [p["vencimento"] for p in parcelas_previstas(curto)] == [date(2026, 6, 5)]
    tres = ContratoServico(
        periodicidade="mensal", data_inicio=date(2026, 1, 1), data_fim=date(2026, 3, 31), **base
    )
    assert [p["valor"] for p in parcelas_previstas(tres)] == [
        Decimal("33.33"),
        Decimal("33.33"),
        Decimal("33.34"),
    ]


@pytest.mark.django_db
def test_servico_nao_movimenta_estoque(auth_client, tenant_id):
    s = ItemEstoque.objects.create(
        tenant_id=tenant_id, codigo="S", nome="Consultoria", tipo_item="servico"
    )
    res = auth_client.post(
        f"{API}/movimentacoes-estoque/registrar/",
        {"item_id": s.id, "tipo": "entrada", "quantidade": 1},
        format="json",
    )
    assert res.status_code == 400 and "serviço" in res.data["detail"]


# ─── Integração com Compras e prontidão da NF ────────────────────────────────


@pytest.mark.django_db
def test_pedido_entregue_vira_conta_a_pagar(tenant_id):
    from compras.models import Fornecedor, Orcamento, PedidoCompra
    from compras.services import avancar_status_pedido

    deal = Deal.objects.create(tenant_id=tenant_id, titulo="Obra")
    forn = Fornecedor.objects.create(tenant_id=tenant_id, nome="Madeireira")
    orc = Orcamento.objects.create(
        tenant_id=tenant_id, deal=deal, fornecedor=forn, valor_total=Decimal("850")
    )
    pedido = PedidoCompra.objects.create(
        tenant_id=tenant_id, orcamento=orc, status="em_transito", numero_pedido="PC-9"
    )
    avancar_status_pedido(pedido.id, tenant_id)
    lanc = LancamentoFinanceiro.objects.get(
        tenant_id=tenant_id, referencia_origem=f"pedido:{pedido.id}"
    )
    assert (lanc.tipo, lanc.valor, lanc.origem, lanc.fornecedor_nome) == (
        "despesa",
        Decimal("850"),
        "compra",
        "Madeireira",
    )


@pytest.mark.django_db
def test_prontidao_nf_aponta_o_que_falta(auth_client):
    res = auth_client.get(f"{API}/fiscal/prontidao/").data
    faltando = {i["id"] for i in res["itens"] if not i["ok"]}
    assert res["pronto"] is False
    assert {"empresa_cnpj", "empresa_im", "emissor", "certificado"} <= faltando

    auth_client.put(
        f"{API}/empresa/",
        {
            "razao_social": "Minha Empresa",
            "cnpj": "11.222.333/0001-44",
            "inscricao_municipal": "123",
            "regime_tributario": "simples",
            "logradouro": "Rua A",
            "municipio": "São Paulo",
            "uf": "sp",
            "codigo_municipio_ibge": "3550308",
            "codigo_servico_padrao": "01.07",
            "aliquota_iss_padrao": "2.00",
        },
        format="json",
    )
    res = auth_client.get(f"{API}/fiscal/prontidao/").data
    faltando = {i["id"] for i in res["itens"] if not i["ok"]}
    assert faltando == {"certificado", "emissor"}
    assert auth_client.get(f"{API}/empresa/").data["uf"] == "SP"


def test_funcoes_de_ia_do_erp_registradas():
    from orchestration.registry import get_function

    for nome in ("erp_contratos_resumo", "erp_financeiro_resumo", "erp_itens_abaixo_do_minimo"):
        fn = get_function(nome)
        assert fn is not None and fn.risk == "low"
