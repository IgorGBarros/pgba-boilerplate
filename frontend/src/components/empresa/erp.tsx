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
  Eye,
  FileText,
  Layers,
  Loader2,
  MapPin,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Scale,
  Search,
  ShoppingCart,
  Truck,
  TrendingDown,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  X,
  XCircle,
  CheckCircle2,
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
  createItemEstoque,
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

function StatusBadgeFinanceiro({ status }: { status: LancamentoFinanceiro["status"] }) {
  const label: Record<LancamentoFinanceiro["status"], string> = {
    pendente:  "Pendente",
    pago:      "Pago",
    vencido:   "Vencido",
    cancelado: "Cancelado",
  };
  const map: Record<LancamentoFinanceiro["status"], string> = {
    pendente:  "bg-secondary text-muted-foreground border border-border",
    pago:      "bg-success text-foreground",
    vencido:   "bg-warning text-foreground",
    cancelado: "bg-destructive/20 text-destructive",
  };
  return <Badge className={map[status]}>{label[status]}</Badge>;
}

function StatusBadgeRH({ status }: { status: Funcionario["status"] }) {
  const label: Record<Funcionario["status"], string> = {
    ativo:      "Ativo",
    ferias:     "Férias",
    afastado:   "Afastado",
    desligado:  "Desligado",
  };
  const map: Record<Funcionario["status"], string> = {
    ativo:     "bg-success text-foreground",
    ferias:    "bg-primary text-primary-foreground",
    afastado:  "bg-warning text-foreground",
    desligado: "bg-secondary text-muted-foreground border border-border",
  };
  return <Badge className={map[status]}>{label[status]}</Badge>;
}

function StatusBadgeFiscal({ status }: { status: string }) {
  const map: Record<string, string> = {
    autorizada: "bg-success text-foreground",
    cancelada:  "bg-warning text-foreground",
    denegada:   "bg-destructive/20 text-destructive",
    pendente:   "bg-secondary text-muted-foreground border border-border",
    agendada:   "bg-primary text-primary-foreground",
    entregue:   "bg-success text-foreground",
    vencida:    "bg-destructive/20 text-destructive",
  };
  const label: Record<string, string> = {
    autorizada: "Autorizada", cancelada: "Cancelada", denegada: "Denegada",
    pendente: "Pendente", agendada: "Agendada", entregue: "Entregue", vencida: "Vencida",
  };
  return <Badge className={map[status] ?? "bg-secondary text-muted-foreground"}>{label[status] ?? status}</Badge>;
}

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
  const [fornecedores, setFornecedores] = useState<FornecedorCompras[]>([]);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState({
    fornecedor_id: "" as string | number,
    numero_pedido: "",
    status: "criado" as PedidoCompra["status"],
    valor_total: "",
    previsao_entrega: "",
    observacoes: "",
  });

  useEffect(() => {
    listFornecedoresCompras().then(setFornecedores).catch(() => {});
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.fornecedor_id) { setErro("Selecione um fornecedor."); return; }
    setSaving(true);
    setErro(null);
    try {
      await createPedidoCompra({
        fornecedor_id: Number(form.fornecedor_id),
        numero_pedido: form.numero_pedido || undefined,
        status: form.status,
        valor_total: form.valor_total || undefined,
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
          {/* Fornecedor */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Fornecedor *</label>
            <Select value={String(form.fornecedor_id)} onValueChange={(v) => set("fornecedor_id", v)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Selecione um fornecedor…" />
              </SelectTrigger>
              <SelectContent>
                {fornecedores.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)} className="text-sm">
                    {f.nome} {f.cidade ? `— ${f.cidade}` : ""}
                  </SelectItem>
                ))}
                {fornecedores.length === 0 && (
                  <SelectItem value="__none" disabled className="text-xs text-muted-foreground">
                    Nenhum fornecedor cadastrado
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

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

          <div className="grid grid-cols-2 gap-3">
            {/* Valor */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Valor Total (R$)</label>
              <Input
                className="h-9 text-sm"
                placeholder="0,00"
                value={form.valor_total}
                onChange={(e) => set("valor_total", e.target.value)}
              />
            </div>
            {/* Previsão entrega */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Previsão de Entrega</label>
              <Input
                type="date"
                className="h-9 text-sm"
                value={form.previsao_entrega}
                onChange={(e) => set("previsao_entrega", e.target.value)}
              />
            </div>
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

function TabCotacao() {
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [fornecedores, setFornecedores] = useState<FornecedorCompras[]>([]);
  const [search, setSearch] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [modalFornecedor, setModalFornecedor] = useState(false);

  const loadFornecedores = useCallback(() => {
    listFornecedoresCompras().then(setFornecedores).catch(() => {});
  }, []);

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

  const fornecedoresOsm = fornecedores.filter((f) => f.source === "openstreetmap");

  return (
    <>
      {modalFornecedor && (
        <ModalNovoFornecedor
          onClose={() => setModalFornecedor(false)}
          onSaved={(novo) => setFornecedores((prev) => [...prev, novo])}
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

              {rankingFornecedores.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Mais cotados</p>
                  </div>
                  <div className="divide-y divide-border">
                    {rankingFornecedores.map(([, f]) => (
                      <div key={f.nome} className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-secondary/50 transition-colors">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{f.nome}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {f.total} cotaç{f.total === 1 ? "ão" : "ões"}
                            {f.aprovados > 0 && ` · ${f.aprovados} aprovada${f.aprovados > 1 ? "s" : ""}`}
                          </p>
                        </div>
                        {f.valor > 0 && (
                          <span className="text-xs font-semibold text-success shrink-0 tabular-nums">
                            {fmtBRL(f.valor)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {rankingFornecedores.length === 0 && (
                <p className="px-4 py-5 text-xs text-muted-foreground text-center">
                  Nenhum fornecedor ainda — adicione um acima.
                </p>
              )}
            </div>

            {/* Fornecedores via OSM */}
            <div className="panel-elevated rounded-card overflow-hidden">
              <div className="p-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <MapPin size={14} className="text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Encontrados via OSM</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fornecedoresOsm.length} resultado{fornecedoresOsm.length !== 1 ? "s" : ""} — use "Busca OpenStreetMap" para pesquisar
                </p>
              </div>
              <div className="divide-y divide-border max-h-60 overflow-y-auto">
                {fornecedoresOsm.length === 0 ? (
                  <p className="px-4 py-5 text-xs text-muted-foreground text-center">
                    Clique em "Adicionar" e use a aba "Busca OpenStreetMap".
                  </p>
                ) : fornecedoresOsm.map((f) => (
                  <div key={f.id} className="px-4 py-3 hover:bg-secondary/50 transition-colors">
                    <p className="text-sm font-medium">{f.nome}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{f.endereco}{f.cidade ? ` · ${f.cidade}` : ""}</p>
                    {f.telefone && <p className="text-[11px] text-muted-foreground mt-0.5">{f.telefone}</p>}
                    {f.categoria && (
                      <Badge className="mt-1 text-[10px] bg-secondary text-muted-foreground border border-border">{f.categoria}</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Tab: Estoque ─────────────────────────────────────────────────────────────

function ModalNovoProduto({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({
    codigo: "", nome: "", categoria: "", unidade: "un",
    quantidade: "0", quantidade_minima: "0", custo_unitario: "0", localizacao: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (!form.codigo.trim() || !form.nome.trim()) { setErr("Código e nome são obrigatórios."); return; }
    setSaving(true); setErr("");
    try {
      await createItemEstoque({
        codigo: form.codigo.trim(),
        nome: form.nome.trim(),
        categoria: form.categoria.trim(),
        unidade: form.unidade,
        quantidade: parseInt(form.quantidade) || 0,
        quantidade_minima: parseInt(form.quantidade_minima) || 0,
        custo_unitario: form.custo_unitario,
        localizacao: form.localizacao.trim(),
      });
      onSaved(); onClose();
    } catch { setErr("Erro ao salvar produto."); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-background shadow-2xl border border-border">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-semibold text-sm">Novo Produto</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X size={14} /></Button>
        </div>
        <div className="p-5 space-y-3">
          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Código *</label>
              <Input className="h-8 text-sm" value={form.codigo} onChange={set("codigo")} placeholder="SKU-001" />
            </div>
            <div className="space-y-1 col-span-1">
              <label className="text-xs text-muted-foreground">Nome *</label>
              <Input className="h-8 text-sm" value={form.nome} onChange={set("nome")} placeholder="Nome do produto" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Categoria</label>
              <Input className="h-8 text-sm" value={form.categoria} onChange={set("categoria")} placeholder="Ex: Eletrônicos" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Unidade</label>
              <select className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" value={form.unidade} onChange={set("unidade")}>
                {[["un","Unidade"],["kg","Kg"],["m","Metro"],["l","Litro"],["cx","Caixa"],["pc","Peça"]].map(([v,l]) =>
                  <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Qtd Inicial</label>
              <Input type="number" className="h-8 text-sm" value={form.quantidade} onChange={set("quantidade")} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Qtd Mínima</label>
              <Input type="number" className="h-8 text-sm" value={form.quantidade_minima} onChange={set("quantidade_minima")} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Custo Unit. (R$)</label>
              <Input type="number" step="0.01" className="h-8 text-sm" value={form.custo_unitario} onChange={set("custo_unitario")} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Localização</label>
            <Input className="h-8 text-sm" value={form.localizacao} onChange={set("localizacao")} placeholder="Ex: Prateleira A3" />
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

function ModalMovimentacao({
  item, onClose, onSaved,
}: { item: ItemEstoque; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [tipo, setTipo] = useState<MovimentacaoEstoque["tipo"]>("entrada");
  const [quantidade, setQuantidade] = useState("1");
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
      await registrarMovimentacao({ item_id: item.id, tipo, quantidade: qtd, motivo, referencia });
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
  const [search, setSearch] = useState("");
  const [categoria, setCategoria] = useState("Todas");
  const [modalNovo, setModalNovo] = useState(false);
  const [movItem, setMovItem] = useState<ItemEstoque | null>(null);

  const load = useCallback(() => {
    listEstoque().then(setItens).catch(() => {});
    listMovimentacoesEstoque().then((m) => setMovs(m.slice(0, 20))).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const abaixoMin = itens.filter((e) => e.abaixo_minimo).length;
  const valorTotal = itens.reduce((acc, e) => acc + e.valor_total, 0);
  const categorias = ["Todas", ...new Set(itens.map((e) => e.categoria).filter(Boolean))];
  const filtered = itens.filter(
    (e) =>
      (categoria === "Todas" || e.categoria === categoria) &&
      (e.nome.toLowerCase().includes(search.toLowerCase()) || e.codigo.toLowerCase().includes(search.toLowerCase()))
  );

  const tipoMovIcon = {
    entrada: <ArrowUpCircle size={13} className="text-success shrink-0" />,
    saida: <ArrowDownCircle size={13} className="text-destructive shrink-0" />,
    ajuste: <Edit2 size={13} className="text-primary shrink-0" />,
    transferencia: <Truck size={13} className="text-warning shrink-0" />,
  };

  return (
    <div className="space-y-6">
      {modalNovo && <ModalNovoProduto onClose={() => setModalNovo(false)} onSaved={load} />}
      {movItem && <ModalMovimentacao item={movItem} onClose={() => setMovItem(null)} onSaved={load} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Itens em Estoque" value={String(itens.length)} icon={<Package size={16} />} />
        <Metric label="Valor Total" value={fmtBRL(valorTotal)} icon={<DollarSign size={16} />} />
        <Metric label="Abaixo do Mínimo" value={String(abaixoMin)} icon={<AlertTriangle size={16} />} tone="warning" />
        <Metric label="Categorias" value={String(new Set(itens.map((e) => e.categoria)).size)} icon={<RefreshCw size={16} />} tone="success" />
      </div>

      <div className="panel-elevated rounded-card overflow-hidden">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between border-b border-border">
          <SectionHeader title="Produtos em Estoque" description="Posição atual, limites e localização" />
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8 h-8 w-44 text-sm" placeholder="Produto / Código…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                {categorias.map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 gap-1.5 text-xs" variant="outline" onClick={() => setModalNovo(true)}>
              <Plus size={13} /> Novo Produto
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Produto</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Código</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Categoria</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Qtd</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Mín</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Localização</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Valor Unit.</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Total</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((row) => (
                <tr key={row.id} className={`transition-colors ${row.abaixo_minimo ? "bg-warning/10 hover:bg-warning/15" : "hover:bg-secondary/50"}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {row.abaixo_minimo && <AlertTriangle size={13} className="text-warning shrink-0" />}
                      <span className={row.abaixo_minimo ? "font-medium text-warning" : ""}>{row.nome}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.codigo}</td>
                  <td className="px-4 py-3">
                    <Badge className="bg-secondary text-muted-foreground border border-border text-xs">{row.categoria || "—"}</Badge>
                  </td>
                  <td className={`px-4 py-3 text-center tabular-nums font-bold ${row.abaixo_minimo ? "text-warning" : ""}`}>{row.quantidade} <span className="text-xs font-normal text-muted-foreground">{row.unidade}</span></td>
                  <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">{row.quantidade_minima}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.localizacao || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtBRL(parseFloat(row.custo_unitario))}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtBRL(row.valor_total)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-success hover:text-success hover:bg-success/10" onClick={() => setMovItem(row)}>
                        <Upload size={12} /> Mov.
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum item encontrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Histórico de movimentações */}
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

function TabelaFinanceiro({ rows, tipo }: { rows: LancamentoFinanceiro[]; tipo: "receber" | "pagar" }) {
  return (
    <div className="panel-elevated rounded-card overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div>
          <h3 className="text-sm font-semibold">
            {tipo === "receber" ? "Contas a Receber" : "Contas a Pagar"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {tipo === "receber" ? "Clientes com valores a receber" : "Fornecedores com valores a pagar"}
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
          <Plus size={12} /> Novo
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Descrição</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                {tipo === "receber" ? "Cliente" : "Fornecedor"}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Vencimento</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Valor</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-secondary/50 transition-colors">
                <td className="px-4 py-3 text-xs">{row.descricao}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {tipo === "receber" ? row.cliente : row.fornecedor_nome}
                </td>
                <td className="px-4 py-3 text-xs">{row.vencimento}</td>
                <td className="px-4 py-3 text-right tabular-nums text-sm font-medium">{fmtBRL(parseFloat(row.valor))}</td>
                <td className="px-4 py-3 text-center">
                  <StatusBadgeFinanceiro status={row.status} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum lançamento</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabFinanceiro() {
  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([]);

  useEffect(() => {
    listLancamentosFinanceiros().then(setLancamentos).catch(() => {});
  }, []);

  const contasReceber = lancamentos.filter((l) => l.tipo === "receita");
  const contasPagar   = lancamentos.filter((l) => l.tipo === "despesa");

  const totalReceber = contasReceber.filter((c) => c.status !== "pago").reduce((a, c) => a + parseFloat(c.valor), 0);
  const totalPagar   = contasPagar.filter((c) => c.status !== "pago").reduce((a, c) => a + parseFloat(c.valor), 0);
  const saldo = contasReceber.filter((c) => c.status === "pago").reduce((a, c) => a + parseFloat(c.valor), 0)
              - contasPagar.filter((c) => c.status === "pago").reduce((a, c) => a + parseFloat(c.valor), 0);
  const resultado = contasReceber.reduce((a, c) => a + parseFloat(c.valor), 0)
                  - contasPagar.reduce((a, c) => a + parseFloat(c.valor), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Saldo Atual" value={fmtBRL(saldo)} icon={<Wallet size={16} />} tone="success" />
        <Metric label="Contas a Receber" value={fmtBRL(totalReceber)} icon={<ArrowDownCircle size={16} />} />
        <Metric label="Contas a Pagar" value={fmtBRL(totalPagar)} icon={<ArrowUpCircle size={16} />} tone="warning" />
        <Metric label="Resultado do Mês" value={fmtBRL(resultado)} icon={<TrendingUp size={16} />} tone="success" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TabelaFinanceiro rows={contasReceber} tipo="receber" />
        <TabelaFinanceiro rows={contasPagar}   tipo="pagar" />
      </div>
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
  const [search, setSearch] = useState("");

  useEffect(() => {
    listFuncionarios().then(setColaboradores).catch(() => {});
  }, []);

  const filtered = colaboradores.filter(
    (c) =>
      c.nome.toLowerCase().includes(search.toLowerCase()) ||
      c.cargo.toLowerCase().includes(search.toLowerCase()) ||
      c.departamento.toLowerCase().includes(search.toLowerCase())
  );
  const totalFolha = colaboradores.reduce((a, c) => a + parseFloat(c.salario), 0);
  const deptos = [...new Set(colaboradores.map((c) => c.departamento))];

  const mesAtual = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const admissoesMes = colaboradores.filter((c) => c.data_admissao?.startsWith(mesAtual)).length;
  const desligamentos = colaboradores.filter((c) => c.status === "desligado").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Total Colaboradores" value={String(colaboradores.length)} icon={<Users size={16} />} />
        <Metric label="Admissões no Mês"    value={String(admissoesMes)} icon={<Plus size={16} />} tone="success" />
        <Metric label="Desligados"           value={String(desligamentos)} icon={<XCircle size={16} />} />
        <Metric label="Custo Total Folha"    value={fmtBRL(totalFolha)} icon={<Briefcase size={16} />} tone="warning" />
      </div>

      <div className="panel-elevated rounded-card overflow-hidden">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between border-b border-border">
          <SectionHeader title="Colaboradores" description="Quadro ativo, férias e afastamentos" />
          <div className="flex gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8 h-8 w-44 text-sm" placeholder="Nome / Cargo…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button size="sm" className="h-8 gap-1.5 text-xs bg-primary text-primary-foreground">
              <Plus size={13} /> Colaborador
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Nome</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Cargo</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Departamento</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Admissão</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Salário</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-secondary/50 transition-colors">
                  <td className="px-4 py-3 font-medium">{row.nome}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{row.cargo}</td>
                  <td className="px-4 py-3">
                    <Badge className="bg-secondary text-muted-foreground border border-border text-xs">{row.departamento}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{row.data_admissao}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtBRL(parseFloat(row.salario))}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadgeRH status={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                        <Eye size={13} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                        <Edit2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum colaborador encontrado</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {deptos.map((depto) => {
          const count = colaboradores.filter((c) => c.departamento === depto).length;
          return (
            <div key={depto} className="panel rounded-card flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-secondary p-2">
                  <Building2 size={14} className="text-muted-foreground" />
                </div>
                <span className="text-sm font-medium">{depto}</span>
              </div>
              <span className="text-lg font-bold">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab: Fiscal ──────────────────────────────────────────────────────────────

function TabFiscal() {
  const [notas, setNotas] = useState<NotaFiscal[]>([]);
  const [obrigacoes, setObrigacoes] = useState<ObrigacaoFiscal[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    listNotasFiscais().then(setNotas).catch(() => {});
    listObrigacoesFiscais().then(setObrigacoes).catch(() => {});
  }, []);

  const nfeAutorizadas = notas.filter((n) => n.status === "autorizada").length;
  const nfePendentes   = notas.filter((n) => n.status === "pendente").length;
  const impostosMes    = notas
    .filter((n) => n.status === "autorizada")
    .reduce((acc, n) => acc + parseFloat(n.valor) * 0.15, 0);
  const proxObrigacao  = obrigacoes
    .filter((o) => o.status === "pendente")
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];

  const filtered = notas.filter(
    (n) =>
      n.numero.includes(search) ||
      n.cliente.toLowerCase().includes(search.toLowerCase()) ||
      n.cfop.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="NF-e Emitidas"      value={String(nfeAutorizadas)} icon={<FileText size={16} />} tone="success" />
        <Metric label="NF-e Pendentes"     value={String(nfePendentes)} icon={<Clock size={16} />} tone="warning" />
        <Metric label="Impostos do Mês"    value={fmtBRL(impostosMes)} icon={<Receipt size={16} />} />
        <Metric
          label="Próxima Obrigação"
          value={proxObrigacao ? `${proxObrigacao.nome.split(" ")[0]} – ${proxObrigacao.vencimento}` : "—"}
          icon={<Calendar size={16} />}
          tone="warning"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 panel-elevated rounded-card overflow-hidden">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between border-b border-border">
            <SectionHeader title="Notas Fiscais Eletrônicas" description="NF-e emitidas neste período" />
            <div className="flex gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8 h-8 w-40 text-sm" placeholder="NF-e / Cliente…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Button size="sm" className="h-8 gap-1.5 text-xs bg-primary text-primary-foreground">
                <Plus size={13} /> Emitir NF-e
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">NF-e</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Cliente</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Valor</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">CFOP</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Emissão</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-secondary/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">{row.numero}</td>
                    <td className="px-4 py-3 text-xs">{row.cliente}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtBRL(parseFloat(row.valor))}</td>
                    <td className="px-4 py-3 text-center font-mono text-xs">{row.cfop}</td>
                    <td className="px-4 py-3 text-center"><StatusBadgeFiscal status={row.status} /></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{row.emissao}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                          <Eye size={13} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                          <Download size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma nota fiscal encontrada</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel-elevated rounded-card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="text-sm font-semibold">Obrigações Acessórias</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Próximos vencimentos</p>
          </div>
          <div className="divide-y divide-border">
            {obrigacoes.map((ob) => (
              <div key={ob.id} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{ob.nome}</p>
                  <p className="text-xs text-muted-foreground">{ob.orgao}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{ob.competencia}</p>
                </div>
                <div className="shrink-0 text-right">
                  <StatusBadgeFiscal status={ob.status} />
                  <p className="text-xs text-muted-foreground mt-1.5 tabular-nums">{ob.vencimento}</p>
                </div>
              </div>
            ))}
            {obrigacoes.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma obrigação cadastrada</p>
            )}
          </div>
          <div className="p-4 border-t border-border">
            <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5">
              <Calendar size={12} /> Ver Calendário Fiscal
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export function ERPView({ onBack, defaultTab = "compras" }: { onBack: () => void; defaultTab?: string }) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-gradient-to-r from-emerald-600/20 via-green-600/10 to-transparent border border-emerald-500/20 px-5 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0 text-emerald-300 hover:text-emerald-100 hover:bg-emerald-500/20">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/20 text-emerald-300">
              <Layers className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-lg font-display text-foreground">ERP</h2>
              <p className="text-xs text-muted-foreground">Gestão integrada de compras, estoque, financeiro, contabilidade, RH e fiscal</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10">
              <RefreshCw size={13} /> Sincronizar
            </Button>
            <Button size="sm" className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0">
              <Download size={13} /> Exportar
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-6">
        <TabsList className="h-9 gap-1 bg-secondary p-1 rounded-md flex-wrap">
          <TabsTrigger value="compras"       className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"><ShoppingCart size={13} /> Compras</TabsTrigger>
          <TabsTrigger value="cotacao"       className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"><Scale size={13} /> Cotação</TabsTrigger>
          <TabsTrigger value="estoque"       className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"><Box size={13} /> Estoque</TabsTrigger>
          <TabsTrigger value="financeiro"    className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"><Wallet size={13} /> Financeiro</TabsTrigger>
          <TabsTrigger value="contabilidade" className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"><BookOpen size={13} /> Contabilidade</TabsTrigger>
          <TabsTrigger value="rh"            className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"><Users size={13} /> RH</TabsTrigger>
          <TabsTrigger value="fiscal"        className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"><Receipt size={13} /> Fiscal</TabsTrigger>
        </TabsList>

        <TabsContent value="compras">       <TabCompras /> </TabsContent>
        <TabsContent value="cotacao">       <TabCotacao /> </TabsContent>
        <TabsContent value="estoque">       <TabEstoque /> </TabsContent>
        <TabsContent value="financeiro">    <TabFinanceiro /> </TabsContent>
        <TabsContent value="contabilidade"> <TabContabilidade /> </TabsContent>
        <TabsContent value="rh">            <TabRH /> </TabsContent>
        <TabsContent value="fiscal">        <TabFiscal /> </TabsContent>
      </Tabs>
    </div>
  );
}
