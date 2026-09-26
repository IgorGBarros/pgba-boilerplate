from django.utils import timezone

from compras.models import Fornecedor, ItemNecessario, Orcamento, ItemOrcamento, PedidoCompra
from integrations.overpass import buscar_fornecedores_osm


def recomendar_melhor_orcamento(deal_id: int, tenant_id: str) -> dict | None:
    """
    Compara orçamentos com resposta recebida para um deal e recomenda o melhor.
    Score = preço×0.4 + prazo×0.3 + histórico_fornecedor×0.3
    Retorna dict com orcamento_id, motivo e score, ou None se não houver dados.
    """
    candidatos = list(
        Orcamento.objects.filter(
            deal_id=deal_id,
            tenant_id=tenant_id,
            status__in=[Orcamento.Status.RECEBIDO, Orcamento.Status.RASCUNHO],
        ).select_related("fornecedor").exclude(valor_total__isnull=True)
    )
    if not candidatos:
        return None

    precos = [float(o.valor_total) for o in candidatos]
    prazos = [o.prazo_entrega_dias or 999 for o in candidatos]
    p_min, p_max = min(precos), max(precos)
    d_min, d_max = min(prazos), max(prazos)

    scored = []
    for orc, preco, prazo in zip(candidatos, precos, prazos):
        price_score = 10 * (1 - (preco - p_min) / (p_max - p_min + 0.01))
        prazo_score = 10 * (1 - (prazo - d_min) / (d_max - d_min + 0.01))
        hist_score = float(orc.fornecedor.nota_media)
        total = price_score * 0.4 + prazo_score * 0.3 + hist_score * 0.3
        scored.append((total, orc, preco, prazo))

    scored.sort(key=lambda x: -x[0])
    best_score, best_orc, best_preco, best_prazo = scored[0]

    motivo_parts = []
    if len(scored) > 1:
        segundo = scored[1]
        if best_preco <= segundo[2]:
            motivo_parts.append("melhor preço")
        if best_prazo <= segundo[3]:
            motivo_parts.append("prazo competitivo")
    if best_orc.fornecedor.total_pedidos > 0:
        taxa = best_orc.fornecedor.pedidos_no_prazo / best_orc.fornecedor.total_pedidos
        if taxa >= 0.8:
            motivo_parts.append(f"histórico confiável ({int(taxa*100)}% no prazo)")
    if not motivo_parts:
        motivo_parts = ["melhor equilíbrio entre preço, prazo e histórico"]
    motivo = "Melhor equilíbrio: " + ", ".join(motivo_parts) + "."

    # Persiste o score no próprio orçamento
    best_orc.score_recomendacao = round(best_score, 3)
    best_orc.recomendacao_motivo = motivo
    best_orc.save(update_fields=["score_recomendacao", "recomendacao_motivo"])

    return {
        "orcamento_id": best_orc.id,
        "fornecedor_nome": best_orc.fornecedor.nome,
        "valor_total": float(best_orc.valor_total),
        "prazo_entrega_dias": best_orc.prazo_entrega_dias,
        "motivo": motivo,
        "score": round(best_score, 3),
    }


# Progressão de status linear do PedidoCompra
_STATUS_FLOW = [
    PedidoCompra.Status.CRIADO,
    PedidoCompra.Status.ENVIADO,
    PedidoCompra.Status.CONFIRMADO,
    PedidoCompra.Status.EM_TRANSITO,
    PedidoCompra.Status.ENTREGUE,
]


def avancar_status_pedido(pedido_id: int, tenant_id: str) -> PedidoCompra:
    """Avança o status do pedido para o próximo na progressão linear."""
    pedido = PedidoCompra.objects.get(pk=pedido_id, tenant_id=tenant_id)
    if pedido.status == PedidoCompra.Status.CANCELADO:
        raise ValueError("Pedido cancelado não pode ser avançado.")
    try:
        idx = _STATUS_FLOW.index(pedido.status)
    except ValueError:
        raise ValueError(f"Status '{pedido.status}' não é avançável.")
    if idx >= len(_STATUS_FLOW) - 1:
        raise ValueError("Pedido já está no status final (Entregue).")

    novo_status = _STATUS_FLOW[idx + 1]
    agora = timezone.now()
    update_fields = ["status"]

    if novo_status == PedidoCompra.Status.CONFIRMADO:
        pedido.confirmado_em = agora
        update_fields.append("confirmado_em")
    elif novo_status == PedidoCompra.Status.EM_TRANSITO:
        pedido.em_transito_em = agora
        update_fields.append("em_transito_em")
    elif novo_status == PedidoCompra.Status.ENTREGUE:
        pedido.entregue_em = agora
        update_fields.append("entregue_em")

    pedido.status = novo_status
    pedido.save(update_fields=update_fields)

    if novo_status == PedidoCompra.Status.ENTREGUE:
        atualizar_score_fornecedor(pedido)
        # Integração com o ERP: entregue vira conta a pagar (idempotente)
        from erp.services import conta_a_pagar_do_pedido

        conta_a_pagar_do_pedido(pedido)

    return pedido


def atualizar_score_fornecedor(pedido: PedidoCompra) -> None:
    """Atualiza nota_media e prazo_medio_dias do fornecedor com base na entrega."""
    fornecedor = pedido.orcamento.fornecedor
    fornecedor.total_pedidos += 1

    no_prazo = False
    if pedido.previsao_entrega and pedido.entregue_em:
        no_prazo = pedido.entregue_em.date() <= pedido.previsao_entrega
    if no_prazo:
        fornecedor.pedidos_no_prazo += 1

    # Prazo médio real (dias entre criado_em e entregue_em)
    if pedido.entregue_em and pedido.created_at:
        dias_real = (pedido.entregue_em.date() - pedido.created_at.date()).days
        if fornecedor.prazo_medio_dias is None:
            fornecedor.prazo_medio_dias = dias_real
        else:
            # Média exponencial simples
            fornecedor.prazo_medio_dias = round(
                0.7 * fornecedor.prazo_medio_dias + 0.3 * dias_real
            )

    # nota_media = taxa de entrega no prazo * 10
    taxa = fornecedor.pedidos_no_prazo / fornecedor.total_pedidos
    fornecedor.nota_media = round(taxa * 10, 2)

    fornecedor.save(update_fields=["total_pedidos", "pedidos_no_prazo", "prazo_medio_dias", "nota_media"])


def buscar_e_salvar_fornecedores(tenant_id: str, material: str, cidade: str, raio_km: int = 10) -> list[Fornecedor]:
    """
    Busca fornecedores via OpenStreetMap e salva os novos no banco.
    Não duplica por osm_id (upsert).
    """
    resultados = buscar_fornecedores_osm(material, cidade, raio_km=raio_km, limite=10)
    fornecedores = []
    for r in resultados:
        if r.get("osm_id"):
            obj, _ = Fornecedor.objects.update_or_create(
                tenant_id=tenant_id,
                osm_id=r["osm_id"],
                defaults={
                    "nome": r["nome"],
                    "endereco": r.get("endereco", ""),
                    "cidade": r.get("cidade", cidade),
                    "estado": r.get("estado", ""),
                    "telefone": r.get("telefone", ""),
                    "email": r.get("email", ""),
                    "website": r.get("website", ""),
                    "latitude": r.get("latitude"),
                    "longitude": r.get("longitude"),
                    "source": Fornecedor.Source.OPENSTREETMAP,
                    "categoria": r.get("categoria", material),
                },
            )
        else:
            obj = Fornecedor.objects.create(
                tenant_id=tenant_id,
                nome=r["nome"],
                endereco=r.get("endereco", ""),
                cidade=r.get("cidade", cidade),
                estado=r.get("estado", ""),
                telefone=r.get("telefone", ""),
                email=r.get("email", ""),
                website=r.get("website", ""),
                latitude=r.get("latitude"),
                longitude=r.get("longitude"),
                source=Fornecedor.Source.OPENSTREETMAP,
                categoria=r.get("categoria", material),
            )
        fornecedores.append(obj)
    return fornecedores


def criar_orcamento(tenant_id: str, deal_id: int, fornecedor_id: int, itens: list[dict]) -> Orcamento:
    """
    Cria um Orcamento (rascunho) com seus itens para um Deal.
    itens: [{"item_necessario_id": int|None, "nome": str, "quantidade": float, "unidade": str}]
    """
    from crm.models import Deal
    deal = Deal.objects.get(pk=deal_id, tenant_id=tenant_id)
    fornecedor = Fornecedor.objects.get(pk=fornecedor_id, tenant_id=tenant_id)

    orc = Orcamento.objects.create(
        tenant_id=tenant_id,
        deal=deal,
        fornecedor=fornecedor,
        status=Orcamento.Status.RASCUNHO,
    )
    for item in itens:
        ItemOrcamento.objects.create(
            tenant_id=tenant_id,
            orcamento=orc,
            item_necessario_id=item.get("item_necessario_id"),
            nome=item["nome"],
            quantidade=item["quantidade"],
            unidade=item.get("unidade", "un"),
            preco_unitario=item.get("preco_unitario"),
        )
    return orc


def marcar_orcamento_enviado(orcamento_id: int, tenant_id: str) -> Orcamento:
    orc = Orcamento.objects.get(pk=orcamento_id, tenant_id=tenant_id)
    orc.status = Orcamento.Status.ENVIADO
    orc.enviado_em = timezone.now()
    orc.save(update_fields=["status", "enviado_em"])
    return orc


def registrar_resposta_orcamento(
    orcamento_id: int,
    tenant_id: str,
    valor_total: float,
    prazo_entrega_dias: int,
    itens_precos: list[dict],
    observacoes: str = "",
) -> Orcamento:
    """Registra resposta do fornecedor com valores."""
    orc = Orcamento.objects.get(pk=orcamento_id, tenant_id=tenant_id)
    orc.status = Orcamento.Status.RECEBIDO
    orc.valor_total = valor_total
    orc.prazo_entrega_dias = prazo_entrega_dias
    orc.observacoes = observacoes
    orc.resposta_em = timezone.now()
    orc.save(update_fields=["status", "valor_total", "prazo_entrega_dias", "observacoes", "resposta_em"])

    for ip in itens_precos:
        ItemOrcamento.objects.filter(
            pk=ip["id"], orcamento=orc
        ).update(preco_unitario=ip.get("preco_unitario"))

    return orc


def aprovar_orcamento(orcamento_id: int, tenant_id: str, aprovado_por: str) -> Orcamento:
    orc = Orcamento.objects.get(pk=orcamento_id, tenant_id=tenant_id)
    if orc.status not in (Orcamento.Status.RECEBIDO, Orcamento.Status.RASCUNHO):
        raise ValueError(f"Orçamento não pode ser aprovado no status '{orc.status}'.")
    orc.status = Orcamento.Status.APROVADO
    orc.aprovado_em = timezone.now()
    orc.aprovado_por = aprovado_por
    orc.save(update_fields=["status", "aprovado_em", "aprovado_por"])
    return orc


def rejeitar_orcamento(orcamento_id: int, tenant_id: str) -> Orcamento:
    orc = Orcamento.objects.get(pk=orcamento_id, tenant_id=tenant_id)
    orc.status = Orcamento.Status.REJEITADO
    orc.save(update_fields=["status"])
    return orc


def gerar_pedido_compra(orcamento_id: int, tenant_id: str, project_id: int | None = None) -> PedidoCompra:
    """Gera PedidoCompra a partir de orçamento aprovado."""
    orc = Orcamento.objects.get(pk=orcamento_id, tenant_id=tenant_id)
    if orc.status != Orcamento.Status.APROVADO:
        raise ValueError("Apenas orçamentos aprovados podem gerar pedido de compra.")
    if hasattr(orc, "pedido"):
        return orc.pedido

    from crm.models import Project
    project = None
    if project_id:
        project = Project.objects.filter(pk=project_id, tenant_id=tenant_id).first()

    pedido = PedidoCompra.objects.create(
        tenant_id=tenant_id,
        orcamento=orc,
        project=project,
        status=PedidoCompra.Status.CRIADO,
    )
    return pedido


# ─── E-mail ao fornecedor (pela caixa do setor Compras) ──────────────────────


def _setor_compras(tenant_id):
    from agency.models import Sector

    qs = Sector.objects.filter(tenant_id=tenant_id, is_active=True)
    return qs.filter(slug="compras").first() or qs.filter(name__iexact="Compras").first()


def _linhas_itens(itens) -> str:
    return "\n".join(
        f"- {i.nome}: {i.quantidade.normalize():f} {i.unidade}"
        + (f" (preço combinado: R$ {i.preco_unitario:.2f}/{i.unidade})" if i.preco_unitario else "")
        for i in itens
    )


def _empresa(tenant_id) -> str:
    from erp.models import DadosEmpresa

    d = DadosEmpresa.objects.filter(tenant_id=tenant_id).first()
    return (d.nome_fantasia or d.razao_social) if d else ""


def rascunho_email_cotacao(orcamento_id: int, tenant_id, requested_by: str = ""):
    """Pedido de cotação → RASCUNHO na caixa de Compras (uma pessoa envia)."""
    from integrations.email import create_draft

    orc = Orcamento.objects.select_related("fornecedor", "deal").get(pk=orcamento_id, tenant_id=tenant_id)
    if not orc.fornecedor.email:
        raise ValueError(f"O fornecedor {orc.fornecedor.nome} não tem e-mail cadastrado.")
    empresa = _empresa(tenant_id)
    corpo = (
        f"Olá, {orc.fornecedor.nome}.\n\n"
        f"{'A ' + empresa if empresa else 'Nossa empresa'} gostaria de uma cotação para os itens abaixo"
        f" (ref. {orc.deal.titulo}):\n\n{_linhas_itens(orc.itens.all())}\n\n"
        "Por favor, informe preço unitário, prazo de entrega e condições de pagamento.\n\n"
        "Obrigado!"
    )
    return create_draft(
        tenant_id,
        sector_id=getattr(_setor_compras(tenant_id), "id", None),
        to=[orc.fornecedor.email],
        subject=f"Pedido de cotação — {orc.deal.titulo}",
        body=corpo,
        origin=f"compras.orcamento:{orc.id}",
        requested_by=requested_by,
    )


def rascunho_email_pedido(pedido_id: int, tenant_id, requested_by: str = ""):
    """Pedido de compra fechado → RASCUNHO na caixa de Compras (uma pessoa envia)."""
    from integrations.email import create_draft

    pedido = PedidoCompra.objects.select_related("orcamento__fornecedor", "orcamento__deal").get(
        pk=pedido_id, tenant_id=tenant_id
    )
    orc = pedido.orcamento
    if not orc.fornecedor.email:
        raise ValueError(f"O fornecedor {orc.fornecedor.nome} não tem e-mail cadastrado.")
    numero = pedido.numero_pedido or f"#{pedido.id}"
    total = f"\nValor total: R$ {orc.valor_total:.2f}" if orc.valor_total else ""
    prazo = f"\nPrevisão de entrega: {pedido.previsao_entrega:%d/%m/%Y}" if pedido.previsao_entrega else ""
    corpo = (
        f"Olá, {orc.fornecedor.nome}.\n\n"
        f"Confirmamos o pedido de compra {numero}, conforme a cotação aprovada:\n\n"
        f"{_linhas_itens(orc.itens.all())}{total}{prazo}\n\n"
        "Por favor, confirme o recebimento deste pedido e a data de entrega.\n\nObrigado!"
    )
    return create_draft(
        tenant_id,
        sector_id=getattr(_setor_compras(tenant_id), "id", None),
        to=[orc.fornecedor.email],
        subject=f"Pedido de compra {numero} — {orc.deal.titulo}",
        body=corpo,
        origin=f"compras.pedido:{pedido.id}",
        requested_by=requested_by,
    )


def ao_enviar_email(sender, email, **kwargs):
    """E-mail saiu de verdade: cotação vira 'enviado'; pedido 'criado' vira 'enviado'."""
    kind, _, ident = (email.origin or "").partition(":")
    if not ident.isdigit():
        return
    if kind == "compras.orcamento":
        orc = Orcamento.objects.filter(
            pk=int(ident), tenant_id=email.tenant_id, status=Orcamento.Status.RASCUNHO
        ).first()
        if orc:  # save() (não update) pra ficar no histórico de auditoria
            orc.status, orc.enviado_em = Orcamento.Status.ENVIADO, email.sent_at
            orc.save(update_fields=["status", "enviado_em", "updated_at"])
    elif kind == "compras.pedido":
        pedido = PedidoCompra.objects.filter(
            pk=int(ident), tenant_id=email.tenant_id, status=PedidoCompra.Status.CRIADO
        ).first()
        if pedido:
            pedido.status = PedidoCompra.Status.ENVIADO
            pedido.save(update_fields=["status", "updated_at"])
