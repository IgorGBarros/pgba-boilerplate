import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownCircle,
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

// ─── Mock data ────────────────────────────────────────────────────────────────

const compras = [
  { id: "PC-0041", fornecedor: "TechSupply Ltda", itens: 12, valor: 48320.0, status: "Em Trânsito", previsto: "2026-09-28" },
  { id: "PC-0040", fornecedor: "Global Parts S.A.", itens: 5, valor: 12750.0, status: "Aprovado", previsto: "2026-10-03" },
  { id: "PC-0039", fornecedor: "Distribuidora Norte", itens: 30, valor: 8900.0, status: "Recebido", previsto: "2026-09-20" },
  { id: "PC-0038", fornecedor: "Insumos Rápidos ME", itens: 8, valor: 3450.0, status: "Rascunho", previsto: "2026-10-10" },
  { id: "PC-0037", fornecedor: "TechSupply Ltda", itens: 20, valor: 62100.0, status: "Aprovado", previsto: "2026-09-30" },
  { id: "PC-0036", fornecedor: "Papelaria Central", itens: 45, valor: 1870.0, status: "Recebido", previsto: "2026-09-18" },
];

const estoque = [
  { produto: "Notebook Dell Inspiron 15", sku: "NB-DEL-001", categoria: "Informática", qtd: 14, min: 5, max: 30, loc: "A1-01", valorUnit: 3499.0 },
  { produto: "Monitor LG 24\"", sku: "MN-LG-024", categoria: "Informática", qtd: 3, min: 5, max: 20, loc: "A1-02", valorUnit: 899.0 },
  { produto: "Cadeira Executiva Ergonômica", sku: "MV-CAD-EX", categoria: "Mobiliário", qtd: 7, min: 3, max: 15, loc: "B2-04", valorUnit: 1250.0 },
  { produto: "Papel A4 Resma 500fls", sku: "PP-A4-500", categoria: "Escritório", qtd: 2, min: 10, max: 50, loc: "C3-01", valorUnit: 28.5 },
  { produto: "Teclado Mecânico RGB", sku: "TEC-MEC-RG", categoria: "Informática", qtd: 9, min: 4, max: 20, loc: "A1-03", valorUnit: 320.0 },
  { produto: "Caneta Esferográfica Cx12", sku: "PP-CAN-12", categoria: "Escritório", qtd: 1, min: 5, max: 25, loc: "C3-02", valorUnit: 12.9 },
  { produto: "Headset USB Logitech", sku: "HS-LOG-USB", categoria: "Informática", qtd: 6, min: 3, max: 12, loc: "A2-01", valorUnit: 189.0 },
  { produto: "Servidor HP ProLiant", sku: "SRV-HP-PRO", categoria: "Infraestrutura", qtd: 2, min: 1, max: 4, loc: "D1-01", valorUnit: 18750.0 },
];

const contasReceber = [
  { descricao: "Contrato de Suporte Mensal", cliente: "Alfa Sistemas Ltda", vencimento: "2026-09-30", valor: 4800.0, status: "Pendente" },
  { descricao: "Licença Anual Software", cliente: "Beta Corp S.A.", vencimento: "2026-09-15", valor: 12000.0, status: "Vencido" },
  { descricao: "Consultoria – Fase 2", cliente: "Gamma Indústria", vencimento: "2026-10-05", valor: 9500.0, status: "Pendente" },
  { descricao: "Implantação ERP", cliente: "Delta Varejo ME", vencimento: "2026-08-31", valor: 22000.0, status: "Pago" },
  { descricao: "Treinamento Equipe", cliente: "Epsilon Serviços", vencimento: "2026-10-15", valor: 3200.0, status: "Pendente" },
];

const contasPagar = [
  { descricao: "Aluguel Sede", fornecedor: "Imóveis Prime Ltda", vencimento: "2026-10-05", valor: 7500.0, status: "Pendente" },
  { descricao: "Folha de Pagamento", fornecedor: "Colaboradores", vencimento: "2026-09-30", valor: 48200.0, status: "Pendente" },
  { descricao: "Serviços de Cloud AWS", fornecedor: "Amazon Brasil", vencimento: "2026-09-25", valor: 2340.0, status: "Vencido" },
  { descricao: "Internet Fibra 500Mb", fornecedor: "Claro Telecom", vencimento: "2026-09-20", valor: 890.0, status: "Pago" },
  { descricao: "Material de Escritório", fornecedor: "Papelaria Central", vencimento: "2026-10-12", valor: 1870.0, status: "Pendente" },
];

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

const colaboradores = [
  { nome: "Ana Lima", cargo: "Gerente de Projetos", depto: "Tecnologia", admissao: "2021-03-15", salario: 12500.0, status: "Ativo" },
  { nome: "Bruno Carvalho", cargo: "Desenvolvedor Sênior", depto: "Tecnologia", admissao: "2022-07-01", salario: 9800.0, status: "Ativo" },
  { nome: "Carla Souza", cargo: "Analista Financeira", depto: "Financeiro", admissao: "2020-11-20", salario: 8200.0, status: "Férias" },
  { nome: "Diego Ferreira", cargo: "Vendedor Externo", depto: "Comercial", admissao: "2023-01-10", salario: 5400.0, status: "Ativo" },
  { nome: "Eduarda Santos", cargo: "Designer UX/UI", depto: "Produto", admissao: "2022-04-05", salario: 7600.0, status: "Afastado" },
  { nome: "Felipe Nunes", cargo: "Analista de Suporte", depto: "Operações", admissao: "2023-08-22", salario: 4900.0, status: "Ativo" },
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

function StatusBadgeCompra({ status }: { status: string }) {
  const map: Record<string, string> = {
    Rascunho: "bg-secondary text-muted-foreground border border-border",
    Aprovado: "bg-primary text-primary-foreground",
    "Em Trânsito": "bg-warning text-foreground",
    Recebido: "bg-success text-foreground",
  };
  return <Badge className={map[status] ?? "bg-secondary text-muted-foreground"}>{status}</Badge>;
}

function StatusBadgeFinanceiro({ status }: { status: string }) {
  const map: Record<string, string> = {
    Pendente: "bg-secondary text-muted-foreground border border-border",
    Vencido: "bg-warning text-foreground",
    Pago: "bg-success text-foreground",
  };
  return <Badge className={map[status] ?? "bg-secondary text-muted-foreground"}>{status}</Badge>;
}

function StatusBadgeRH({ status }: { status: string }) {
  const map: Record<string, string> = {
    Ativo: "bg-success text-foreground",
    Férias: "bg-primary text-primary-foreground",
    Afastado: "bg-warning text-foreground",
  };
  return <Badge className={map[status] ?? "bg-secondary text-muted-foreground"}>{status}</Badge>;
}

function StatusBadgeFiscal({ status }: { status: string }) {
  const map: Record<string, string> = {
    Autorizada: "bg-success text-foreground",
    Cancelada: "bg-warning text-foreground",
    Pendente: "bg-secondary text-muted-foreground border border-border",
    Agendado: "bg-primary text-primary-foreground",
  };
  return <Badge className={map[status] ?? "bg-secondary text-muted-foreground"}>{status}</Badge>;
}

// ─── Tab: Compras ─────────────────────────────────────────────────────────────

function TabCompras() {
  const [search, setSearch] = useState("");
  const filtered = compras.filter(
    (c) =>
      c.id.toLowerCase().includes(search.toLowerCase()) ||
      c.fornecedor.toLowerCase().includes(search.toLowerCase())
  );
  const valorPendente = compras
    .filter((c) => c.status !== "Recebido")
    .reduce((acc, c) => acc + c.valor, 0);
  const fornecedores = [...new Set(compras.map((c) => c.fornecedor))].length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Pedidos Abertos" value={String(compras.filter((c) => c.status !== "Recebido").length)} icon={<ClipboardList size={16} />} />
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
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Itens</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Valor Total</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Data Prevista</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-secondary/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-medium">{row.id}</td>
                  <td className="px-4 py-3">{row.fornecedor}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.itens}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtBRL(row.valor)}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadgeCompra status={row.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{row.previsto}</td>
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
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Estoque ─────────────────────────────────────────────────────────────

function TabEstoque() {
  const [search, setSearch] = useState("");
  const [categoria, setCategoria] = useState("Todas");
  const abaixoMin = estoque.filter((e) => e.qtd < e.min).length;
  const valorTotal = estoque.reduce((acc, e) => acc + e.qtd * e.valorUnit, 0);
  const categorias = ["Todas", ...new Set(estoque.map((e) => e.categoria))];
  const filtered = estoque.filter(
    (e) =>
      (categoria === "Todas" || e.categoria === categoria) &&
      (e.produto.toLowerCase().includes(search.toLowerCase()) || e.sku.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Itens em Estoque" value={String(estoque.length)} icon={<Package size={16} />} />
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
              <Input className="pl-8 h-8 w-44 text-sm" placeholder="Produto / SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">SKU</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Categoria</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Qtd</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Mín</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Máx</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Localização</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Valor Unit.</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((row) => {
                const baixo = row.qtd < row.min;
                return (
                  <tr key={row.sku} className={`transition-colors ${baixo ? "bg-warning/10 hover:bg-warning/15" : "hover:bg-secondary/50"}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {baixo && <AlertTriangle size={13} className="text-warning shrink-0" />}
                        <span className={baixo ? "font-medium text-warning" : ""}>{row.produto}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.sku}</td>
                    <td className="px-4 py-3">
                      <Badge className="bg-secondary text-muted-foreground border border-border text-xs">{row.categoria}</Badge>
                    </td>
                    <td className={`px-4 py-3 text-center tabular-nums font-bold ${baixo ? "text-warning" : ""}`}>{row.qtd}</td>
                    <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">{row.min}</td>
                    <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">{row.max}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.loc}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtBRL(row.valorUnit)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                          <Edit2 size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Financeiro ──────────────────────────────────────────────────────────

type FinanceiroRow = { descricao: string; vencimento: string; valor: number; status: string; cliente?: string; fornecedor?: string };
function TabelaFinanceiro({ rows, tipo }: { rows: FinanceiroRow[]; tipo: "receber" | "pagar" }) {
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
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-secondary/50 transition-colors">
                <td className="px-4 py-3 text-xs">{row.descricao}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{"cliente" in row ? row.cliente : row.fornecedor}</td>
                <td className="px-4 py-3 text-xs">{row.vencimento}</td>
                <td className="px-4 py-3 text-right tabular-nums text-sm font-medium">{fmtBRL(row.valor)}</td>
                <td className="px-4 py-3 text-center">
                  <StatusBadgeFinanceiro status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabFinanceiro() {
  const totalReceber = contasReceber.filter((c) => c.status !== "Pago").reduce((a, c) => a + c.valor, 0);
  const totalPagar = contasPagar.filter((c) => c.status !== "Pago").reduce((a, c) => a + c.valor, 0);
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
        <TabelaFinanceiro rows={contasPagar} tipo="pagar" />
      </div>
    </div>
  );
}

// ─── Tab: Contabilidade ───────────────────────────────────────────────────────

function TabContabilidade() {
  const receitaBruta = dreLinhas.find((d) => d.conta === "Receita Bruta de Vendas")!;
  const deducoes = dreLinhas.find((d) => d.conta === "Deduções (Impostos s/ Vendas)")!;
  const receitaLiq = dreLinhas.find((d) => d.conta === "Receita Líquida")!;
  const ebitda = dreLinhas.find((d) => d.conta === "EBITDA")!;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Receita Bruta" value={fmtBRL(receitaBruta.atual)} icon={<TrendingUp size={16} />} tone="success" />
        <Metric label="Deduções" value={fmtBRL(Math.abs(deducoes.atual))} icon={<TrendingDown size={16} />} tone="warning" />
        <Metric label="Receita Líquida" value={fmtBRL(receitaLiq.atual)} icon={<BarChart2 size={16} />} />
        <Metric label="EBITDA" value={fmtBRL(ebitda.atual)} icon={<DollarSign size={16} />} tone="success" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* DRE */}
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
                        isSubtotal
                          ? "bg-elevated font-semibold"
                          : row.tipo === "resultado"
                          ? "bg-success/10 font-bold"
                          : "hover:bg-secondary/50"
                      }`}
                    >
                      <td className={`px-4 py-2.5 text-xs ${isSubtotal ? "font-semibold" : ""}`}>
                        {isSubtotal ? <span className="flex items-center gap-1.5"><ChevronRight size={12} className="text-muted-foreground" />{row.conta}</span> : row.conta}
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

        {/* Balancete */}
        <div className="flex flex-col gap-4">
          <div className="panel-elevated rounded-card p-4">
            <h3 className="text-sm font-semibold mb-4">Balancete Resumido</h3>
            <div className="space-y-3">
              {[
                { label: "Ativo Total", value: 842300, tone: "success" as const },
                { label: "Passivo Total", value: 514800, tone: "warning" as const },
                { label: "Patrimônio Líquido", value: 327500, tone: "default" as const },
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
                { label: "Margem Bruta", value: "62,9%" },
                { label: "Margem EBITDA", value: "31,3%" },
                { label: "Margem Líquida", value: "23,4%" },
                { label: "ROE (mensal)", value: "22,3%" },
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
  const [search, setSearch] = useState("");
  const filtered = colaboradores.filter(
    (c) =>
      c.nome.toLowerCase().includes(search.toLowerCase()) ||
      c.cargo.toLowerCase().includes(search.toLowerCase()) ||
      c.depto.toLowerCase().includes(search.toLowerCase())
  );
  const totalFolha = colaboradores.reduce((a, c) => a + c.salario, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Total Colaboradores" value={String(colaboradores.length)} icon={<Users size={16} />} />
        <Metric label="Admissões no Mês" value="2" icon={<Plus size={16} />} tone="success" />
        <Metric label="Desligamentos" value="0" icon={<XCircle size={16} />} />
        <Metric label="Custo Total Folha" value={fmtBRL(totalFolha)} icon={<Briefcase size={16} />} tone="warning" />
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
                <tr key={row.nome} className="hover:bg-secondary/50 transition-colors">
                  <td className="px-4 py-3 font-medium">{row.nome}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{row.cargo}</td>
                  <td className="px-4 py-3">
                    <Badge className="bg-secondary text-muted-foreground border border-border text-xs">{row.depto}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{row.admissao}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtBRL(row.salario)}</td>
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
            </tbody>
          </table>
        </div>
      </div>

      {/* Distribuição por departamento */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {["Tecnologia", "Financeiro", "Comercial", "Produto", "Operações"].map((depto) => {
          const count = colaboradores.filter((c) => c.depto === depto).length;
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
  const nfePendentes = notasFiscais.filter((n) => n.status === "Pendente").length;
  const impostosMes = 46875 + 18275;
  const proxObrigacao = "GFIP – 07/Out";

  const filtered = notasFiscais.filter(
    (n) =>
      n.numero.includes(search) ||
      n.cliente.toLowerCase().includes(search.toLowerCase()) ||
      n.cfop.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="NF-e Emitidas" value={String(nfeAutorizadas)} icon={<FileText size={16} />} tone="success" />
        <Metric label="NF-e Pendentes" value={String(nfePendentes)} icon={<Clock size={16} />} tone="warning" />
        <Metric label="Impostos do Mês" value={fmtBRL(impostosMes)} icon={<Receipt size={16} />} />
        <Metric label="Próxima Obrigação" value={proxObrigacao} icon={<Calendar size={16} />} tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Tabela NF-e */}
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
                    <td className="px-4 py-3 text-center">
                      <StatusBadgeFiscal status={row.status} />
                    </td>
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

        {/* Obrigações Fiscais */}
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

export function ERPView() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="ERP"
        description="Gestão integrada de compras, estoque, financeiro, contabilidade, RH e fiscal"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <RefreshCw size={13} /> Sincronizar
            </Button>
            <Button size="sm" className="h-8 gap-1.5 text-xs bg-primary text-primary-foreground">
              <Download size={13} /> Exportar
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="compras" className="space-y-6">
        <TabsList className="h-9 gap-1 bg-secondary p-1 rounded-md flex-wrap">
          <TabsTrigger value="compras" className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <ShoppingCart size={13} /> Compras
          </TabsTrigger>
          <TabsTrigger value="estoque" className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Box size={13} /> Estoque
          </TabsTrigger>
          <TabsTrigger value="financeiro" className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Wallet size={13} /> Financeiro
          </TabsTrigger>
          <TabsTrigger value="contabilidade" className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <BookOpen size={13} /> Contabilidade
          </TabsTrigger>
          <TabsTrigger value="rh" className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Users size={13} /> RH
          </TabsTrigger>
          <TabsTrigger value="fiscal" className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Receipt size={13} /> Fiscal
          </TabsTrigger>
        </TabsList>

        <TabsContent value="compras">
          <TabCompras />
        </TabsContent>
        <TabsContent value="estoque">
          <TabEstoque />
        </TabsContent>
        <TabsContent value="financeiro">
          <TabFinanceiro />
        </TabsContent>
        <TabsContent value="contabilidade">
          <TabContabilidade />
        </TabsContent>
        <TabsContent value="rh">
          <TabRH />
        </TabsContent>
        <TabsContent value="fiscal">
          <TabFiscal />
        </TabsContent>
      </Tabs>
    </div>
  );
}
