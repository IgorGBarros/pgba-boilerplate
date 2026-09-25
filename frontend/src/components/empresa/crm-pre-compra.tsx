import { useState, useEffect, useCallback } from "react";
import {
  Package, Plus, Trash2, Search, CheckCircle2, XCircle,
  SendHorizonal, ThumbsUp, ThumbsDown, RefreshCw, ShoppingCart,
  MapPin, Phone, Globe, AlertTriangle, Sparkles, Star, Pencil, X,
} from "lucide-react";
import {
  listItensNecessarios, createItemNecessario, updateItemNecessario, deleteItemNecessario,
  listOrcamentos, buscarFornecedoresOSM, criarOrcamentoCompleto,
  enviarOrcamento, aprovarOrcamento, rejeitarOrcamento, gerarPedidoCompra,
  recomendarFornecedor, updateOrcamento, deleteOrcamento, listEstoque,
  ItemNecessario, Orcamento, FornecedorCompras, RecomendacaoOrcamento, ItemEstoque,
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

function fmtDate(s: string | null | undefined) {
  if (!s) return null;
  return new Date(s + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

interface Props {
  dealId: number;
  dealTitulo?: string;
}

export function CRMPreCompra({ dealId }: Props) {
  const [itens, setItens] = useState<ItemNecessario[]>([]);
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [estoque, setEstoque] = useState<ItemEstoque[]>([]);
  const [loading, setLoading] = useState(true);

  // Novo item
  const [novoItem, setNovoItem] = useState({ nome: "", quantidade: "1", unidade: "un", categoria: "" });
  const [adicionandoItem, setAdicionandoItem] = useState(false);

  // Busca OSM
  const [buscaMaterial, setBuscaMaterial] = useState("");
  const [buscaCidade, setBuscaCidade] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [fornecedoresEncontrados, setFornecedoresEncontrados] = useState<FornecedorCompras[]>([]);
  const [selecionadosOSM, setSelecionadosOSM] = useState<Set<number>>(new Set());
  const [cadastrando, setCadastrando] = useState(false);

  // Criar orçamento
  const [fornecedorSelecionado, setFornecedorSelecionado] = useState<FornecedorCompras | null>(null);
  const [criandoOrc, setCriandoOrc] = useState(false);

  // Aprovação
  const [aprovandoPor, setAprovandoPor] = useState("");

  // Recomendação de fornecedor
  const [recomendacao, setRecomendacao] = useState<RecomendacaoOrcamento | null>(null);
  const [carregandoRec, setCarregandoRec] = useState(false);

  // Edição de orçamento
  const [editandoOrc, setEditandoOrc] = useState<Orcamento | null>(null);
  const [editOrcForm, setEditOrcForm] = useState({ valor_total: "", prazo_entrega_dias: "", observacoes: "" });
  const [salvandoOrc, setSalvandoOrc] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [its, orcs, stq] = await Promise.all([
        listItensNecessarios(dealId),
        listOrcamentos(dealId),
        listEstoque(),
      ]);
      setItens(its);
      setOrcamentos(orcs);
      setEstoque(stq);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);

  const itensFaltando = itens.filter(i => i.quantidade_faltando > 0);

  function estoqueParaItem(nome: string): ItemEstoque | undefined {
    const n = nome.trim().toLowerCase();
    return estoque.find(e => e.nome.trim().toLowerCase() === n);
  }

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
    setSelecionadosOSM(new Set());
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

  function toggleOSM(id: number) {
    setSelecionadosOSM(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllOSM() {
    if (selecionadosOSM.size === fornecedoresEncontrados.length) {
      setSelecionadosOSM(new Set());
    } else {
      setSelecionadosOSM(new Set(fornecedoresEncontrados.map(f => f.id)));
    }
  }

  async function cadastrarSelecionados() {
    if (selecionadosOSM.size === 0 || itensFaltando.length === 0) return;
    setCadastrando(true);
    try {
      const selecionados = fornecedoresEncontrados.filter(f => selecionadosOSM.has(f.id));
      const itensPayload = itensFaltando.map(i => ({
        item_necessario_id: i.id,
        nome: i.nome,
        quantidade: i.quantidade_faltando,
        unidade: i.unidade,
      }));
      const novos = await Promise.all(
        selecionados.map(f => criarOrcamentoCompleto(dealId, f.id, itensPayload))
      );
      setOrcamentos(prev => [...novos, ...prev]);
      setSelecionadosOSM(new Set());
    } finally {
      setCadastrando(false);
    }
  }

  function limparBusca() {
    setFornecedoresEncontrados([]);
    setSelecionadosOSM(new Set());
    setBuscaMaterial("");
    setBuscaCidade("");
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

  async function buscarRecomendacao() {
    setCarregandoRec(true);
    setRecomendacao(null);
    try {
      const rec = await recomendarFornecedor(dealId);
      setRecomendacao(rec);
    } catch {
      // silent
    } finally {
      setCarregandoRec(false);
    }
  }

  function abrirEditOrc(orc: Orcamento) {
    setEditandoOrc(orc);
    setEditOrcForm({
      valor_total: orc.valor_total != null ? String(orc.valor_total) : "",
      prazo_entrega_dias: orc.prazo_entrega_dias != null ? String(orc.prazo_entrega_dias) : "",
      observacoes: orc.observacoes ?? "",
    });
  }

  async function salvarEditOrc() {
    if (!editandoOrc) return;
    setSalvandoOrc(true);
    try {
      const updated = await updateOrcamento(editandoOrc.id, {
        valor_total: editOrcForm.valor_total ? (parseFloat(editOrcForm.valor_total) as unknown as null) : null,
        prazo_entrega_dias: editOrcForm.prazo_entrega_dias ? parseInt(editOrcForm.prazo_entrega_dias) : null,
        observacoes: editOrcForm.observacoes,
      });
      setOrcamentos(prev => prev.map(o => o.id === updated.id ? updated : o));
      setEditandoOrc(null);
    } finally {
      setSalvandoOrc(false);
    }
  }

  async function excluirOrc(id: number) {
    await deleteOrcamento(id);
    setOrcamentos(prev => prev.filter(o => o.id !== id));
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
          {itens.map(item => {
            const emEstoque = estoqueParaItem(item.nome);
            return (
              <div key={item.id} className="rounded-lg border border-border/60 px-3 py-2.5 text-sm">
                <div className="flex items-center gap-3">
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
                {/* Informações de estoque cruzado */}
                {emEstoque && (
                  <div className="mt-1.5 ml-7 flex flex-wrap gap-x-4 gap-y-0.5">
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                      Em estoque: {emEstoque.quantidade} {emEstoque.unidade}
                    </span>
                    {Number(emEstoque.custo_medio) > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        Custo médio: {Number(emEstoque.custo_medio).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </span>
                    )}
                    {emEstoque.data_ultima_compra && (
                      <span className="text-[11px] text-muted-foreground">
                        Última compra: {fmtDate(emEstoque.data_ultima_compra)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
            <>
              {/* Barra de ações para seleção */}
              <div className="flex items-center justify-between mb-2 gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selecionadosOSM.size === fornecedoresEncontrados.length && fornecedoresEncontrados.length > 0}
                    onChange={toggleAllOSM}
                    className="rounded"
                  />
                  Selecionar todos ({fornecedoresEncontrados.length})
                </label>
                <div className="flex gap-2">
                  {selecionadosOSM.size > 0 && (
                    <button
                      onClick={() => void cadastrarSelecionados()}
                      disabled={cadastrando || itensFaltando.length === 0}
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      {cadastrando ? <RefreshCw className="size-3 animate-spin" /> : <ShoppingCart className="size-3" />}
                      Orçar selecionados ({selecionadosOSM.size})
                    </button>
                  )}
                  <button
                    onClick={limparBusca}
                    className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                  >
                    <X className="size-3" />
                    Limpar busca
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {fornecedoresEncontrados.map(f => (
                  <div
                    key={f.id}
                    className={`rounded-xl border bg-card p-3 flex items-start gap-3 transition-colors ${selecionadosOSM.has(f.id) ? "border-blue-400/60 bg-blue-500/5" : "border-border"}`}
                  >
                    <input
                      type="checkbox"
                      checked={selecionadosOSM.has(f.id)}
                      onChange={() => toggleOSM(f.id)}
                      className="mt-1 rounded"
                    />
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
            </>
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
            {orcamentos.filter(o => o.status === "recebido").length >= 2 && (
              <button
                onClick={() => void buscarRecomendacao()}
                disabled={carregandoRec}
                className="ml-auto flex items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {carregandoRec ? <RefreshCw className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                Recomendar
              </button>
            )}
          </div>

          {/* Painel de recomendação */}
          {recomendacao && (
            <div className="mb-3 rounded-xl border border-violet-400/40 bg-violet-500/10 p-3">
              <div className="flex items-start gap-2">
                <Sparkles className="size-4 text-violet-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-1">Nossa recomendação</p>
                  <p className="text-sm font-bold text-foreground">{recomendacao.fornecedor_nome}</p>
                  <div className="flex items-center gap-3 mt-1">
                    {recomendacao.valor_total != null && (
                      <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {Number(recomendacao.valor_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </span>
                    )}
                    {recomendacao.prazo_entrega_dias != null && (
                      <span className="text-xs text-muted-foreground">{recomendacao.prazo_entrega_dias} dias</span>
                    )}
                    {recomendacao.score != null && (
                      <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                        <Star className="size-3" />
                        {Number(recomendacao.score).toFixed(1)}/10
                      </span>
                    )}
                  </div>
                  {recomendacao.motivo && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground italic">{recomendacao.motivo}</p>
                  )}
                </div>
                <button onClick={() => setRecomendacao(null)} className="text-muted-foreground hover:text-foreground text-xs shrink-0">✕</button>
              </div>
            </div>
          )}

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
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[orc.status]}`}>
                      {STATUS_LABELS[orc.status]}
                    </span>
                    {/* Editar orçamento (recebido) */}
                    {orc.status === "recebido" && (
                      <button
                        onClick={() => abrirEditOrc(orc)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Editar orçamento"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    {/* Deletar orçamento */}
                    {["rascunho", "rejeitado"].includes(orc.status) && (
                      <button
                        onClick={() => void excluirOrc(orc.id)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-red-500/10 transition-colors"
                        title="Excluir orçamento"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
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

      {/* ── Modal edição de orçamento ── */}
      {editandoOrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-background rounded-2xl border border-border shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Editar Orçamento</h3>
              <button onClick={() => setEditandoOrc(null)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{editandoOrc.fornecedor_nome}</p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Valor Total (R$)</label>
                <input
                  type="number"
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="0.00"
                  value={editOrcForm.valor_total}
                  onChange={e => setEditOrcForm(p => ({ ...p, valor_total: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Prazo de entrega (dias)</label>
                <input
                  type="number"
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Ex: 7"
                  value={editOrcForm.prazo_entrega_dias}
                  onChange={e => setEditOrcForm(p => ({ ...p, prazo_entrega_dias: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Observações</label>
                <textarea
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                  rows={3}
                  placeholder="Condições, garantias, etc."
                  value={editOrcForm.observacoes}
                  onChange={e => setEditOrcForm(p => ({ ...p, observacoes: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setEditandoOrc(null)}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => void salvarEditOrc()}
                disabled={salvandoOrc}
                className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {salvandoOrc ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
