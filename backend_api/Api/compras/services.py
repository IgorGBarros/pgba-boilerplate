from django.utils import timezone

from compras.models import Fornecedor, ItemNecessario, Orcamento, ItemOrcamento, PedidoCompra
from integrations.overpass import buscar_fornecedores_osm


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
