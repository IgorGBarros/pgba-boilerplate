import { useState, useEffect, useCallback } from "react";
import {
  Package, Plus, Trash2, Search, CheckCircle2, XCircle,
  SendHorizonal, ThumbsUp, ThumbsDown, RefreshCw, ShoppingCart,
  MapPin, Phone, Globe, AlertTriangle,
} from "lucide-react";
import {
  listItensNecessarios, createItemNecessario, updateItemNecessario, deleteItemNecessario,
  listOrcamentos, buscarFornecedoresOSM, criarOrcamentoCompleto,
  enviarOrcamento, aprovarOrcamento, rejeitarOrcamento, gerarPedidoCompra,
  ItemNecessario, Orcamento, FornecedorCompras,
} from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  recebido: "Resposta Recebida",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
};

const STATUS_COLORS: Record<string, string> = {
  rascunho: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  enviado: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  recebido: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  aprovado: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejeitado: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

function fmtBRL(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface Props {
  dealId: number;
  dealTitulo?: string;
}

export function CRMPreCompra({ dealId }: Props) {
  const [itens, setItens] = useState<ItemNecessario[]>([]);
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [loading, setLoading] = useState(true);

  // Novo item
  const [novoItem, setNovoItem] = useState({ nome: "", quantidade: "1", unidade: "un", categoria: "" });
  const [adicionandoItem, setAdicionandoItem] = useState(false);

  // Busca OSM
  const [buscaMaterial, setBuscaMaterial] = useState("");
  const [buscaCidade, setBuscaCidade] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [fornecedoresEncontrados, setFornecedoresEncontrados] = useState<FornecedorCompras[]>([]);

  // Criar orçamento
  const [fornecedorSelecionado, setFornecedorSelecionado] = useState<FornecedorCompras | null>(null);
  const [criandoOrc, setCriandoOrc] = useState(false);

  // Aprovação
  const [aprovandoPor, setAprovandoPor] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [its, orcs] = await Promise.all([
        listItensNecessarios(dealId),
        listOrcamentos(dealId),
      ]);
      setItens(its);
      setOrcamentos(orcs);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);

  const itensFaltando = itens.filter(i => i.quantidade_faltando > 0);

  async function adicionarItem() {
    if (!novoItem.nome.trim()) return;
    setAdicionandoItem(true);
    try {
      const item = await createItemNecessario({
        deal: dealId,
        nome: novoItem.nome.trim(),
        quantidade: parseFloat(novoItem.quantidade) || 1,
        unidade: novoItem.unidade || "un",
        categoria: novoItem.categoria,
        tem_estoque: false,
        quantidade_estoque: 0,
      });
      setItens(prev => [...prev, item]);
      setNovoItem({ nome: "", quantidade: "1", unidade: "un", categoria: "" });
    } finally {
      setAdicionandoItem(false);
    }
  }

  async function toggleEstoque(item: ItemNecessario) {
    const updated = await updateItemNecessario(item.id, { tem_estoque: !item.tem_estoque });
    setItens(prev => prev.map(i => i.id === item.id ? updated : i));
  }

  async function removerItem(id: number) {
    await deleteItemNecessario(id);
    setItens(prev => prev.filter(i => i.id !== id));
  }

  async function buscarFornecedores() {
    if (!buscaMaterial.trim() || !buscaCidade.trim()) return;
    setBuscando(true);
    setFornecedoresEncontrados([]);
    try {
      const results = await buscarFornecedoresOSM(buscaMaterial.trim(), buscaCidade.trim());
      setFornecedoresEncontrados(results);
    } catch {
      setFornecedoresEncontrados([]);
    } finally {
      setBuscando(false);
    }
  }

  async function criarOrcamento(fornecedor: FornecedorCompras) {
    if (itensFaltando.length === 0) return;
    setCriandoOrc(true);
    setFornecedorSelecionado(fornecedor);
    try {
      const itensPayload = itensFaltando.map(i => ({
        item_necessario_id: i.id,
        nome: i.nome,
        quantidade: i.quantidade_faltando,
        unidade: i.unidade,
      }));
      const orc = await criarOrcamentoCompleto(dealId, fornecedor.id, itensPayload);
      setOrcamentos(prev => [orc, ...prev]);
    } finally {
      setCriandoOrc(false);
      setFornecedorSelecionado(null);
    }
  }

  async function enviar(id: number) {
    const orc = await enviarOrcamento(id);
    setOrcamentos(prev => prev.map(o => o.id === id ? orc : o));
  }

  async function aprovar(id: number) {
    if (!aprovandoPor.trim()) return;
    const orc = await aprovarOrcamento(id, aprovandoPor.trim());
    setOrcamentos(prev => prev.map(o => o.id === id ? orc : o));
  }

  async function rejeitar(id: number) {
    const orc = await rejeitarOrcamento(id);
    setOrcamentos(prev => prev.map(o => o.id === id ? orc : o));
  }

  async function gerarPedido(orcId: number) {
    await gerarPedidoCompra(orcId);
    void load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">

      {/* ── Itens necessários ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Package className="size-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-foreground">Materiais Necessários</h3>
          <span className="ml-auto text-xs text-muted-foreground">
            {itensFaltando.length} item{itensFaltando.length !== 1 ? "s" : ""} faltando
          </span>
        </div>

        <div className="space-y-2">
          {itens.map(item => (
            <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
              <button
                onClick={() => void toggleEstoque(item)}
                className="shrink-0"
                title={item.tem_estoque ? "Tem no estoque" : "Faltando"}
              >
                {item.tem_estoque
                  ? <CheckCircle2 className="size-4 text-emerald-500" />
                  : <XCircle className="size-4 text-amber-500" />}
              </button>
              <span className="flex-1 font-medium text-foreground">{item.nome}</span>
              <span className="text-muted-foreground tabular-nums">{item.quantidade} {item.unidade}</span>
              {!item.tem_estoque && (
                <span className="text-[11px] text-amber-600 dark:text-amber-400">
                  falta {item.quantidade_faltando} {item.unidade}
                </span>
              )}
              <button onClick={() => void removerItem(item.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Adicionar item */}
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Nome do material"
            value={novoItem.nome}
            onChange={e => setNovoItem(p => ({ ...p, nome: e.target.value }))}
            onKeyDown={e => e.key === "Enter" && void adicionarItem()}
          />
          <input
            className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Qtd"
            value={novoItem.quantidade}
            onChange={e => setNovoItem(p => ({ ...p, quantidade: e.target.value }))}
          />
          <input
            className="w-14 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="un"
            value={novoItem.unidade}
            onChange={e => setNovoItem(p => ({ ...p, unidade: e.target.value }))}
          />
          <button
            onClick={() => void adicionarItem()}
            disabled={adicionandoItem || !novoItem.nome.trim()}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <Plus className="size-3.5" />
            Adicionar
          </button>
        </div>
      </section>

      {/* ── Buscar fornecedores OSM ── */}
      {itensFaltando.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Search className="size-4 text-blue-500" />
            <h3 className="text-sm font-semibold text-foreground">Buscar Fornecedores</h3>
            <span className="text-[10px] text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">OpenStreetMap · gratuito</span>
          </div>
          <div className="flex gap-2 mb-3">
            <input
              className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Material (ex: fios elétricos, cimento...)"
              value={buscaMaterial}
              onChange={e => setBuscaMaterial(e.target.value)}
            />
            <input
              className="w-40 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Cidade"
              value={buscaCidade}
              onChange={e => setBuscaCidade(e.target.value)}
            />
            <button
              onClick={() => void buscarFornecedores()}
              disabled={buscando || !buscaMaterial.trim() || !buscaCidade.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {buscando ? <RefreshCw className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
              Buscar
            </button>
          </div>

          {fornecedoresEncontrados.length > 0 && (
            <div className="space-y-2">
              {fornecedoresEncontrados.map(f => (
                <div key={f.id} className="rounded-xl border border-border bg-card p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{f.nome}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      {f.endereco && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <MapPin className="size-3" />{f.endereco}
                        </span>
                      )}
                      {f.telefone && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Phone className="size-3" />{f.telefone}
                        </span>
                      )}
                      {f.website && (
                        <a href={f.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-blue-500">
                          <Globe className="size-3" />Site
                        </a>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => void criarOrcamento(f)}
                    disabled={criandoOrc && fornecedorSelecionado?.id === f.id}
                    className="shrink-0 flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    {criandoOrc && fornecedorSelecionado?.id === f.id
                      ? <RefreshCw className="size-3 animate-spin" />
                      : <Plus className="size-3" />}
                    Orçar
                  </button>
                </div>
              ))}
            </div>
          )}

          {!buscando && buscaMaterial && buscaCidade && fornecedoresEncontrados.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              Nenhum fornecedor encontrado. Tente outro material ou cidade.
            </p>
          )}
        </section>
      )}

      {/* ── Orçamentos ── */}
      {orcamentos.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <ShoppingCart className="size-4 text-emerald-500" />
            <h3 className="text-sm font-semibold text-foreground">Orçamentos</h3>
          </div>

          {/* Aprovado por (CEO) — exibido quando há orçamento em recebido/rascunho */}
          {orcamentos.some(o => ["rascunho", "recebido"].includes(o.status)) && (
            <div className="mb-3 flex gap-2 items-center">
              <input
                className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Seu nome para aprovar (CEO)"
                value={aprovandoPor}
                onChange={e => setAprovandoPor(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-3">
            {orcamentos.map(orc => (
              <div key={orc.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-foreground">{orc.fornecedor_nome}</p>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[orc.status]}`}>
                    {STATUS_LABELS[orc.status]}
                  </span>
                </div>

                {orc.valor_total != null && (
                  <p className="text-lg font-bold text-foreground tabular-nums mb-1">
                    {fmtBRL(orc.valor_total)}
                    {orc.prazo_entrega_dias && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">· {orc.prazo_entrega_dias} dias</span>
                    )}
                  </p>
                )}

                {/* Itens */}
                {orc.itens.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {orc.itens.map(it => (
                      <div key={it.id} className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{it.nome} × {it.quantidade} {it.unidade}</span>
                        {it.preco_unitario != null && (
                          <span className="tabular-nums">{fmtBRL(it.subtotal)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Ações */}
                <div className="flex gap-2 mt-3 flex-wrap">
                  {orc.status === "rascunho" && (
                    <button
                      onClick={() => void enviar(orc.id)}
                      className="flex items-center gap-1 text-xs rounded-lg bg-blue-600 px-2.5 py-1.5 text-white hover:bg-blue-700 transition-colors"
                    >
                      <SendHorizonal className="size-3" />Enviar ao fornecedor
                    </button>
                  )}
                  {["rascunho", "recebido"].includes(orc.status) && (
                    <>
                      <button
                        onClick={() => void aprovar(orc.id)}
                        disabled={!aprovandoPor.trim()}
                        className="flex items-center gap-1 text-xs rounded-lg bg-emerald-600 px-2.5 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        <ThumbsUp className="size-3" />Aprovar
                      </button>
                      <button
                        onClick={() => void rejeitar(orc.id)}
                        className="flex items-center gap-1 text-xs rounded-lg bg-red-600 px-2.5 py-1.5 text-white hover:bg-red-700 transition-colors"
                      >
                        <ThumbsDown className="size-3" />Rejeitar
                      </button>
                    </>
                  )}
                  {orc.status === "aprovado" && !("pedido" in orc) && (
                    <button
                      onClick={() => void gerarPedido(orc.id)}
                      className="flex items-center gap-1 text-xs rounded-lg bg-indigo-600 px-2.5 py-1.5 text-white hover:bg-indigo-700 transition-colors"
                    >
                      <ShoppingCart className="size-3" />Gerar Pedido de Compra
                    </button>
                  )}
                </div>

                {orc.aprovado_por && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Aprovado por <span className="font-medium">{orc.aprovado_por}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {itens.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
          <AlertTriangle className="size-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">Nenhum material cadastrado ainda.</p>
          <p className="text-xs text-muted-foreground/70">
            Adicione os materiais necessários para o projeto e verifique o estoque.
          </p>
        </div>
      )}
    </div>
  );
}
