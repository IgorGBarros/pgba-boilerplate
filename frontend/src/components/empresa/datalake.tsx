import { useState } from "react";
import {
  Database,
  Table2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileText,
  Tag,
  Clock,
  CheckCircle2,
  Circle,
  AlertCircle,
  HardDrive,
  Layers,
  BookOpen,
  Zap,
  Link2,
  Lock,
  Server,
  Cpu,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionHeader, Metric } from "@/components/empresa/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

type ColumnType =
  | "VARCHAR"
  | "BIGINT"
  | "TIMESTAMP"
  | "BOOLEAN"
  | "JSONB"
  | "VECTOR"
  | "UUID"
  | "INTEGER"
  | "TEXT"
  | "NUMERIC";

interface Column {
  name: string;
  type: ColumnType;
  nullable: boolean;
  description: string;
}

interface TableDef {
  name: string;
  schema: string;
  rows: number;
  columns: Column[];
  lastUpdated: string;
  description: string;
}

interface Schema {
  id: string;
  label: string;
  tables: TableDef[];
}

type NoteStatus = "indexed" | "pending" | "excluded";

interface ObsidianNote {
  title: string;
  tags: string[];
  lastModified: string;
  chunks: number;
  hasEmbedding: boolean;
  status: NoteStatus;
}

interface SyncEvent {
  timestamp: string;
  added: number;
  updated: number;
  removed: number;
  duration: string;
}

type RoadmapStatus = "done" | "in-progress" | "planned";

interface RoadmapItem {
  label: string;
  status: RoadmapStatus;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const SCHEMAS: Schema[] = [
  {
    id: "crm",
    label: "CRM",
    tables: [
      {
        name: "contacts",
        schema: "crm",
        rows: 48320,
        lastUpdated: "2026-09-23 08:14",
        description: "Contatos e leads do CRM",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "full_name", type: "VARCHAR", nullable: false, description: "Nome completo" },
          { name: "email", type: "VARCHAR", nullable: true, description: "E-mail (mascarado via LGPD)" },
          { name: "phone", type: "VARCHAR", nullable: true, description: "Telefone (mascarado)" },
          { name: "metadata", type: "JSONB", nullable: true, description: "Campos customizados por tenant" },
          { name: "created_at", type: "TIMESTAMP", nullable: false, description: "Data de criação" },
          { name: "deleted_at", type: "TIMESTAMP", nullable: true, description: "Soft delete (SoftDeleteMixin)" },
        ],
      },
      {
        name: "deals",
        schema: "crm",
        rows: 12450,
        lastUpdated: "2026-09-23 07:55",
        description: "Oportunidades e negociações",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "contact_id", type: "UUID", nullable: false, description: "FK para contacts" },
          { name: "stage", type: "VARCHAR", nullable: false, description: "Fase do funil" },
          { name: "value", type: "NUMERIC", nullable: true, description: "Valor estimado (R$)" },
          { name: "is_active", type: "BOOLEAN", nullable: false, description: "Se a negociação está ativa" },
          { name: "closed_at", type: "TIMESTAMP", nullable: true, description: "Data de fechamento" },
        ],
      },
      {
        name: "activities",
        schema: "crm",
        rows: 87200,
        lastUpdated: "2026-09-23 09:01",
        description: "Log de interações com contatos",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "deal_id", type: "UUID", nullable: true, description: "FK para deals" },
          { name: "kind", type: "VARCHAR", nullable: false, description: "Tipo: call, email, meeting" },
          { name: "notes", type: "TEXT", nullable: true, description: "Anotações (não-PII)" },
          { name: "occurred_at", type: "TIMESTAMP", nullable: false, description: "Quando ocorreu" },
        ],
      },
    ],
  },
  {
    id: "erp",
    label: "ERP",
    tables: [
      {
        name: "products",
        schema: "erp",
        rows: 9870,
        lastUpdated: "2026-09-22 23:30",
        description: "Catálogo de produtos",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "sku", type: "VARCHAR", nullable: false, description: "Código de produto" },
          { name: "name", type: "VARCHAR", nullable: false, description: "Nome do produto" },
          { name: "price", type: "NUMERIC", nullable: false, description: "Preço de venda" },
          { name: "is_active", type: "BOOLEAN", nullable: false, description: "Se está ativo no catálogo" },
        ],
      },
      {
        name: "inventory_items",
        schema: "erp",
        rows: 31580,
        lastUpdated: "2026-09-23 06:45",
        description: "Itens de estoque por produto e localização",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "product_id", type: "UUID", nullable: false, description: "FK para products" },
          { name: "quantity", type: "INTEGER", nullable: false, description: "Unidades disponíveis" },
          { name: "location", type: "VARCHAR", nullable: true, description: "Depósito ou localização" },
          { name: "updated_at", type: "TIMESTAMP", nullable: false, description: "Última atualização" },
        ],
      },
      {
        name: "sales",
        schema: "erp",
        rows: 215400,
        lastUpdated: "2026-09-23 09:00",
        description: "Vendas realizadas",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "product_id", type: "UUID", nullable: false, description: "FK para products" },
          { name: "quantity_sold", type: "INTEGER", nullable: false, description: "Quantidade vendida" },
          { name: "unit_price", type: "NUMERIC", nullable: false, description: "Preço no momento da venda" },
          { name: "sold_at", type: "TIMESTAMP", nullable: false, description: "Data da venda" },
        ],
      },
    ],
  },
  {
    id: "agency",
    label: "Agência",
    tables: [
      {
        name: "agents",
        schema: "agency",
        rows: 24,
        lastUpdated: "2026-09-23 08:00",
        description: "Agentes de IA registrados",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "name", type: "VARCHAR", nullable: false, description: "Nome do agente" },
          { name: "access_level", type: "VARCHAR", nullable: false, description: "CEO / orchestrator / operational" },
          { name: "autonomy_level", type: "INTEGER", nullable: false, description: "0-4 (OBSERVER→AUTONOMOUS)" },
          { name: "work_status", type: "VARCHAR", nullable: false, description: "idle / working / paused" },
          { name: "last_active_at", type: "TIMESTAMP", nullable: true, description: "Última interação registrada" },
        ],
      },
      {
        name: "agent_interactions",
        schema: "agency",
        rows: 5840,
        lastUpdated: "2026-09-23 09:02",
        description: "Histórico de interações de cada agente",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "agent_id", type: "UUID", nullable: false, description: "FK para agents" },
          { name: "query_log_id", type: "BIGINT", nullable: true, description: "ID solto p/ orchestration.QueryLog" },
          { name: "tokens_used", type: "INTEGER", nullable: true, description: "Tokens consumidos" },
          { name: "cost_estimate", type: "NUMERIC", nullable: true, description: "Custo estimado em R$" },
          { name: "created_at", type: "TIMESTAMP", nullable: false, description: "Quando ocorreu" },
        ],
      },
      {
        name: "tasks",
        schema: "agency",
        rows: 312,
        lastUpdated: "2026-09-23 08:58",
        description: "Tarefas do ciclo de vida de agentes",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "agent_id", type: "UUID", nullable: false, description: "FK para agents" },
          { name: "status", type: "VARCHAR", nullable: false, description: "CREATED / IN_PROGRESS / APPROVED / REJECTED" },
          { name: "progress", type: "NUMERIC", nullable: false, description: "0.0 a 1.0" },
          { name: "brief", type: "TEXT", nullable: true, description: "Descrição da tarefa" },
          { name: "version", type: "INTEGER", nullable: false, description: "Sobe a cada interrupção" },
          { name: "result", type: "JSONB", nullable: true, description: "Resultado gerado" },
        ],
      },
    ],
  },
  {
    id: "ingestion",
    label: "Conhecimento / Obsidian",
    tables: [
      {
        name: "knowledge_sources",
        schema: "ingestion",
        rows: 18,
        lastUpdated: "2026-09-22 20:10",
        description: "Fontes de conhecimento (Obsidian, URL, upload, API)",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "source_type", type: "VARCHAR", nullable: false, description: "obsidian / url / upload / api" },
          { name: "config", type: "JSONB", nullable: false, description: "include_tags, vault_path, etc." },
          { name: "last_synced_at", type: "TIMESTAMP", nullable: true, description: "Última sincronização" },
        ],
      },
      {
        name: "documents",
        schema: "ingestion",
        rows: 4280,
        lastUpdated: "2026-09-23 03:15",
        description: "Unidades de conteúdo indexadas (1 por nota/arquivo)",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "source_id", type: "UUID", nullable: false, description: "FK para knowledge_sources" },
          { name: "title", type: "VARCHAR", nullable: true, description: "Título do documento" },
          { name: "content_hash", type: "VARCHAR", nullable: false, description: "Hash SHA256 do conteúdo" },
          { name: "metadata", type: "JSONB", nullable: true, description: "Tags, frontmatter, etc." },
          { name: "is_private", type: "BOOLEAN", nullable: false, description: "private:true no frontmatter → nunca indexado" },
        ],
      },
      {
        name: "document_chunks",
        schema: "ingestion",
        rows: 38720,
        lastUpdated: "2026-09-23 03:18",
        description: "Pedaços vetorizados para busca semântica (pgvector)",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "document_id", type: "UUID", nullable: false, description: "FK para documents" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant (denormalizado)" },
          { name: "content", type: "TEXT", nullable: false, description: "Texto do chunk" },
          { name: "embedding", type: "VECTOR", nullable: true, description: "Vetor pgvector (1536d ou 768d)" },
          { name: "chunk_index", type: "INTEGER", nullable: false, description: "Ordem dentro do documento" },
          { name: "token_count", type: "INTEGER", nullable: true, description: "Tokens estimados" },
        ],
      },
    ],
  },
  {
    id: "financeiro",
    label: "Financeiro",
    tables: [
      {
        name: "transactions",
        schema: "financeiro",
        rows: 143200,
        lastUpdated: "2026-09-23 00:05",
        description: "Movimentações financeiras",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "kind", type: "VARCHAR", nullable: false, description: "credit / debit" },
          { name: "amount", type: "NUMERIC", nullable: false, description: "Valor em R$" },
          { name: "category", type: "VARCHAR", nullable: true, description: "Categoria contábil" },
          { name: "occurred_at", type: "TIMESTAMP", nullable: false, description: "Data da movimentação" },
          { name: "deleted_at", type: "TIMESTAMP", nullable: true, description: "Soft delete" },
        ],
      },
      {
        name: "invoices",
        schema: "financeiro",
        rows: 28600,
        lastUpdated: "2026-09-22 22:30",
        description: "Notas fiscais emitidas",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "number", type: "VARCHAR", nullable: false, description: "Número da NF" },
          { name: "status", type: "VARCHAR", nullable: false, description: "issued / cancelled / pending" },
          { name: "total", type: "NUMERIC", nullable: false, description: "Valor total" },
          { name: "issued_at", type: "TIMESTAMP", nullable: true, description: "Data de emissão" },
        ],
      },
    ],
  },
  {
    id: "rh",
    label: "RH",
    tables: [
      {
        name: "employees",
        schema: "rh",
        rows: 890,
        lastUpdated: "2026-09-21 18:00",
        description: "Colaboradores ativos e histórico",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "full_name", type: "VARCHAR", nullable: false, description: "Nome completo" },
          { name: "cpf_hash", type: "VARCHAR", nullable: true, description: "CPF hasheado (nunca em texto puro — LGPD)" },
          { name: "department", type: "VARCHAR", nullable: true, description: "Departamento" },
          { name: "is_active", type: "BOOLEAN", nullable: false, description: "Se está ativo" },
          { name: "hired_at", type: "TIMESTAMP", nullable: false, description: "Data de admissão" },
        ],
      },
      {
        name: "payroll_entries",
        schema: "rh",
        rows: 10680,
        lastUpdated: "2026-09-01 00:00",
        description: "Histórico de folha de pagamento",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "employee_id", type: "UUID", nullable: false, description: "FK para employees" },
          { name: "reference_month", type: "VARCHAR", nullable: false, description: "Competência (YYYY-MM)" },
          { name: "gross", type: "NUMERIC", nullable: false, description: "Salário bruto" },
          { name: "net", type: "NUMERIC", nullable: false, description: "Salário líquido" },
          { name: "deductions", type: "JSONB", nullable: true, description: "Descontos detalhados" },
        ],
      },
      {
        name: "consent_records",
        schema: "rh",
        rows: 1840,
        lastUpdated: "2026-09-20 14:20",
        description: "Consentimentos LGPD dos titulares (core.ConsentRecord)",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "subject_id", type: "UUID", nullable: false, description: "Titular dos dados" },
          { name: "purpose", type: "VARCHAR", nullable: false, description: "Finalidade do uso" },
          { name: "granted", type: "BOOLEAN", nullable: false, description: "Se consentimento foi dado" },
          { name: "expires_at", type: "TIMESTAMP", nullable: true, description: "Validade do consentimento" },
        ],
      },
    ],
  },
  {
    id: "fiscal",
    label: "Fiscal",
    tables: [
      {
        name: "tax_obligations",
        schema: "fiscal",
        rows: 3240,
        lastUpdated: "2026-09-15 10:00",
        description: "Obrigações fiscais e prazos",
        columns: [
          { name: "id", type: "UUID", nullable: false, description: "Identificador único" },
          { name: "tenant_id", type: "UUID", nullable: false, description: "Isolamento por tenant" },
          { name: "kind", type: "VARCHAR", nullable: false, description: "DAS / DCTF / ECF / etc." },
          { name: "due_date", type: "TIMESTAMP", nullable: false, description: "Data de vencimento" },
          { name: "status", type: "VARCHAR", nullable: false, description: "pending / paid / overdue" },
          { name: "amount", type: "NUMERIC", nullable: true, description: "Valor a recolher" },
        ],
      },
      {
        name: "ncm_codes",
        schema: "fiscal",
        rows: 11280,
        lastUpdated: "2026-01-15 00:00",
        description: "Tabela NCM para classificação fiscal de produtos",
        columns: [
          { name: "code", type: "VARCHAR", nullable: false, description: "Código NCM" },
          { name: "description", type: "TEXT", nullable: false, description: "Descrição oficial" },
          { name: "aliquota_ipi", type: "NUMERIC", nullable: true, description: "Alíquota IPI (%)" },
        ],
      },
    ],
  },
];

const OBSIDIAN_NOTES: ObsidianNote[] = [
  { title: "Arquitetura do Boilerplate PGBA", tags: ["#arquitetura", "#publico"], lastModified: "2026-09-22", chunks: 14, hasEmbedding: true, status: "indexed" },
  { title: "Guardrails de IA — Guia Interno", tags: ["#ia", "#publico"], lastModified: "2026-09-20", chunks: 9, hasEmbedding: true, status: "indexed" },
  { title: "Reunião CEO — Setembro 2026", tags: ["#reuniao", "#privado"], lastModified: "2026-09-23", chunks: 0, hasEmbedding: false, status: "excluded" },
  { title: "Onboarding de Agentes — CRM", tags: ["#crm", "#publico"], lastModified: "2026-09-18", chunks: 7, hasEmbedding: true, status: "indexed" },
  { title: "Notas Pessoais — Igor", tags: ["#pessoal"], lastModified: "2026-09-21", chunks: 0, hasEmbedding: false, status: "excluded" },
  { title: "Processo de Deploy — Produção", tags: ["#devops", "#publico"], lastModified: "2026-09-15", chunks: 11, hasEmbedding: true, status: "indexed" },
  { title: "Backlog Q4 2026", tags: ["#produto"], lastModified: "2026-09-23", chunks: 0, hasEmbedding: false, status: "pending" },
  { title: "Política de Privacidade LGPD", tags: ["#lgpd", "#publico"], lastModified: "2026-08-30", chunks: 18, hasEmbedding: true, status: "indexed" },
  { title: "Integrações Externas — Mapa", tags: ["#integrações", "#publico"], lastModified: "2026-09-10", chunks: 6, hasEmbedding: true, status: "indexed" },
  { title: "Notas de Sprint — Semana 38", tags: ["#sprint"], lastModified: "2026-09-23", chunks: 0, hasEmbedding: false, status: "pending" },
];

const SYNC_EVENTS: SyncEvent[] = [
  { timestamp: "2026-09-23 03:15", added: 2, updated: 5, removed: 0, duration: "4.2s" },
  { timestamp: "2026-09-22 03:12", added: 0, updated: 3, removed: 1, duration: "3.8s" },
  { timestamp: "2026-09-21 03:10", added: 7, updated: 12, removed: 0, duration: "9.1s" },
  { timestamp: "2026-09-20 03:14", added: 1, updated: 0, removed: 0, duration: "2.3s" },
  { timestamp: "2026-09-19 03:11", added: 3, updated: 4, removed: 2, duration: "5.6s" },
  { timestamp: "2026-09-18 03:15", added: 0, updated: 8, removed: 0, duration: "4.9s" },
  { timestamp: "2026-09-17 03:13", added: 11, updated: 2, removed: 1, duration: "11.4s" },
  { timestamp: "2026-09-16 03:10", added: 0, updated: 1, removed: 0, duration: "2.1s" },
  { timestamp: "2026-09-15 03:14", added: 4, updated: 9, removed: 0, duration: "7.3s" },
  { timestamp: "2026-09-14 03:12", added: 2, updated: 6, removed: 3, duration: "6.8s" },
];

const ROADMAP_ITEMS: RoadmapItem[] = [
  { label: "Definir credencial ServiceCredential para Databricks", status: "planned" },
  { label: "Autenticação via Personal Access Token", status: "planned" },
  { label: "Leitura de Delta Tables via Unity Catalog", status: "planned" },
  { label: "Sync de embeddings em batch via Spark Jobs", status: "planned" },
  { label: "Delta Sharing para streaming em tempo real", status: "planned" },
  { label: "Mapeamento automático de schema → ingestion.KnowledgeSource", status: "planned" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRows(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

const TYPE_COLORS: Record<ColumnType, string> = {
  VARCHAR: "bg-blue-500/10 text-blue-400",
  BIGINT: "bg-purple-500/10 text-purple-400",
  INTEGER: "bg-purple-500/10 text-purple-400",
  NUMERIC: "bg-purple-500/10 text-purple-400",
  TIMESTAMP: "bg-amber-500/10 text-amber-400",
  BOOLEAN: "bg-green-500/10 text-green-400",
  JSONB: "bg-orange-500/10 text-orange-400",
  VECTOR: "bg-pink-500/10 text-pink-400",
  UUID: "bg-slate-500/10 text-slate-400",
  TEXT: "bg-blue-500/10 text-blue-400",
};

function RoadmapIcon({ status }: { status: RoadmapStatus }) {
  if (status === "done") return <CheckCircle2 className="w-4 h-4 text-success shrink-0" />;
  if (status === "in-progress") return <Zap className="w-4 h-4 text-warning shrink-0" />;
  return <Circle className="w-4 h-4 text-muted-foreground shrink-0" />;
}

// ─── Tab 1: Catálogo de Tabelas ───────────────────────────────────────────────

function CatalogTab() {
  const [selectedSchema, setSelectedSchema] = useState<string>("crm");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const totalTables = SCHEMAS.reduce((s, sc) => s + sc.tables.length, 0);
  const totalRows = SCHEMAS.reduce((s, sc) => s + sc.tables.reduce((t, tb) => t + tb.rows, 0), 0);

  const activeSchema = SCHEMAS.find((s) => s.id === selectedSchema)!;
  const activeTable = activeSchema.tables.find((t) => t.name === selectedTable) ?? null;

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Total Tabelas" value={totalTables.toString()} icon={<Table2 className="w-4 h-4" />} />
        <Metric label="Total Registros" value={fmtRows(totalRows)} icon={<Database className="w-4 h-4" />} />
        <Metric label="Tamanho Total" value="847 GB" icon={<HardDrive className="w-4 h-4" />} />
        <Metric label="Última Sincronização" value="09:02 hoje" icon={<Clock className="w-4 h-4" />} />
      </div>

      <div className="flex gap-4">
        {/* Sidebar */}
        <div className="w-52 shrink-0 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 mb-2">
            Schemas
          </p>
          {SCHEMAS.map((sc) => (
            <button
              key={sc.id}
              onClick={() => { setSelectedSchema(sc.id); setSelectedTable(null); }}
              className={`w-full text-left px-3 py-2 rounded-md text-sm flex justify-between items-center transition-colors ${
                selectedSchema === sc.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-secondary text-foreground"
              }`}
            >
              <span className="truncate">{sc.label}</span>
              <span className={`text-xs font-mono ml-1 shrink-0 ${selectedSchema === sc.id ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                {sc.tables.length}
              </span>
            </button>
          ))}
        </div>

        {/* Main panel */}
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {activeSchema.tables.map((table) => {
              const isSelected = selectedTable === table.name;
              return (
                <div key={table.name} className="panel space-y-0">
                  <button
                    className="w-full text-left"
                    onClick={() => setSelectedTable(isSelected ? null : table.name)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="font-mono text-sm text-foreground truncate">{table.name}</span>
                      <Badge variant="outline" className="text-xs shrink-0">{table.schema}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{table.description}</p>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span className="font-mono">{fmtRows(table.rows)} linhas</span>
                      <span>{table.columns.length} colunas</span>
                      <span className="ml-auto">{table.lastUpdated}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                      {isSelected ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      <span>{isSelected ? "Ocultar colunas" : "Ver colunas"}</span>
                    </div>
                  </button>

                  {isSelected && (
                    <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                      {table.columns.map((col) => (
                        <div key={col.name} className="flex items-start gap-2">
                          <span className={`font-mono text-xs px-1.5 py-0.5 rounded shrink-0 ${TYPE_COLORS[col.type]}`}>
                            {col.type}
                          </span>
                          <div className="min-w-0">
                            <span className="font-mono text-xs text-foreground">{col.name}</span>
                            {col.nullable && <span className="text-xs text-muted-foreground ml-1">?</span>}
                            <p className="text-xs text-muted-foreground leading-tight">{col.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 2: Obsidian ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<NoteStatus, { label: string; className: string }> = {
  indexed:  { label: "Indexada",           className: "text-success bg-success/10" },
  pending:  { label: "Pendente",           className: "text-warning bg-warning/10" },
  excluded: { label: "Excluída (private)", className: "text-muted-foreground bg-secondary" },
};

function ObsidianTab() {
  return (
    <div className="space-y-5">
      {/* Status card */}
      <div className="panel-elevated grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Vault Path</p>
          <p className="font-mono text-xs text-foreground truncate">/home/igor/Obsidian/PGBA</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Última Sincronização</p>
          <p className="text-sm text-foreground">2026-09-23 03:15</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Notas Sincronizadas</p>
          <p className="text-sm text-foreground font-semibold">4.280</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Chunks Indexados</p>
          <p className="text-sm text-foreground font-semibold">38.720</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <SectionHeader title="Notas Indexadas" />
        <div title="Configure KnowledgeSource no backend">
          <Button size="sm" disabled className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Sincronizar Agora
          </Button>
        </div>
      </div>

      {/* Notes table */}
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="text-left py-2 pr-4 font-medium">Título</th>
              <th className="text-left py-2 pr-4 font-medium">Tags</th>
              <th className="text-left py-2 pr-4 font-medium whitespace-nowrap">Últ. Modificação</th>
              <th className="text-right py-2 pr-4 font-medium">Chunks</th>
              <th className="text-left py-2 pr-4 font-medium">Embedding</th>
              <th className="text-left py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {OBSIDIAN_NOTES.map((note) => {
              const sc = STATUS_CONFIG[note.status];
              return (
                <tr key={note.title} className="hover:bg-secondary/50 transition-colors">
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-foreground text-xs">{note.title}</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {note.tags.map((t) => (
                        <span key={t} className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">{note.lastModified}</td>
                  <td className="py-2.5 pr-4 text-right font-mono text-xs text-foreground">{note.chunks}</td>
                  <td className="py-2.5 pr-4">
                    {note.hasEmbedding ? (
                      <Badge className="text-xs bg-success/10 text-success border-0">Sim</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">Não</Badge>
                    )}
                  </td>
                  <td className="py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${sc.className}`}>
                      {sc.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sync log */}
      <SectionHeader title="Log de Sincronização (últimos 10)" />
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="text-left py-2 pr-4 font-medium">Timestamp</th>
              <th className="text-right py-2 pr-4 font-medium">Adicionadas</th>
              <th className="text-right py-2 pr-4 font-medium">Atualizadas</th>
              <th className="text-right py-2 pr-4 font-medium">Removidas</th>
              <th className="text-right py-2 font-medium">Duração</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {SYNC_EVENTS.map((ev, i) => (
              <tr key={i} className="hover:bg-secondary/50 transition-colors">
                <td className="py-2 pr-4 font-mono text-xs text-foreground">{ev.timestamp}</td>
                <td className="py-2 pr-4 text-right font-mono text-xs text-success">+{ev.added}</td>
                <td className="py-2 pr-4 text-right font-mono text-xs text-warning">{ev.updated}</td>
                <td className="py-2 pr-4 text-right font-mono text-xs text-muted-foreground">{ev.removed > 0 ? `-${ev.removed}` : "—"}</td>
                <td className="py-2 text-right font-mono text-xs text-muted-foreground">{ev.duration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab 3: Databricks ────────────────────────────────────────────────────────

function DatabricksTab() {
  return (
    <div className="space-y-5">
      {/* Not connected banner */}
      <div className="panel-elevated border border-warning/30 bg-warning/5 flex items-center gap-4 p-4">
        <div className="w-10 h-10 rounded-md bg-warning/10 flex items-center justify-center shrink-0">
          <Zap className="w-5 h-5 text-warning" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            Databricks — Não conectado
            <Badge className="text-xs bg-warning/10 text-warning border-0">Em breve</Badge>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            A integração com Databricks está planejada para Q1 2027. Configure as credenciais abaixo quando disponível.
          </p>
        </div>
        <AlertCircle className="w-5 h-5 text-warning shrink-0" />
      </div>

      {/* Config form — disabled */}
      <div className="panel space-y-4 opacity-60 pointer-events-none select-none">
        <div className="flex items-center justify-between">
          <SectionHeader title="Configuração de Conexão" />
          <Badge variant="outline" className="text-xs gap-1">
            <Lock className="w-3 h-3" /> Desabilitado
          </Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Workspace URL</label>
            <Input disabled placeholder="https://adb-xxx.azuredatabricks.net" className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Personal Access Token</label>
            <Input disabled type="password" placeholder="dapi••••••••••••••••" className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Cluster ID</label>
            <Input disabled placeholder="0123-456789-abcdef00" className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Catalog</label>
            <Input disabled placeholder="main" className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs text-muted-foreground">Schema (Unity Catalog)</label>
            <Input disabled placeholder="pgba_lakehouse" className="font-mono text-sm" />
          </div>
        </div>
        <Button disabled className="w-full gap-2">
          <Link2 className="w-4 h-4" /> Conectar ao Databricks
        </Button>
      </div>

      {/* What this would enable */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { icon: <Layers className="w-4 h-4 text-primary" />, title: "Delta Lake Tables", desc: "Sync bidirecional de tabelas Delta diretamente no catálogo do boilerplate, com versionamento automático via Delta Transaction Log." },
          { icon: <Cpu className="w-4 h-4 text-primary" />, title: "Spark Jobs para Embeddings", desc: "Geração de embeddings em batch para grandes volumes de documentos usando Spark, sem sobrecarregar o Celery local." },
          { icon: <Server className="w-4 h-4 text-primary" />, title: "Unity Catalog", desc: "Governança centralizada de dados com controle de acesso por tenant mapeado diretamente às permissões do Unity Catalog." },
          { icon: <Zap className="w-4 h-4 text-primary" />, title: "Delta Sharing (Streaming)", desc: "Ingestão em tempo real de eventos via Delta Sharing, alimentando o pipeline de RAG sem polling periódico." },
        ].map((item) => (
          <div key={item.title} className="panel flex gap-3">
            <div className="mt-0.5 shrink-0">{item.icon}</div>
            <div>
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Roadmap */}
      <div className="panel space-y-3">
        <SectionHeader title="Roadmap de Integração" />
        <div className="space-y-2">
          {ROADMAP_ITEMS.map((item, i) => (
            <div key={i} className="flex items-center gap-3">
              <RoadmapIcon status={item.status} />
              <span className={`text-sm ${item.status === "done" ? "line-through text-muted-foreground" : "text-foreground"}`}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Code snippet */}
      <div className="panel space-y-2">
        <p className="text-xs text-muted-foreground">Exemplo de credencial (quando disponível)</p>
        <pre className="rounded-md bg-black/30 border border-border text-xs font-mono p-4 overflow-x-auto leading-relaxed text-foreground/80">
{`python manage.py configure_service_credential \\
  --provider databricks \\
  --workspace-url https://adb-xxx.azuredatabricks.net \\
  --token dapi... \\
  --cluster-id 0123-456789-abcdef00 \\
  --catalog main \\
  --schema pgba_lakehouse`}
        </pre>
        <p className="text-xs text-muted-foreground">
          Segue o mesmo padrão de <span className="font-mono text-foreground/70">integrations.ServiceCredential</span> —
          credencial criptografada (Fernet), resolução por tenant antes do global,
          nunca hardcoded em variável de ambiente em produção.
        </p>
      </div>
    </div>
  );
}

// ─── Root Export ──────────────────────────────────────────────────────────────

export function DataLakeView() {
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Data Lake"
        description="Catálogo de dados, fontes de conhecimento e integrações analíticas"
      />

      <Tabs defaultValue="catalog">
        <TabsList>
          <TabsTrigger value="catalog" className="gap-1.5">
            <Database className="w-3.5 h-3.5" />
            Catálogo de Tabelas
          </TabsTrigger>
          <TabsTrigger value="obsidian" className="gap-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            Obsidian
          </TabsTrigger>
          <TabsTrigger value="databricks" className="gap-1.5">
            <Zap className="w-3.5 h-3.5" />
            Databricks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-5">
          <CatalogTab />
        </TabsContent>
        <TabsContent value="obsidian" className="mt-5">
          <ObsidianTab />
        </TabsContent>
        <TabsContent value="databricks" className="mt-5">
          <DatabricksTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
