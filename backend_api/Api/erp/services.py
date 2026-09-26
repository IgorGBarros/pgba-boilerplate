# backend_api/Api/erp/services.py
"""
Regras de negócio do ERP (conceito SAP Business One), sem depender de
request/DRF. As views só validam entrada e chamam daqui.

Fluxo do contrato de serviço:

    crm.Project (sera_contrato=True)
        └─ contrato_de_projeto()            → ContratoServico (rascunho)
             ├─ ItemContrato (serviço | material) → valor_total = soma das linhas
             ├─ ativar()                    → confere datas / material
             ├─ gerar_faturas()             → LancamentoFinanceiro (receber), 1 por parcela
             ├─ baixar_material()           → MovimentacaoEstoque (saída) por linha de material
             └─ gerar_nota_fiscal()         → NotaFiscal (rascunho — não transmite)

Toda integração é idempotente (`referencia_origem` única por tenant): rodar
de novo não duplica fatura nem conta a pagar.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone

from erp.models import (
    ContratoServico,
    DadosEmpresa,
    ItemContrato,
    ItemEstoque,
    LancamentoFinanceiro,
    MovimentacaoEstoque,
    NotaFiscal,
    ParceiroNegocio,
)

CENTAVO = Decimal("0.01")


class ErpError(ValueError):
    """Regra de negócio violada — a view devolve 400 com a mensagem."""


# ─── Estoque ─────────────────────────────────────────────────────────────────


def registrar_movimentacao(
    tenant_id,
    item: ItemEstoque,
    tipo: str,
    quantidade: int,
    valor_unitario: Decimal | None = None,
    motivo: str = "",
    referencia: str = "",
    operador: str = "",
) -> MovimentacaoEstoque:
    """Único lugar que mexe no saldo de um item (custo médio na entrada)."""
    if not item.controla_estoque:
        raise ErpError(f"'{item.nome}' é serviço — serviço não tem estoque.")
    if quantidade <= 0:
        raise ErpError("Quantidade deve ser maior que zero.")

    qtd_anterior = item.quantidade
    if tipo == "entrada":
        if valor_unitario is not None and qtd_anterior >= 0:
            total_anterior = Decimal(qtd_anterior) * item.custo_medio
            total_novo = Decimal(quantidade) * valor_unitario
            item.custo_medio = (total_anterior + total_novo) / Decimal(qtd_anterior + quantidade)
            item.data_ultima_compra = timezone.now().date()
        item.quantidade += quantidade
    elif tipo in ("saida", "transferencia"):
        if item.quantidade < quantidade:
            raise ErpError(f"Estoque insuficiente de '{item.nome}'. Disponível: {item.quantidade}.")
        item.quantidade -= quantidade
    elif tipo == "ajuste":
        item.quantidade = quantidade
    else:
        raise ErpError(f"Tipo de movimentação inválido: {tipo}")

    item.save()
    return MovimentacaoEstoque.objects.create(
        tenant_id=tenant_id,
        item=item,
        tipo=tipo,
        quantidade=quantidade,
        quantidade_anterior=qtd_anterior,
        quantidade_posterior=item.quantidade,
        valor_unitario=valor_unitario,
        motivo=motivo,
        referencia=referencia,
        operador=operador,
    )


# ─── Contratos ───────────────────────────────────────────────────────────────


def recalcular_valor(contrato: ContratoServico) -> ContratoServico:
    """Com linhas, o valor do contrato é a soma delas; sem linhas, vale o digitado."""
    itens = list(contrato.itens.all())
    if itens:
        total = sum((i.valor_total for i in itens), Decimal("0"))
        contrato.valor_total = total.quantize(CENTAVO, ROUND_HALF_UP)
        contrato.com_material = contrato.com_material or any(
            i.tipo == ItemContrato.Tipo.MATERIAL for i in itens
        )
        contrato.save(update_fields=["valor_total", "com_material", "updated_at"])
    return contrato


def _add_meses(d: date, meses: int, dia: int) -> date:
    mes = d.month - 1 + meses
    ano = d.year + mes // 12
    mes = mes % 12 + 1
    return date(ano, mes, min(dia, calendar.monthrange(ano, mes)[1]))


PASSO_MESES = {"mensal": 1, "trimestral": 3, "anual": 12}


def parcelas_previstas(contrato: ContratoServico) -> list[dict]:
    """
    Vencimentos e valores das parcelas: no `dia_vencimento`, a partir do mês
    do início, enquanto couber até o fim do contrato. Parcela única vence no
    início. A última parcela absorve o arredondamento — a soma bate o valor.
    """
    inicio, fim = contrato.data_inicio, contrato.data_fim
    if contrato.periodicidade == ContratoServico.Periodicidade.UNICA:
        datas = [inicio]
    else:
        passo = PASSO_MESES[contrato.periodicidade]
        primeira = _add_meses(inicio, 0, contrato.dia_vencimento)
        if primeira < inicio:
            primeira = _add_meses(inicio, 1, contrato.dia_vencimento)
        datas, k = [], 0
        while True:
            d = _add_meses(primeira, k * passo, contrato.dia_vencimento)
            if d > fim:
                break
            datas.append(d)
            k += 1
        if not datas:  # contrato mais curto que um período
            datas = [fim]

    n = len(datas)
    total = Decimal(contrato.valor_total)
    base = (total / n).quantize(CENTAVO, ROUND_HALF_UP)
    valores = [base] * (n - 1) + [total - base * (n - 1)]
    return [
        {"parcela": i + 1, "total_parcelas": n, "vencimento": d, "valor": v}
        for i, (d, v) in enumerate(zip(datas, valores))
    ]


def ativar(contrato: ContratoServico) -> ContratoServico:
    if contrato.status not in (ContratoServico.Status.RASCUNHO, ContratoServico.Status.SUSPENSO):
        raise ErpError(f"Contrato {contrato.get_status_display().lower()} não pode ser ativado.")
    if contrato.data_fim < contrato.data_inicio:
        raise ErpError("A data de fim é anterior ao início.")
    if contrato.valor_total <= 0:
        raise ErpError("Contrato sem valor — informe o valor ou adicione as linhas.")
    if (
        contrato.com_material
        and not contrato.itens.filter(tipo=ItemContrato.Tipo.MATERIAL).exists()
    ):
        raise ErpError("Contrato com material precisa de pelo menos uma linha de material.")
    contrato.status = ContratoServico.Status.ATIVO
    contrato.save(update_fields=["status", "updated_at"])
    return contrato


def mudar_status(contrato: ContratoServico, novo: str) -> ContratoServico:
    permitidos = {
        ContratoServico.Status.SUSPENSO: {ContratoServico.Status.ATIVO},
        ContratoServico.Status.ENCERRADO: {
            ContratoServico.Status.ATIVO,
            ContratoServico.Status.SUSPENSO,
        },
        ContratoServico.Status.CANCELADO: {
            ContratoServico.Status.RASCUNHO,
            ContratoServico.Status.ATIVO,
            ContratoServico.Status.SUSPENSO,
        },
    }
    if novo == ContratoServico.Status.ATIVO:
        return ativar(contrato)
    if contrato.status not in permitidos.get(novo, set()):
        raise ErpError(
            f"Não dá pra passar de '{contrato.get_status_display()}' para "
            f"'{ContratoServico.Status(novo).label}'."
        )
    contrato.status = novo
    contrato.save(update_fields=["status", "updated_at"])
    return contrato


@transaction.atomic
def gerar_faturas(contrato: ContratoServico) -> list[LancamentoFinanceiro]:
    """Contas a receber, uma por parcela. Parcela já gerada não é gerada de novo."""
    if contrato.status != ContratoServico.Status.ATIVO:
        raise ErpError("Só contrato ativo gera faturas.")
    criadas = []
    for p in parcelas_previstas(contrato):
        ref = f"{contrato.numero}#{p['parcela']}"
        if LancamentoFinanceiro.objects.filter(
            tenant_id=contrato.tenant_id, referencia_origem=ref
        ).exists():
            continue
        criadas.append(
            LancamentoFinanceiro.objects.create(
                tenant_id=contrato.tenant_id,
                descricao=(
                    f"{contrato.numero} — {contrato.nome_projeto} "
                    f"(parcela {p['parcela']}/{p['total_parcelas']})"
                ),
                tipo="receita",
                valor=p["valor"],
                vencimento=p["vencimento"],
                status="pendente",
                categoria="servicos",
                cliente=contrato.parceiro.nome,
                numero_documento=ref,
                parceiro=contrato.parceiro,
                contrato=contrato,
                projeto=contrato.projeto,
                centro_custo=contrato.centro_custo,
                setor=contrato.setor,
                origem="contrato",
                referencia_origem=ref,
            )
        )
    return criadas


@transaction.atomic
def baixar_material(contrato: ContratoServico, operador: str = "") -> list[MovimentacaoEstoque]:
    """
    Saída de estoque do material ainda não baixado de cada linha. Tudo ou
    nada: faltou estoque de um item, nenhuma linha é baixada.
    """
    if contrato.status != ContratoServico.Status.ATIVO:
        raise ErpError("Só contrato ativo baixa material.")
    linhas = ItemContrato.objects.select_for_update().filter(
        contrato=contrato, tipo=ItemContrato.Tipo.MATERIAL
    )
    movs = []
    for linha in linhas:
        pendente = linha.quantidade - linha.quantidade_baixada
        if pendente <= 0:
            continue
        if linha.item is None:
            raise ErpError(
                f"A linha '{linha.descricao}' é material avulso — vincule um item do "
                "cadastro pra dar baixa no estoque."
            )
        if pendente != pendente.to_integral_value():
            raise ErpError(f"'{linha.descricao}': estoque só baixa quantidade inteira.")
        item = ItemEstoque.objects.select_for_update().get(pk=linha.item_id)
        movs.append(
            registrar_movimentacao(
                contrato.tenant_id,
                item,
                "saida",
                int(pendente),
                motivo=f"Material do contrato {contrato.numero}",
                referencia=contrato.numero,
                operador=operador,
            )
        )
        linha.quantidade_baixada = linha.quantidade
        linha.save(update_fields=["quantidade_baixada", "updated_at"])
    if not movs:
        raise ErpError("Não há material pendente de baixa neste contrato.")
    return movs


def dados_empresa(tenant_id) -> DadosEmpresa:
    empresa, _ = DadosEmpresa.objects.get_or_create(tenant_id=tenant_id)
    return empresa


def gerar_nota_fiscal(
    contrato: ContratoServico, lancamento: LancamentoFinanceiro | None = None
) -> NotaFiscal:
    """
    Monta a NFS-e do contrato (ou de uma fatura dele) como RASCUNHO. Não
    transmite: isso depende de um emissor (prefeitura/Emissor Nacional ou
    um provedor de API) — ver docs/NOTA_FISCAL.md e `prontidao_nota_fiscal`.
    """
    if lancamento is not None and lancamento.contrato_id != contrato.id:
        raise ErpError("Essa fatura não é deste contrato.")
    ref = lancamento.referencia_origem if lancamento else contrato.numero
    numero = f"RASC-{ref}"
    existente = NotaFiscal.objects.filter(tenant_id=contrato.tenant_id, numero=numero).first()
    if existente:
        return existente

    empresa = dados_empresa(contrato.tenant_id)
    servico = contrato.itens.filter(tipo=ItemContrato.Tipo.SERVICO, item__isnull=False).first()
    codigo_servico = (
        servico.item.codigo_servico if servico and servico.item.codigo_servico else ""
    ) or empresa.codigo_servico_padrao
    valor = lancamento.valor if lancamento else contrato.valor_total
    aliquota = empresa.aliquota_iss_padrao or Decimal("0")
    periodo = f"{contrato.data_inicio:%d/%m/%Y} a {contrato.data_fim:%d/%m/%Y}"
    discriminacao = f"{contrato.nome_projeto} — contrato {contrato.numero} ({periodo})."
    if lancamento:
        discriminacao += f" {lancamento.descricao}."
    if contrato.descricao:
        discriminacao += f"\n{contrato.descricao}"

    return NotaFiscal.objects.create(
        tenant_id=contrato.tenant_id,
        tipo=NotaFiscal.Tipo.NFSE,
        numero=numero,
        serie=empresa.serie_nfse or "",
        cliente=contrato.parceiro.nome,
        parceiro=contrato.parceiro,
        contrato=contrato,
        lancamento=lancamento,
        valor=valor,
        codigo_servico=codigo_servico,
        discriminacao=discriminacao,
        aliquota_iss=aliquota,
        valor_iss=(Decimal(valor) * aliquota / Decimal("100")).quantize(CENTAVO, ROUND_HALF_UP),
        status="rascunho",
    )


# ─── Integração com o CRM ────────────────────────────────────────────────────


def projetos_aguardando_contrato(tenant_id):
    """Projetos do CRM marcados "será contrato" que ainda não têm contrato no ERP."""
    from crm.models import Project

    com_contrato = (
        ContratoServico.objects.filter(tenant_id=tenant_id, is_active=True, projeto__isnull=False)
        .exclude(status=ContratoServico.Status.CANCELADO)
        .values("projeto_id")
    )
    return (
        Project.objects.filter(tenant_id=tenant_id, is_active=True, sera_contrato=True)
        .exclude(id__in=com_contrato)
        .select_related("deal")
        .order_by("-created_at")
    )


def cliente_do_projeto(tenant_id, project) -> ParceiroNegocio:
    """Parceiro cliente pelo nome da empresa do projeto (cria se não existir)."""
    nome = (
        project.empresa or (project.deal.empresa if project.deal else "") or project.titulo
    ).strip()
    parceiro = ParceiroNegocio.objects.filter(
        tenant_id=tenant_id,
        is_active=True,
        nome__iexact=nome,
        tipo=ParceiroNegocio.Tipo.CLIENTE,
    ).first()
    if parceiro:
        return parceiro
    return ParceiroNegocio.objects.create(
        tenant_id=tenant_id,
        tipo=ParceiroNegocio.Tipo.CLIENTE,
        nome=nome,
        observacoes=f"Criado a partir do projeto do CRM '{project.titulo}'.",
    )


@transaction.atomic
def contrato_de_projeto(tenant_id, project_id: int, **overrides) -> ContratoServico:
    """
    Contrato (rascunho) a partir de um projeto do CRM: nome do projeto,
    descrição, datas, valor do negócio e se tem material. Um projeto tem no
    máximo um contrato vivo (cancelado não conta).
    """
    from crm.models import Project

    try:
        project = Project.objects.select_related("deal").get(
            id=project_id, tenant_id=tenant_id, is_active=True
        )
    except Project.DoesNotExist:
        raise ErpError("Projeto não encontrado.")
    ja_tem = (
        project.contratos_erp.filter(is_active=True)
        .exclude(status=ContratoServico.Status.CANCELADO)
        .first()
    )
    if ja_tem:
        raise ErpError(f"Este projeto já tem o contrato {ja_tem.numero}.")

    inicio = project.data_inicio or timezone.now().date()
    fim = project.data_fim_previsto or (inicio + timedelta(days=364))
    if fim < inicio:
        fim = inicio
    valor = project.deal.valor if project.deal and project.deal.valor else Decimal("0")
    dados = {
        "nome_projeto": project.titulo,
        "descricao": (project.observacoes or "")[:2000],
        "parceiro": cliente_do_projeto(tenant_id, project),
        "projeto": project,
        "com_material": project.contrato_com_material,
        "data_inicio": inicio,
        "data_fim": fim,
        "valor_total": valor,
        "responsavel": project.responsavel,
    }
    dados.update({k: v for k, v in overrides.items() if v not in (None, "")})
    return ContratoServico.objects.create(tenant_id=tenant_id, **dados)


# ─── Integração com Compras ──────────────────────────────────────────────────


def conta_a_pagar_do_pedido(pedido) -> LancamentoFinanceiro | None:
    """
    Pedido de compra entregue → conta a pagar (vence em 30 dias), ligada ao
    projeto do pedido. Idempotente; pedido sem valor não gera lançamento.
    """
    orcamento = pedido.orcamento
    if not orcamento.valor_total:
        return None
    ref = f"pedido:{pedido.id}"
    existente = LancamentoFinanceiro.objects.filter(
        tenant_id=pedido.tenant_id, referencia_origem=ref
    ).first()
    if existente:
        return existente
    entregue = (pedido.entregue_em or timezone.now()).date()
    numero = pedido.numero_pedido or pedido.id
    return LancamentoFinanceiro.objects.create(
        tenant_id=pedido.tenant_id,
        descricao=f"Pedido de compra {numero} — {orcamento.fornecedor.nome}",
        tipo="despesa",
        valor=orcamento.valor_total,
        vencimento=entregue + timedelta(days=30),
        status="pendente",
        categoria="operacional",
        fornecedor_nome=orcamento.fornecedor.nome,
        numero_documento=pedido.numero_pedido or "",
        projeto=pedido.project,
        origem="compra",
        referencia_origem=ref,
    )


# ─── Nota fiscal: o que falta pra emitir ─────────────────────────────────────


def prontidao_nota_fiscal(tenant_id) -> dict:
    """
    Confere, com o que está no banco, o que uma NFS-e exige. Não chama
    nenhum serviço externo. O último item (emissor) é sempre pendente: este
    boilerplate ainda não transmite nota — ver docs/NOTA_FISCAL.md.
    """
    e = dados_empresa(tenant_id)
    cnpj = "".join(c for c in e.cnpj if c.isdigit())
    checks = [
        (
            "empresa_cnpj",
            "CNPJ da empresa emitente",
            len(cnpj) == 14,
            "Informe o CNPJ (14 dígitos).",
        ),
        ("empresa_razao", "Razão social", bool(e.razao_social), "Informe a razão social."),
        (
            "empresa_im",
            "Inscrição municipal",
            bool(e.inscricao_municipal),
            "NFS-e exige a inscrição municipal do prestador.",
        ),
        (
            "empresa_regime",
            "Regime tributário",
            bool(e.regime_tributario),
            "Simples, Presumido, Real ou MEI — define ISS/retenções.",
        ),
        (
            "empresa_endereco",
            "Endereço e código IBGE do município",
            bool(e.logradouro and e.municipio and e.uf and len(e.codigo_municipio_ibge) == 7),
            "Endereço completo e o código IBGE (7 dígitos) do município.",
        ),
        (
            "empresa_servico",
            "Código de serviço padrão (LC 116) e alíquota de ISS",
            bool(e.codigo_servico_padrao) and e.aliquota_iss_padrao > 0,
            "Usado quando o item de serviço não tem código próprio.",
        ),
    ]
    sem_codigo = ItemEstoque.objects.filter(
        tenant_id=tenant_id,
        is_active=True,
        tipo_item=ItemEstoque.TipoItem.SERVICO,
        codigo_servico="",
    ).count()
    checks.append(
        (
            "itens_servico",
            "Itens de serviço com código de serviço",
            sem_codigo == 0,
            f"{sem_codigo} item(ns) de serviço sem código." if sem_codigo else "",
        )
    )
    clientes_contrato = ParceiroNegocio.objects.filter(
        tenant_id=tenant_id,
        is_active=True,
        contratos__status=ContratoServico.Status.ATIVO,
        contratos__is_active=True,
    ).distinct()
    incompletos = [
        p.nome
        for p in clientes_contrato
        if len(p.documento_digitos) not in (11, 14) or not p.municipio or not p.uf
    ]
    checks.append(
        (
            "tomadores",
            "Clientes dos contratos ativos com CPF/CNPJ e endereço",
            not incompletos,
            ", ".join(incompletos[:5]),
        )
    )
    checks.append(
        (
            "certificado",
            "Certificado digital A1 (e-CNPJ) e credenciamento no município",
            False,
            "Fora do sistema: contratar o certificado e habilitar a emissão.",
        )
    )
    checks.append(
        (
            "emissor",
            "Integração com o emissor (Emissor Nacional ou provedor de API)",
            False,
            "Ainda não implementada neste boilerplate — ver docs/NOTA_FISCAL.md.",
        )
    )
    itens = [
        {"id": i, "label": label, "ok": ok, "detalhe": "" if ok else det}
        for i, label, ok, det in checks
    ]
    return {"pronto": all(i["ok"] for i in itens), "itens": itens}
