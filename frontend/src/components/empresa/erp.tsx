import { useEffect, useState } from "react";
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
  Filter,
  Layers,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  TrendingDown,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  XCircle,
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
  type OrdemCompra,
  type ItemEstoque,
  type LancamentoFinanceiro,
  type Funcionario,
  listOrdensCompra,
  listEstoque,
  listLancamentosFinanceiros,
  listFuncionarios,
} from "@/lib/api";

// ─── Static data (no backend model) ──────────────────────────────────────────

const dreLinhas = [
  { conta: "Receita Bruta de Vendas", atual: 312500, anterior: 285000, tipo: "receita" },
  { conta: "Deduções (Impostos s/ Vendas)", atual: -46875, anterior: -42750, tipo: "deducao" },
  { conta: "Receita Líquida", atual: 265625, anterior: 242250, tipo: "subtotal" },
  { conta: "CMV – Custo Mercadoria Vendida", atual: -98400, anterior: -91200, tipo: "custo" },
  { conta: "Lucro Bruto", atual: 167225, anterior: 151050, tipo: "subtotal" },
  { conta: "Despesas com Pessoal", atual: -48200, anterior: -46500, tipo: "despesa" },
  { conta: "Despesas Administrativas", atual: -12400, anterior: -11800, tipo: "despesa" },
  { conta: "Despesas Comerciais", atual: -8750, anterior: -7900, tipo: "despesa" },
  { conta: "EBITDA", atual: 97875, anterior: 84850, tipo: "subtotal" },
  { conta: "Depreciação e Amortização", atual: -4200, anterior: -4100, tipo: "despesa" },
  { conta: "Resultado Financeiro Líquido", atual: -2300, anterior: -1950, tipo: "despesa" },
  { conta: "Lucro Antes do IR", atual: 91375, anterior: 78800, tipo: "subtotal" },
  { conta: "Imposto de Renda + CSLL", atual: -18275, anterior: -15760, tipo: "imposto" },
  { conta: "Lucro Líquido", atual: 73100, anterior: 63040, tipo: "resultado" },
];

const notasFiscais = [
  { numero: "000.001.423", cliente: "Alfa Sistemas Ltda", valor: 4800.0, cfop: "5102", status: "Autorizada", emissao: "2026-09-22" },
  { numero: "000.001.422", cliente: "Beta Corp S.A.", valor: 12000.0, cfop: "5102", status: "Autorizada", emissao: "2026-09-20" },
  { numero: "000.001.421", cliente: "Gamma Indústria", valor: 9500.0, cfop: "5101", status: "Pendente", emissao: "2026-09-19" },
  { numero: "000.001.420", cliente: "Delta Varejo ME", valor: 22000.0, cfop: "5102", status: "Autorizada", emissao: "2026-09-15" },
  { numero: "000.001.419", cliente: "Epsilon Serviços", valor: 3200.0, cfop: "5933", status: "Cancelada", emissao: "2026-09-10" },
  { numero: "000.001.418", cliente: "Zeta Comércio", valor: 6750.0, cfop: "5102", status: "Autorizada", emissao: "2026-09-08" },
];

const obrigacoesFiscais = [
  { nome: "DCTF Mensal", orgao: "Receita Federal", vencimento: "2026-10-15", competencia: "Setembro/2026", status: "Pendente" },
  { nome: "SPED Fiscal", orgao: "SEFAZ", vencimento: "2026-10-20", competencia: "Setembro/2026", status: "Pendente" },
  { nome: "EFD-Reinf", orgao: "Receita Federal", vencimento: "2026-10-15", competencia: "Setembro/2026", status: "Pendente" },
  { nome: "GFIP/SEFIP", orgao: "Caixa Econômica", vencimento: "2026-10-07", competencia: "Setembro/2026", status: "Pendente" },
  { nome: "DASN-SIMEI", orgao: "Receita Federal", vencimento: "2026-10-31", competencia: "2025 (Anual)", status: "Agendado" },
];

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

function StatusBadgeCompra({ status }: { status: OrdemCompra["status"] }) {
  const label: Record<OrdemCompra["status"], string> = {
    rascunho: "Rascunho",
    aprovado:  "Aprovado",
    enviado:   "Em Trânsito",
    recebido:  "Recebido",
    cancelado: "Cancelado",
  };
  const map: Record<OrdemCompra["status"], string> = {
    rascunho:  "bg-secondary text-muted-foreground border border-border",
    aprovado:  "bg-primary text-primary-foreground",
    enviado:   "bg-warning text-foreground",
    recebido:  "bg-success text-foreground",
    cancelado: "bg-destructive/20 text-destructive",
  };
  return <Badge className={map[status]}>{label[status]}</Badge>;
}

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
    Autorizada: "bg-success text-foreground",
    Cancelada:  "bg-warning text-foreground",
    Pendente:   "bg-secondary text-muted-foreground border border-border",
    Agendado:   "bg-primary text-primary-foreground",
  };
  return <Badge className={map[status] ?? "bg-secondary text-muted-foreground"}>{status}</Badge>;
}

// ─── Tab: Compras ─────────────────────────────────────────────────────────────

function TabCompras() {
  const [ordens, setOrdens] = useState<OrdemCompra[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    listOrdensCompra().then(setOrdens).catch(() => {});
  }, []);

  const filtered = ordens.filter(
    (c) =>
      c.numero.toLowerCase().includes(search.toLowerCase()) ||
      c.fornecedor_nome.toLowerCase().includes(search.toLowerCase())
  );
  const valorPendente = ordens
    .filter((c) => c.status !== "recebido")
    .reduce((acc, c) => acc + parseFloat(c.valor_total), 0);
  const fornecedores = [...new Set(ordens.map((c) => c.fornecedor_nome))].length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Pedidos Abertos" value={String(ordens.filter((c) => c.status !== "recebido").length)} icon={<ClipboardList size={16} />} />
        <Metric label="Valor Total Pendente" value={fmtBRL(valorPendente)} icon={<DollarSign size={16} />} tone="warning" />
        <Metric label="Fornecedores Ativos" value={String(fornecedores)} icon={<Truck size={16} />} />
        <Metric label="Economias do Mês" value="R$ 4.230,00" icon={<TrendingDown size={16} />} tone="success" />
      </div>

      <div className="panel-elevated rounded-card overflow-hidden">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between border-b border-border">
          <SectionHeader title="Pedidos de Compra" description="Gestão de ordens de compra e fornecedores" />
          <div className="flex gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 h-8 w-48 text-sm"
                placeholder="Buscar pedido…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
              <Filter size={13} /> Filtrar
            </Button>
            <Button size="sm" className="h-8 gap-1.5 text-xs bg-primary text-primary-foreground">
              <Plus size={13} /> Novo Pedido
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Pedido #</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Fornecedor</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Valor Total</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Data Prevista</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-secondary/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-medium">{row.numero}</td>
                  <td className="px-4 py-3">{row.fornecedor_nome}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtBRL(parseFloat(row.valor_total))}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadgeCompra status={row.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{row.data_entrega_prevista ?? "—"}</td>
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
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum pedido encontrado</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Estoque ─────────────────────────────────────────────────────────────

function TabEstoque() {
  const [itens, setItens] = useState<ItemEstoque[]>([]);
  const [search, setSearch] = useState("");
  const [categoria, setCategoria] = useState("Todas");

  useEffect(() => {
    listEstoque().then(setItens).catch(() => {});
  }, []);

  const abaixoMin = itens.filter((e) => e.abaixo_minimo).length;
  const valorTotal = itens.reduce((acc, e) => acc + e.valor_total, 0);
  const categorias = ["Todas", ...new Set(itens.map((e) => e.categoria))];
  const filtered = itens.filter(
    (e) =>
      (categoria === "Todas" || e.categoria === categoria) &&
      (e.nome.toLowerCase().includes(search.toLowerCase()) || e.codigo.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Itens em Estoque" value={String(itens.length)} icon={<Package size={16} />} />
        <Metric label="Valor Total" value={fmtBRL(valorTotal)} icon={<DollarSign size={16} />} />
        <Metric label="Itens Abaixo do Mínimo" value={String(abaixoMin)} icon={<AlertTriangle size={16} />} tone="warning" />
        <Metric label="Giro Médio (dias)" value="18,4" icon={<RefreshCw size={16} />} tone="success" />
      </div>

      <div className="panel-elevated rounded-card overflow-hidden">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between border-b border-border">
          <SectionHeader title="Controle de Estoque" description="Posição atual, limites e localização" />
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8 h-8 w-44 text-sm" placeholder="Produto / Código…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                {categorias.map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 gap-1.5 text-xs bg-primary text-primary-foreground">
              <Upload size={13} /> Entrada
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
                    <Badge className="bg-secondary text-muted-foreground border border-border text-xs">{row.categoria}</Badge>
                  </td>
                  <td className={`px-4 py-3 text-center tabular-nums font-bold ${row.abaixo_minimo ? "text-warning" : ""}`}>{row.quantidade}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">{row.quantidade_minima}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.localizacao}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtBRL(parseFloat(row.custo_unitario))}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                        <Edit2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum item encontrado</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
  const saldo = 128450.0;
  const resultado = 73100.0;

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
  const receitaBruta = dreLinhas.find((d) => d.conta === "Receita Bruta de Vendas")!;
  const deducoes     = dreLinhas.find((d) => d.conta === "Deduções (Impostos s/ Vendas)")!;
  const receitaLiq   = dreLinhas.find((d) => d.conta === "Receita Líquida")!;
  const ebitda       = dreLinhas.find((d) => d.conta === "EBITDA")!;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Receita Bruta"   value={fmtBRL(receitaBruta.atual)} icon={<TrendingUp size={16} />} tone="success" />
        <Metric label="Deduções"        value={fmtBRL(Math.abs(deducoes.atual))} icon={<TrendingDown size={16} />} tone="warning" />
        <Metric label="Receita Líquida" value={fmtBRL(receitaLiq.atual)} icon={<BarChart2 size={16} />} />
        <Metric label="EBITDA"          value={fmtBRL(ebitda.atual)} icon={<DollarSign size={16} />} tone="success" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 panel-elevated rounded-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div>
              <h3 className="text-sm font-semibold">DRE – Demonstração do Resultado</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Competência: Setembro/2026</p>
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
                {dreLinhas.map((row, i) => {
                  const var_ = variacao(row.atual, row.anterior);
                  const isSubtotal = row.tipo === "subtotal" || row.tipo === "resultado";
                  const isNegative = row.atual < 0;
                  const varPositive = var_ >= 0;
                  return (
                    <tr
                      key={i}
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
                        {isNegative ? `(${fmtBRL(Math.abs(row.atual))})` : fmtBRL(row.atual)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs text-muted-foreground">
                        {row.anterior < 0 ? `(${fmtBRL(Math.abs(row.anterior))})` : fmtBRL(row.anterior)}
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
            <div className="space-y-3">
              {[
                { label: "Ativo Total",        value: 842300, tone: "success" as const },
                { label: "Passivo Total",       value: 514800, tone: "warning" as const },
                { label: "Patrimônio Líquido",  value: 327500, tone: "default" as const },
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
          </div>

          <div className="panel-elevated rounded-card p-4">
            <h3 className="text-sm font-semibold mb-3">Indicadores</h3>
            <div className="space-y-2.5">
              {[
                { label: "Margem Bruta",    value: "62,9%" },
                { label: "Margem EBITDA",   value: "31,3%" },
                { label: "Margem Líquida",  value: "23,4%" },
                { label: "ROE (mensal)",    value: "22,3%" },
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Total Colaboradores" value={String(colaboradores.length)} icon={<Users size={16} />} />
        <Metric label="Admissões no Mês"    value="2" icon={<Plus size={16} />} tone="success" />
        <Metric label="Desligamentos"        value="0" icon={<XCircle size={16} />} />
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
  const [search, setSearch] = useState("");
  const nfeAutorizadas = notasFiscais.filter((n) => n.status === "Autorizada").length;
  const nfePendentes   = notasFiscais.filter((n) => n.status === "Pendente").length;
  const impostosMes    = 46875 + 18275;
  const proxObrigacao  = "GFIP – 07/Out";

  const filtered = notasFiscais.filter(
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
        <Metric label="Próxima Obrigação"  value={proxObrigacao} icon={<Calendar size={16} />} tone="warning" />
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
                  <tr key={row.numero} className="hover:bg-secondary/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">{row.numero}</td>
                    <td className="px-4 py-3 text-xs">{row.cliente}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtBRL(row.valor)}</td>
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
            {obrigacoesFiscais.map((ob, i) => (
              <div key={i} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors">
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
          <TabsTrigger value="estoque"       className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"><Box size={13} /> Estoque</TabsTrigger>
          <TabsTrigger value="financeiro"    className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"><Wallet size={13} /> Financeiro</TabsTrigger>
          <TabsTrigger value="contabilidade" className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"><BookOpen size={13} /> Contabilidade</TabsTrigger>
          <TabsTrigger value="rh"            className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"><Users size={13} /> RH</TabsTrigger>
          <TabsTrigger value="fiscal"        className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"><Receipt size={13} /> Fiscal</TabsTrigger>
        </TabsList>

        <TabsContent value="compras">       <TabCompras /> </TabsContent>
        <TabsContent value="estoque">       <TabEstoque /> </TabsContent>
        <TabsContent value="financeiro">    <TabFinanceiro /> </TabsContent>
        <TabsContent value="contabilidade"> <TabContabilidade /> </TabsContent>
        <TabsContent value="rh">            <TabRH /> </TabsContent>
        <TabsContent value="fiscal">        <TabFiscal /> </TabsContent>
      </Tabs>
    </div>
  );
}
