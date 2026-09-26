import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowLeft,
  ArrowUpCircle,
  BarChart2,
  BookOpen,
  Box,
  Briefcase,
  Building2,
  Calendar,
  ChevronRight,
  ClipboardList,
  Clock,
  DollarSign,
  Download,
  Edit2,
  FileSignature,
  FileText,
  Handshake,
  Layers,
  Loader2,
  Package,
  Plus,
  Receipt,
  Scale,
  Search,
  ShoppingCart,
  Truck,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X,
  CheckCircle2,
  Pencil,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Metric, SectionHeader } from "@/components/empresa/shared";
import {
  BalanceteCrud,
  DreCrud,
  FuncionariosCrud,
  ItensCrud,
  LancamentosCrud,
  NotasFiscaisCrud,
  ObrigacoesCrud,
  PainelNotaFiscal,
  TabContratos,
  TabParceiros,
} from "@/components/empresa/erp-modulos";
import {
  type ItemEstoque,
  type MovimentacaoEstoque,
  type LancamentoFinanceiro,
  type Funcionario,
  type NotaFiscal,
  type ObrigacaoFiscal,
  type LinhaDRE,
  type BalancetePeriodo,
  type PedidoCompra,
  type Orcamento,
  type FornecedorCompras,
  listEstoque,
  listMovimentacoesEstoque,
  registrarMovimentacao,
  listLancamentosFinanceiros,
  listFuncionarios,
  listNotasFiscais,
  listObrigacoesFiscais,
  listLinhasDRE,
  listBalancete,
  listPedidosCompra,
  createPedidoCompra,
  listTodosOrcamentos,
  listFornecedoresCompras,
  createFornecedorCompras,
  updateFornecedorCompras,
  deleteFornecedorCompras,
  buscarFornecedoresOSM,
} from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value: number, decimals = 2) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtBRL(value: number) {
  return `R$ ${fmt(Math.abs(value))}`;
}

function variacao(atual: number, anterior: number) {
  if (anterior === 0) return 0;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

// ─── Status badges ────────────────────────────────────────────────────────────

// ─── Status badge PedidoCompra ────────────────────────────────────────────────

function StatusBadgePedido({ status }: { status: PedidoCompra["status"] }) {
  const label: Record<PedidoCompra["status"], string> = {
    criado:      "Criado",
    enviado:     "Enviado",
    confirmado:  "Confirmado",
    em_transito: "Em Trânsito",
    entregue:    "Entregue",
    cancelado:   "Cancelado",
  };
  const map: Record<PedidoCompra["status"], string> = {
    criado:      "bg-secondary text-muted-foreground border border-border",
    enviado:     "bg-primary/10 text-primary border border-primary/20",
    confirmado:  "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20",
    em_transito: "bg-warning/15 text-amber-700 dark:text-amber-400",
    entregue:    "bg-success/15 text-foreground",
    cancelado:   "bg-destructive/20 text-destructive",
  };
  return <Badge className={`text-[11px] ${map[status]}`}>{label[status]}</Badge>;
}

function StatusBadgeOrcamento({ status }: { status: Orcamento["status"] }) {
  const label: Record<Orcamento["status"], string> = {
    rascunho:  "Rascunho",
    enviado:   "Enviado",
    recebido:  "Recebido",
    aprovado:  "Aprovado",
    rejeitado: "Rejeitado",
  };
  const map: Record<Orcamento["status"], string> = {
    rascunho:  "bg-secondary text-muted-foreground border border-border",
    enviado:   "bg-primary/10 text-primary border border-primary/20",
    recebido:  "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20",
    aprovado:  "bg-success/15 text-foreground",
    rejeitado: "bg-destructive/20 text-destructive",
  };
  return <Badge className={`text-[11px] ${map[status]}`}>{label[status]}</Badge>;
}

// ─── Tab: Compras (PedidoCompra do módulo Compras) ────────────────────────────

const PEDIDO_STATUS_OPTIONS = [
  { v: "criado",      l: "Criado" },
  { v: "enviado",     l: "Enviado" },
  { v: "confirmado",  l: "Confirmado" },
  { v: "em_transito", l: "Em Trânsito" },
  { v: "entregue",    l: "Entregue" },
  { v: "cancelado",   l: "Cancelado" },
] as const;

function ModalNovoPedido({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState({
    orcamento_id: "" as string | number,
    numero_pedido: "",
    status: "criado" as PedidoCompra["status"],
    previsao_entrega: "",
    observacoes: "",
  });

  useEffect(() => {
    listTodosOrcamentos().then(setOrcamentos).catch(() => {});
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const orcSelecionado = orcamentos.find((o) => String(o.id) === String(form.orcamento_id));

  const handleSave = async () => {
    if (!form.orcamento_id) { setErro("Selecione um orçamento."); return; }
    setSaving(true);
    setErro(null);
    try {
      await createPedidoCompra({
        orcamento: Number(form.orcamento_id),
        numero_pedido: form.numero_pedido || undefined,
        status: form.status,
        previsao_entrega: form.previsao_entrega || undefined,
        observacoes: form.observacoes || undefined,
      });
      onSaved();
      onClose();
    } catch {
      setErro("Erro ao salvar pedido. Verifique os dados.");
    } finally {
      setSaving(false);
    }
  };

  const fmtOrcLabel = (o: Orcamento) => {
    const partes = [o.fornecedor_nome ?? `Orç. #${o.id}`];
    if (o.valor_total != null) partes.push(`R$ ${Number(o.valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
    partes.push(`(${o.status})`);
    return partes.join(" · ");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl bg-background border border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Novo Pedido de Compra</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Orçamento (obrigatório — deriva fornecedor e valor) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Orçamento *</label>
            <Select value={String(form.orcamento_id)} onValueChange={(v) => set("orcamento_id", v)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Selecione um orçamento…" />
              </SelectTrigger>
              <SelectContent>
                {orcamentos.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)} className="text-sm">
                    {fmtOrcLabel(o)}
                  </SelectItem>
                ))}
                {orcamentos.length === 0 && (
                  <SelectItem value="__none" disabled className="text-xs text-muted-foreground">
                    Nenhum orçamento disponível
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Resumo do orçamento selecionado */}
          {orcSelecionado && (
            <div className="rounded-lg bg-muted/40 border border-border px-3 py-2 text-xs space-y-0.5">
              <p><span className="text-muted-foreground">Fornecedor:</span> <span className="font-medium text-foreground">{orcSelecionado.fornecedor_nome}</span></p>
              {orcSelecionado.valor_total != null && (
                <p><span className="text-muted-foreground">Valor:</span> <span className="font-semibold text-emerald-600 dark:text-emerald-400">R$ {Number(orcSelecionado.valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></p>
              )}
              {orcSelecionado.prazo_entrega_dias != null && (
                <p><span className="text-muted-foreground">Prazo:</span> <span className="text-foreground">{orcSelecionado.prazo_entrega_dias} dias</span></p>
              )}
              <p><span className="text-muted-foreground">Status:</span> <span className="text-foreground">{orcSelecionado.status}</span></p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* Nº Pedido */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Nº Pedido</label>
              <Input
                className="h-9 text-sm"
                placeholder="PED-001"
                value={form.numero_pedido}
                onChange={(e) => set("numero_pedido", e.target.value)}
              />
            </div>
            {/* Status */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Status</label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PEDIDO_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.v} value={o.v} className="text-sm">{o.l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Previsão de entrega */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Previsão de Entrega</label>
            <Input
              type="date"
              className="h-9 text-sm"
              value={form.previsao_entrega}
              onChange={(e) => set("previsao_entrega", e.target.value)}
            />
          </div>

          {/* Observações */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Observações</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              rows={3}
              placeholder="Instruções especiais de entrega, condições, etc."
              value={form.observacoes}
              onChange={(e) => set("observacoes", e.target.value)}
            />
          </div>

          {erro && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertTriangle size={13} /> {erro}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving && <Loader2 size={13} className="animate-spin" />}
            Salvar Pedido
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabCompras() {
  const [pedidos, setPedidos] = useState<PedidoCompra[]>([]);
  const [search, setSearch] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [modalAberto, setModalAberto] = useState(false);

  const load = useCallback(() => {
    listPedidosCompra().then(setPedidos).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = pedidos.filter((p) => {
    const matchSearch =
      (p.numero_pedido ?? "").toLowerCase().includes(search.toLowerCase()) ||
      p.fornecedor_nome.toLowerCase().includes(search.toLowerCase()) ||
      (p.deal_titulo ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filtroStatus === "todos" || p.status === filtroStatus;
    return matchSearch && matchStatus;
  });

  const valorTotal = pedidos
    .filter((p) => p.status !== "cancelado")
    .reduce((acc, p) => acc + (p.valor_total ? parseFloat(p.valor_total) : 0), 0);
  const entregues   = pedidos.filter((p) => p.status === "entregue").length;
  const emTransito  = pedidos.filter((p) => p.status === "em_transito").length;
  const pendentes   = pedidos.filter((p) => ["criado", "enviado", "confirmado"].includes(p.status)).length;

  return (
    <>
      {modalAberto && (
        <ModalNovoPedido
          onClose={() => setModalAberto(false)}
          onSaved={load}
        />
      )}

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Pedidos Pendentes"  value={String(pendentes)}   icon={<ClipboardList size={16} />} tone="warning" />
          <Metric label="Em Trânsito"        value={String(emTransito)}  icon={<Truck size={16} />} />
          <Metric label="Entregues"          value={String(entregues)}   icon={<CheckCircle2 size={16} />} tone="success" />
          <Metric label="Valor Comprometido" value={fmtBRL(valorTotal)}  icon={<DollarSign size={16} />} />
        </div>

        <div className="panel-elevated rounded-card overflow-hidden">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between border-b border-border">
            <SectionHeader
              title="Pedidos de Compra"
              description="Gerados a partir de orçamentos aprovados no CRM → Pré-Compra"
            />
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8 h-8 w-48 text-sm"
                  placeholder="Pedido / Fornecedor / Deal…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {[{ v: "todos", l: "Todos" }, ...PEDIDO_STATUS_OPTIONS].map((o) => (
                    <SelectItem key={o.v} value={o.v} className="text-xs">{o.l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs bg-primary text-primary-foreground"
                onClick={() => setModalAberto(true)}
              >
                <Plus size={13} /> Novo Pedido
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Nº Pedido</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Fornecedor</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Deal / Projeto</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Valor</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Previsão Entrega</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-secondary/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-muted-foreground">
                      {row.numero_pedido || `#${row.id}`}
                    </td>
                    <td className="px-4 py-3 font-medium text-sm">{row.fornecedor_nome}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{row.deal_titulo ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {row.valor_total ? fmtBRL(parseFloat(row.valor_total)) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadgePedido status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {row.previsao_entrega
                        ? new Date(row.previsao_entrega).toLocaleDateString("pt-BR")
                        : "—"}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {pedidos.length === 0
                        ? "Nenhum pedido ainda — aprove orçamentos no CRM ou crie um manualmente."
                        : "Nenhum pedido encontrado com os filtros aplicados."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Tab: Cotação & Pesquisa de Mercado ───────────────────────────────────────

function ModalNovoFornecedor({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (f: FornecedorCompras) => void;
}) {
  const [tab, setTab] = useState<"manual" | "osm">("manual");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // busca OSM
  const [osmMaterial, setOsmMaterial] = useState("");
  const [osmCidade, setOsmCidade] = useState("");
  const [osmRaio, setOsmRaio] = useState("10");
  const [osmBuscando, setOsmBuscando] = useState(false);
  const [osmResultados, setOsmResultados] = useState<FornecedorCompras[]>([]);
  const [osmErro, setOsmErro] = useState<string | null>(null);
  // formulário manual
  const [form, setForm] = useState({
    nome: "", categoria: "", telefone: "", email: "",
    endereco: "", cidade: "", estado: "", website: "", observacoes: "",
  });
  const setF = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSalvarManual = async () => {
    if (!form.nome.trim()) { setErro("Nome é obrigatório."); return; }
    setSaving(true); setErro(null);
    try {
      const novo = await createFornecedorCompras({ ...form, source: "manual" });
      onSaved(novo);
      onClose();
    } catch { setErro("Erro ao salvar fornecedor."); }
    finally { setSaving(false); }
  };

  const handleBuscarOSM = async () => {
    if (!osmMaterial.trim() || !osmCidade.trim()) {
      setOsmErro("Informe o material/tipo e a cidade."); return;
    }
    setOsmBuscando(true); setOsmErro(null); setOsmResultados([]);
    try {
      const res = await buscarFornecedoresOSM(osmMaterial, osmCidade, Number(osmRaio) || 10);
      setOsmResultados(res);
      if (res.length === 0) setOsmErro("Nenhum fornecedor encontrado nesta região.");
    } catch { setOsmErro("Erro na busca OSM. Tente novamente."); }
    finally { setOsmBuscando(false); }
  };

  const handleSalvarOSM = async (f: FornecedorCompras) => {
    try { onSaved(f); onClose(); }
    catch { /* já salvo pelo buscarFornecedoresOSM */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-xl bg-background border border-border shadow-xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold">Adicionar Fornecedor</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-border shrink-0">
          {(["manual", "osm"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                tab === t
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "manual" ? "Cadastro Manual" : "Busca OpenStreetMap"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5">
          {tab === "manual" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-medium">Nome *</label>
                  <Input className="h-9 text-sm" placeholder="Razão social ou nome fantasia" value={form.nome} onChange={(e) => setF("nome", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Categoria</label>
                  <Input className="h-9 text-sm" placeholder="ex: materiais elétricos" value={form.categoria} onChange={(e) => setF("categoria", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Telefone</label>
                  <Input className="h-9 text-sm" placeholder="(11) 99999-9999" value={form.telefone} onChange={(e) => setF("telefone", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">E-mail</label>
                  <Input className="h-9 text-sm" placeholder="contato@empresa.com" value={form.email} onChange={(e) => setF("email", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Website</label>
                  <Input className="h-9 text-sm" placeholder="https://…" value={form.website} onChange={(e) => setF("website", e.target.value)} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-medium">Endereço</label>
                  <Input className="h-9 text-sm" placeholder="Rua, nº, bairro" value={form.endereco} onChange={(e) => setF("endereco", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Cidade</label>
                  <Input className="h-9 text-sm" placeholder="São Paulo" value={form.cidade} onChange={(e) => setF("cidade", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Estado</label>
                  <Input className="h-9 text-sm" placeholder="SP" value={form.estado} onChange={(e) => setF("estado", e.target.value)} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-medium">Observações</label>
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                    rows={2}
                    placeholder="Prazo médio, condições comerciais, contato preferencial…"
                    value={form.observacoes}
                    onChange={(e) => setF("observacoes", e.target.value)}
                  />
                </div>
              </div>
              {erro && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertTriangle size={13} />{erro}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-medium">Material / Tipo</label>
                  <Input
                    className="h-9 text-sm"
                    placeholder="ex: materiais de construção"
                    value={osmMaterial}
                    onChange={(e) => setOsmMaterial(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handleBuscarOSM()}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Raio (km)</label>
                  <Input
                    className="h-9 text-sm"
                    type="number"
                    min={1}
                    max={50}
                    value={osmRaio}
                    onChange={(e) => setOsmRaio(e.target.value)}
                  />
                </div>
                <div className="col-span-3 space-y-1.5">
                  <label className="text-xs font-medium">Cidade / Região</label>
                  <div className="flex gap-2">
                    <Input
                      className="h-9 text-sm flex-1"
                      placeholder="São Paulo, SP"
                      value={osmCidade}
                      onChange={(e) => setOsmCidade(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void handleBuscarOSM()}
                    />
                    <Button size="sm" className="h-9 gap-1.5 text-xs shrink-0" onClick={() => void handleBuscarOSM()} disabled={osmBuscando}>
                      {osmBuscando ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                      Buscar
                    </Button>
                  </div>
                </div>
              </div>

              {osmErro && (
                <p className="text-xs text-destructive flex items-center gap-1.5"><AlertTriangle size={13} />{osmErro}</p>
              )}

              {osmResultados.length > 0 && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-secondary border-b border-border">
                    <p className="text-xs font-medium text-muted-foreground">
                      {osmResultados.length} resultado{osmResultados.length !== 1 ? "s" : ""} encontrado{osmResultados.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="divide-y divide-border max-h-60 overflow-y-auto">
                    {osmResultados.map((f) => (
                      <div key={f.id} className="flex items-start justify-between gap-3 px-3 py-3 hover:bg-secondary/50 transition-colors">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{f.nome}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{f.endereco}{f.cidade ? ` · ${f.cidade}` : ""}</p>
                          {f.categoria && (
                            <Badge className="mt-1 text-[10px] bg-secondary text-muted-foreground border border-border">{f.categoria}</Badge>
                          )}
                        </div>
                        <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => void handleSalvarOSM(f)}>
                          Usar
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — só no tab manual */}
        {tab === "manual" && (
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
            <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" onClick={handleSalvarManual} disabled={saving} className="gap-1.5">
              {saving && <Loader2 size={13} className="animate-spin" />}
              Salvar Fornecedor
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ModalEditarFornecedor({
  fornecedor,
  onClose,
  onSaved,
}: {
  fornecedor: FornecedorCompras;
  onClose: () => void;
  onSaved: (f: FornecedorCompras) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({
    nome: fornecedor.nome,
    categoria: fornecedor.categoria ?? "",
    telefone: fornecedor.telefone ?? "",
    email: fornecedor.email ?? "",
    endereco: fornecedor.endereco ?? "",
    cidade: fornecedor.cidade ?? "",
    observacoes: fornecedor.observacoes ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (!form.nome.trim()) { setErr("Nome é obrigatório."); return; }
    setSaving(true); setErr("");
    try {
      const updated = await updateFornecedorCompras(fornecedor.id, form);
      onSaved(updated);
      onClose();
    } catch { setErr("Erro ao salvar fornecedor."); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-background shadow-2xl border border-border">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-semibold text-sm">Editar Fornecedor</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X size={14} /></Button>
        </div>
        <div className="p-5 space-y-3">
          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Nome *</label>
            <Input className="h-8 text-sm" value={form.nome} onChange={set("nome")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Categoria</label>
              <Input className="h-8 text-sm" value={form.categoria} onChange={set("categoria")} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Telefone</label>
              <Input className="h-8 text-sm" value={form.telefone} onChange={set("telefone")} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">E-mail</label>
            <Input className="h-8 text-sm" value={form.email} onChange={set("email")} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Endereço</label>
            <Input className="h-8 text-sm" value={form.endereco} onChange={set("endereco")} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Cidade</label>
            <Input className="h-8 text-sm" value={form.cidade} onChange={set("cidade")} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Observações</label>
            <Input className="h-8 text-sm" value={form.observacoes} onChange={set("observacoes")} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Cancelar</Button>
          <Button size="sm" className="h-8 text-xs" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabCotacao() {
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [fornecedores, setFornecedores] = useState<FornecedorCompras[]>([]);
  const [search, setSearch] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [modalFornecedor, setModalFornecedor] = useState(false);
  const [editFornecedor, setEditFornecedor] = useState<FornecedorCompras | null>(null);

  const loadFornecedores = useCallback(() => {
    listFornecedoresCompras().then(setFornecedores).catch(() => {});
  }, []);

  const handleDeleteFornecedor = async (id: number) => {
    if (!confirm("Excluir este fornecedor?")) return;
    try {
      await deleteFornecedorCompras(id);
      setFornecedores((prev) => prev.filter((f) => f.id !== id));
    } catch { /* silently fail */ }
  };

  useEffect(() => {
    listTodosOrcamentos().then(setOrcamentos).catch(() => {});
    loadFornecedores();
  }, [loadFornecedores]);

  const filtered = orcamentos.filter((o) => {
    const matchSearch = o.fornecedor_nome.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filtroStatus === "todos" || o.status === filtroStatus;
    return matchSearch && matchStatus;
  });

  const aprovados  = orcamentos.filter((o) => o.status === "aprovado");
  const recebidos  = orcamentos.filter((o) => o.status === "recebido");
  const pendentes  = orcamentos.filter((o) => ["rascunho", "enviado"].includes(o.status));
  const valorAprov = aprovados.reduce((acc, o) => acc + (o.valor_total ?? 0), 0);

  const rankingFornecedores = Object.entries(
    orcamentos.reduce<Record<string, { nome: string; total: number; aprovados: number; valor: number }>>((acc, o) => {
      const k = String(o.fornecedor);
      if (!acc[k]) acc[k] = { nome: o.fornecedor_nome, total: 0, aprovados: 0, valor: 0 };
      acc[k].total++;
      if (o.status === "aprovado") { acc[k].aprovados++; acc[k].valor += (o.valor_total ?? 0); }
      return acc;
    }, {})
  )
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 8);

  return (
    <>
      {modalFornecedor && (
        <ModalNovoFornecedor
          onClose={() => setModalFornecedor(false)}
          onSaved={(novo) => setFornecedores((prev) => [...prev, novo])}
        />
      )}
      {editFornecedor && (
        <ModalEditarFornecedor
          fornecedor={editFornecedor}
          onClose={() => setEditFornecedor(null)}
          onSaved={(updated) => {
            setFornecedores((prev) => prev.map((f) => f.id === updated.id ? updated : f));
            setEditFornecedor(null);
          }}
        />
      )}

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Cotações Enviadas"   value={String(pendentes.length + recebidos.length)} icon={<ClipboardList size={16} />} />
          <Metric label="Respostas Recebidas" value={String(recebidos.length)}  icon={<Scale size={16} />} tone="success" />
          <Metric label="Aprovadas"           value={String(aprovados.length)}  icon={<CheckCircle2 size={16} />} tone="success" />
          <Metric label="Valor Aprovado"      value={fmtBRL(valorAprov)}        icon={<DollarSign size={16} />} tone="warning" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Tabela de orçamentos */}
          <div className="lg:col-span-2 panel-elevated rounded-card overflow-hidden">
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between border-b border-border">
              <SectionHeader title="Orçamentos Recebidos" description="Comparativo de preços por fornecedor e deal" />
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-8 h-8 w-40 text-sm"
                    placeholder="Fornecedor…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      { v: "todos",     l: "Todos" },
                      { v: "rascunho",  l: "Rascunho" },
                      { v: "enviado",   l: "Enviado" },
                      { v: "recebido",  l: "Recebido" },
                      { v: "aprovado",  l: "Aprovado" },
                      { v: "rejeitado", l: "Rejeitado" },
                    ].map((o) => <SelectItem key={o.v} value={o.v} className="text-xs">{o.l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Fornecedor</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Valor Total</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Prazo (dias)</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Criado em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((row) => (
                    <tr key={row.id} className={`transition-colors ${row.status === "aprovado" ? "bg-success/5 hover:bg-success/10" : "hover:bg-secondary/50"}`}>
                      <td className="px-4 py-3 font-medium text-sm">
                        <div className="flex items-center gap-2">
                          {row.status === "aprovado" && <CheckCircle2 size={12} className="text-success shrink-0" />}
                          {row.fornecedor_nome}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {row.valor_total != null ? fmtBRL(row.valor_total) : <span className="text-muted-foreground">Aguardando</span>}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                        {row.prazo_entrega_dias ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadgeOrcamento status={row.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleDateString("pt-BR")}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">
                        {orcamentos.length === 0
                          ? "Nenhum orçamento ainda — busque fornecedores no CRM → Pré-Compra."
                          : "Nenhum orçamento com esses filtros."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Painel lateral */}
          <div className="flex flex-col gap-4">
            {/* Ranking fornecedores */}
            <div className="panel-elevated rounded-card overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div>
                  <h3 className="text-sm font-semibold">Fornecedores</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{fornecedores.length} cadastrado{fornecedores.length !== 1 ? "s" : ""}</p>
                </div>
                <Button
                  size="sm"
                  className="h-7 gap-1 text-xs bg-primary text-primary-foreground"
                  onClick={() => setModalFornecedor(true)}
                >
                  <Plus size={12} /> Adicionar
                </Button>
              </div>

              <div className="divide-y divide-border max-h-80 overflow-y-auto">
                {fornecedores.length === 0 && (
                  <p className="px-4 py-5 text-xs text-muted-foreground text-center">
                    Nenhum fornecedor ainda — adicione um acima.
                  </p>
                )}
                {fornecedores.map((f) => {
                  const rank = rankingFornecedores.find(([, r]) => r.nome === f.nome);
                  return (
                    <div key={f.id} className="flex items-start justify-between gap-2 px-4 py-3 hover:bg-secondary/50 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium truncate">{f.nome}</p>
                          {f.source === "openstreetmap" && (
                            <Badge className="text-[10px] bg-secondary text-muted-foreground border border-border shrink-0">OSM</Badge>
                          )}
                        </div>
                        {(f.cidade || f.categoria) && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {[f.categoria, f.cidade].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        {rank && (
                          <p className="text-[11px] text-muted-foreground">
                            {rank[1].total} cotaç{rank[1].total === 1 ? "ão" : "ões"}
                            {rank[1].aprovados > 0 && ` · ${rank[1].aprovados} aprovada${rank[1].aprovados > 1 ? "s" : ""}`}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary"
                          onClick={() => setEditFornecedor(f)}
                        >
                          <Pencil size={12} />
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteFornecedor(f.id)}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Tab: Estoque ─────────────────────────────────────────────────────────────

function ModalMovimentacao({
  item, onClose, onSaved,
}: { item: ItemEstoque; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [tipo, setTipo] = useState<MovimentacaoEstoque["tipo"]>("entrada");
  const [quantidade, setQuantidade] = useState("1");
  const [valorUnitario, setValorUnitario] = useState("");
  const [motivo, setMotivo] = useState("");
  const [referencia, setReferencia] = useState("");

  const TIPO_LABELS: Record<MovimentacaoEstoque["tipo"], string> = {
    entrada: "Entrada", saida: "Saída", ajuste: "Ajuste de Inventário", transferencia: "Transferência",
  };

  const save = async () => {
    const qtd = parseInt(quantidade);
    if (!qtd || qtd <= 0) { setErr("Quantidade deve ser maior que zero."); return; }
    if (tipo === "saida" && qtd > item.quantidade) {
      setErr(`Estoque insuficiente. Disponível: ${item.quantidade}.`); return;
    }
    setSaving(true); setErr("");
    try {
      const vu = valorUnitario.trim() ? parseFloat(valorUnitario) : undefined;
      await registrarMovimentacao({ item_id: item.id, tipo, quantidade: qtd, motivo, referencia, valor_unitario: vu });
      onSaved(); onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao registrar movimentação.";
      setErr(msg);
    }
    finally { setSaving(false); }
  };

  const tipoColor = { entrada: "text-success", saida: "text-destructive", ajuste: "text-primary", transferencia: "text-warning" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-background shadow-2xl border border-border">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="font-semibold text-sm">Registrar Movimentação</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{item.nome} · {item.codigo}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X size={14} /></Button>
        </div>
        <div className="p-5 space-y-3">
          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="rounded-lg bg-secondary p-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Saldo atual</span>
            <span className={`font-bold tabular-nums ${item.abaixo_minimo ? "text-warning" : "text-foreground"}`}>{item.quantidade} {item.unidade}</span>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Tipo</label>
            <div className="grid grid-cols-2 gap-2">
              {(["entrada","saida","ajuste","transferencia"] as const).map((t) => (
                <button key={t} onClick={() => setTipo(t)}
                  className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${tipo === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"}`}>
                  {TIPO_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {tipo === "ajuste" ? "Nova quantidade total" : "Quantidade"}
            </label>
            <Input type="number" className="h-8 text-sm" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} min="1" />
            {tipo !== "ajuste" && (
              <p className={`text-xs ${tipoColor[tipo]}`}>
                Saldo após: {tipo === "entrada" ? item.quantidade + (parseInt(quantidade) || 0) : item.quantidade - (parseInt(quantidade) || 0)} {item.unidade}
              </p>
            )}
          </div>
          {tipo === "entrada" && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Valor Unitário (R$) <span className="text-muted-foreground/60">— atualiza custo médio</span></label>
              <Input type="number" step="0.01" className="h-8 text-sm" value={valorUnitario} onChange={(e) => setValorUnitario(e.target.value)} placeholder="0,00" />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Motivo</label>
            <Input className="h-8 text-sm" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex: Compra fornecedor, Venda cliente…" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Referência (NF, PO, OC…)</label>
            <Input className="h-8 text-sm" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ex: NF-001" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Cancelar</Button>
          <Button size="sm" className="h-8 text-xs" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : "Registrar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabEstoque() {
  const [itens, setItens] = useState<ItemEstoque[]>([]);
  const [movs, setMovs] = useState<MovimentacaoEstoque[]>([]);
  const [movItem, setMovItem] = useState<ItemEstoque | null>(null);

  const load = useCallback(() => {
    listEstoque({ page_size: "500" }).then(setItens).catch(() => {});
    listMovimentacoesEstoque().then((m) => setMovs(m.slice(0, 20))).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const materiais = itens.filter((e) => e.tipo_item !== "servico");
  const abaixoMin = materiais.filter((e) => e.abaixo_minimo).length;
  const valorTotal = materiais.reduce((acc, e) => acc + e.valor_total, 0);

  const tipoMovIcon = {
    entrada: <ArrowUpCircle size={13} className="text-success shrink-0" />,
    saida: <ArrowDownCircle size={13} className="text-destructive shrink-0" />,
    ajuste: <Edit2 size={13} className="text-primary shrink-0" />,
    transferencia: <Truck size={13} className="text-warning shrink-0" />,
  };

  return (
    <div className="space-y-6">
      {movItem && <ModalMovimentacao item={movItem} onClose={() => setMovItem(null)} onSaved={load} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Materiais" value={String(materiais.length)} icon={<Package size={16} />} />
        <Metric label="Serviços" value={String(itens.length - materiais.length)} icon={<Briefcase size={16} />} />
        <Metric label="Valor em estoque" value={fmtBRL(valorTotal)} icon={<DollarSign size={16} />} tone="success" />
        <Metric label="Abaixo do mínimo" value={String(abaixoMin)} icon={<AlertTriangle size={16} />} tone={abaixoMin ? "warning" : "default"} />
      </div>

      <ItensCrud onMovimentar={setMovItem} onChanged={load} />

      <div className="panel-elevated rounded-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <SectionHeader title="Últimas Movimentações" description="Entradas, saídas e ajustes recentes" />
        </div>
        {movs.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma movimentação registrada</p>
        ) : (
          <div className="divide-y divide-border">
            {movs.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors">
                {tipoMovIcon[m.tipo]}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.item_nome} <span className="font-mono text-xs text-muted-foreground">({m.item_codigo})</span></p>
                  <p className="text-xs text-muted-foreground">{m.motivo || m.tipo_display}{m.referencia ? ` · ${m.referencia}` : ""}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold tabular-nums ${m.tipo === "entrada" ? "text-success" : m.tipo === "saida" ? "text-destructive" : "text-primary"}`}>
                    {m.tipo === "entrada" ? "+" : m.tipo === "saida" ? "−" : "="}{m.quantidade}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.quantidade_anterior} → {m.quantidade_posterior}</p>
                </div>
                <div className="text-xs text-muted-foreground shrink-0 w-24 text-right">
                  {new Date(m.created_at).toLocaleDateString("pt-BR")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Financeiro ──────────────────────────────────────────────────────────

function TabFinanceiro() {
  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([]);

  const load = useCallback(() => {
    listLancamentosFinanceiros({ page_size: "500" }).then(setLancamentos).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const hoje = new Date().toISOString().slice(0, 10);
  const soma = (rows: LancamentoFinanceiro[]) => rows.reduce((a, c) => a + parseFloat(c.valor), 0);
  const abertos = lancamentos.filter((l) => l.status === "pendente" || l.status === "vencido");
  const totalReceber = soma(abertos.filter((l) => l.tipo === "receita"));
  const totalPagar = soma(abertos.filter((l) => l.tipo === "despesa"));
  const vencido = soma(abertos.filter((l) => l.status === "vencido" || l.vencimento < hoje));
  const saldo =
    soma(lancamentos.filter((l) => l.tipo === "receita" && l.status === "pago")) -
    soma(lancamentos.filter((l) => l.tipo === "despesa" && l.status === "pago"));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Saldo realizado" value={fmtBRL(saldo)} icon={<Wallet size={16} />} tone={saldo >= 0 ? "success" : "warning"} />
        <Metric label="A receber" value={fmtBRL(totalReceber)} icon={<ArrowDownCircle size={16} />} />
        <Metric label="A pagar" value={fmtBRL(totalPagar)} icon={<ArrowUpCircle size={16} />} />
        <Metric label="Em atraso" value={fmtBRL(vencido)} icon={<AlertTriangle size={16} />} tone={vencido ? "warning" : "default"} />
      </div>
      <LancamentosCrud onChanged={load} />
    </div>
  );
}

// ─── Tab: Contabilidade ───────────────────────────────────────────────────────

function TabContabilidade() {
  const [linhas, setLinhas] = useState<LinhaDRE[]>([]);
  const [balancete, setBalancete] = useState<BalancetePeriodo | null>(null);

  const competencia = new Date().toISOString().slice(0, 7); // "YYYY-MM"

  useEffect(() => {
    listLinhasDRE({ competencia }).then(setLinhas).catch(() => {});
    listBalancete({ competencia }).then((rows) => setBalancete(rows[0] ?? null)).catch(() => {});
  }, [competencia]);

  const findVal = (conta: string) => {
    const row = linhas.find((l) => l.conta === conta);
    return row ? parseFloat(row.valor_atual) : 0;
  };

  const receitaBruta = findVal("Receita Bruta de Vendas");
  const deducoes = findVal("Deduções (Impostos s/ Vendas)");
  const receitaLiq = findVal("Receita Líquida");
  const lucroBruto = findVal("Lucro Bruto");
  const ebitda = findVal("EBITDA");
  const lucroLiq = findVal("Lucro Líquido");
  const pl = balancete ? parseFloat(balancete.patrimonio_liquido) : 0;

  const margemBruta   = receitaLiq !== 0 ? (lucroBruto / receitaLiq) * 100 : null;
  const margemEbitda  = receitaLiq !== 0 ? (ebitda / receitaLiq) * 100 : null;
  const margemLiquida = receitaLiq !== 0 ? (lucroLiq / receitaLiq) * 100 : null;
  const roe           = pl !== 0 ? (lucroLiq / pl) * 100 : null;

  const fmtPct = (v: number | null) => v !== null ? `${fmt(v, 1)}%` : "—";

  const competenciaLabel = linhas[0]?.competencia
    ? new Date(linhas[0].competencia + "-01").toLocaleString("pt-BR", { month: "long", year: "numeric" })
    : "—";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Receita Bruta"   value={fmtBRL(receitaBruta)} icon={<TrendingUp size={16} />} tone="success" />
        <Metric label="Deduções"        value={fmtBRL(Math.abs(deducoes))} icon={<TrendingDown size={16} />} tone="warning" />
        <Metric label="Receita Líquida" value={fmtBRL(receitaLiq)} icon={<BarChart2 size={16} />} />
        <Metric label="EBITDA"          value={fmtBRL(ebitda)} icon={<DollarSign size={16} />} tone="success" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 panel-elevated rounded-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div>
              <h3 className="text-sm font-semibold">DRE – Demonstração do Resultado</h3>
              <p className="text-xs text-muted-foreground mt-0.5 capitalize">Competência: {competenciaLabel}</p>
            </div>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
              <Download size={12} /> Exportar
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Conta</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Mês Atual</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Mês Anterior</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Var. %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {linhas.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-xs text-muted-foreground">
                      Nenhum lançamento de DRE para este período.
                    </td>
                  </tr>
                ) : linhas.map((row) => {
                  const atual = parseFloat(row.valor_atual);
                  const anterior = parseFloat(row.valor_anterior);
                  const var_ = variacao(atual, anterior);
                  const isSubtotal = row.tipo === "subtotal" || row.tipo === "resultado";
                  const isNegative = atual < 0;
                  const varPositive = var_ >= 0;
                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors ${
                        row.tipo === "resultado"
                          ? "bg-success/10 font-bold"
                          : isSubtotal
                          ? "bg-elevated font-semibold"
                          : "hover:bg-secondary/50"
                      }`}
                    >
                      <td className={`px-4 py-2.5 text-xs ${isSubtotal ? "font-semibold" : ""}`}>
                        {isSubtotal ? (
                          <span className="flex items-center gap-1.5">
                            <ChevronRight size={12} className="text-muted-foreground" />
                            {row.conta}
                          </span>
                        ) : row.conta}
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums text-xs ${isNegative ? "text-warning" : isSubtotal ? "" : "text-success"}`}>
                        {isNegative ? `(${fmtBRL(Math.abs(atual))})` : fmtBRL(atual)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs text-muted-foreground">
                        {anterior < 0 ? `(${fmtBRL(Math.abs(anterior))})` : fmtBRL(anterior)}
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums text-xs font-medium ${varPositive ? "text-success" : "text-warning"}`}>
                        {varPositive ? "+" : ""}{fmt(var_, 1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="panel-elevated rounded-card p-4">
            <h3 className="text-sm font-semibold mb-4">Balancete Resumido</h3>
            {balancete ? (
              <div className="space-y-3">
                {[
                  { label: "Ativo Total",       value: parseFloat(balancete.ativo_total),       tone: "success" as const },
                  { label: "Passivo Total",      value: parseFloat(balancete.passivo_total),     tone: "warning" as const },
                  { label: "Patrimônio Líquido", value: parseFloat(balancete.patrimonio_liquido), tone: "default" as const },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-md bg-secondary px-3 py-2.5">
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                    <span className={`text-sm font-bold tabular-nums ${item.tone === "success" ? "text-success" : item.tone === "warning" ? "text-warning" : ""}`}>
                      {fmtBRL(item.value)}
                    </span>
                  </div>
                ))}
                <div className="mt-2 rounded-md border border-border px-3 py-2.5 bg-elevated">
                  <p className="text-xs text-muted-foreground">Equação contábil</p>
                  <p className="text-xs font-medium mt-1">Ativo = Passivo + PL ✓</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Sem balancete para este período.</p>
            )}
          </div>

          <div className="panel-elevated rounded-card p-4">
            <h3 className="text-sm font-semibold mb-3">Indicadores</h3>
            <div className="space-y-2.5">
              {[
                { label: "Margem Bruta",   value: fmtPct(margemBruta) },
                { label: "Margem EBITDA",  value: fmtPct(margemEbitda) },
                { label: "Margem Líquida", value: fmtPct(margemLiquida) },
                { label: "ROE (mensal)",   value: fmtPct(roe) },
              ].map((ind) => (
                <div key={ind.label} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{ind.label}</span>
                  <span className="text-sm font-semibold text-success">{ind.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: RH ──────────────────────────────────────────────────────────────────

function TabRH() {
  const [colaboradores, setColaboradores] = useState<Funcionario[]>([]);

  const load = useCallback(() => {
    listFuncionarios({ page_size: "500" }).then(setColaboradores).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const ativos = colaboradores.filter((c) => c.status !== "desligado");
  const totalFolha = ativos.reduce((a, c) => a + parseFloat(c.salario || "0"), 0);
  const mesAtual = new Date().toISOString().slice(0, 7);
  const admissoesMes = colaboradores.filter((c) => c.data_admissao?.startsWith(mesAtual)).length;
  const setores = new Set(ativos.map((c) => c.setor_nome || c.departamento).filter(Boolean)).size;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Colaboradores ativos" value={String(ativos.length)} icon={<Users size={16} />} />
        <Metric label="Admissões no mês" value={String(admissoesMes)} icon={<Plus size={16} />} tone="success" />
        <Metric label="Setores com equipe" value={String(setores)} icon={<Building2 size={16} />} />
        <Metric label="Folha mensal" value={fmtBRL(totalFolha)} icon={<Briefcase size={16} />} />
      </div>
      <FuncionariosCrud onChanged={load} />
    </div>
  );
}

// ─── Tab: Fiscal ──────────────────────────────────────────────────────────────

function TabFiscal() {
  const [notas, setNotas] = useState<NotaFiscal[]>([]);
  const [obrigacoes, setObrigacoes] = useState<ObrigacaoFiscal[]>([]);

  useEffect(() => {
    listNotasFiscais({ page_size: "500" }).then(setNotas).catch(() => {});
    listObrigacoesFiscais({ page_size: "500" }).then(setObrigacoes).catch(() => {});
  }, []);

  const autorizadas = notas.filter((n) => n.status === "autorizada");
  const rascunhos = notas.filter((n) => n.status === "rascunho" || n.status === "pendente").length;
  const issMes = autorizadas
    .filter((n) => n.emissao.startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((acc, n) => acc + parseFloat(n.valor_iss || "0"), 0);
  const proxObrigacao = obrigacoes
    .filter((o) => o.status === "pendente" || o.status === "agendada")
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Notas autorizadas" value={String(autorizadas.length)} icon={<FileText size={16} />} tone="success" />
        <Metric label="Rascunhos / pendentes" value={String(rascunhos)} icon={<Clock size={16} />} tone={rascunhos ? "warning" : "default"} />
        <Metric label="ISS do mês (autorizadas)" value={fmtBRL(issMes)} icon={<Receipt size={16} />} />
        <Metric
          label="Próxima obrigação"
          value={proxObrigacao ? proxObrigacao.nome : "—"}
          hint={proxObrigacao ? `vence ${proxObrigacao.vencimento.split("-").reverse().join("/")}` : undefined}
          icon={<Calendar size={16} />}
        />
      </div>
      <PainelNotaFiscal />
      <NotasFiscaisCrud />
      <ObrigacoesCrud />
    </div>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

function TabContabilidadeCompleta() {
  const [versao, setVersao] = useState(0);
  const bump = () => setVersao((v) => v + 1);
  return (
    <div className="space-y-8">
      <TabContabilidade key={versao} />
      <DreCrud onChanged={bump} />
      <BalanceteCrud onChanged={bump} />
    </div>
  );
}

const ERP_TABS: { value: string; label: string; icon: React.ElementType }[] = [
  { value: "parceiros", label: "Parceiros", icon: Handshake },
  { value: "contratos", label: "Contratos", icon: FileSignature },
  { value: "compras", label: "Compras", icon: ShoppingCart },
  { value: "cotacao", label: "Cotação", icon: Scale },
  { value: "estoque", label: "Itens & Estoque", icon: Box },
  { value: "financeiro", label: "Financeiro", icon: Wallet },
  { value: "contabilidade", label: "Contabilidade", icon: BookOpen },
  { value: "rh", label: "RH", icon: Users },
  { value: "fiscal", label: "Fiscal", icon: Receipt },
];

export function ERPView({ onBack, defaultTab = "contratos" }: { onBack: () => void; defaultTab?: string }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0" title="Voltar">
          <ArrowLeft className="size-4" />
        </Button>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-success/10 text-success">
          <Layers className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">ERP</h2>
          <p className="text-xs text-muted-foreground">
            Parceiros, contratos, compras, estoque, financeiro, contabilidade, RH e fiscal — integrados ao CRM, aos
            setores e aos centros de custo
          </p>
        </div>
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-6">
        <TabsList className="h-auto flex-wrap gap-1 rounded-md bg-secondary p-1">
          {ERP_TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              <t.icon size={13} /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="parceiros"><TabParceiros /></TabsContent>
        <TabsContent value="contratos"><TabContratos /></TabsContent>
        <TabsContent value="compras"><TabCompras /></TabsContent>
        <TabsContent value="cotacao"><TabCotacao /></TabsContent>
        <TabsContent value="estoque"><TabEstoque /></TabsContent>
        <TabsContent value="financeiro"><TabFinanceiro /></TabsContent>
        <TabsContent value="contabilidade"><TabContabilidadeCompleta /></TabsContent>
        <TabsContent value="rh"><TabRH /></TabsContent>
        <TabsContent value="fiscal"><TabFiscal /></TabsContent>
      </Tabs>
    </div>
  );
}
