// frontend/src/components/empresa/connectors.tsx
//
// Conectores externos (Data Lake → Conectores). Dois tipos de conector:
// - "documents": o conteúdo é copiado e vira busca semântica dos agentes
//   (REST API, URL, Google Sheets, Notion, Slack, E-mail, Webhook, Obsidian, Upload);
// - "structured": banco/CRM consultado NA HORA, só pelas consultas nomeadas
//   que alguém cadastrou aqui (SQL, HubSpot, Salesforce) — a IA nunca escreve a query.
// Segredos voltam mascarados do backend e ficam cifrados lá; o painel "Dados do
// conector" mostra o que veio, as execuções e quais setores/agentes enxergam a fonte.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Briefcase,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  Database,
  FileSpreadsheet,
  Globe,
  Link2,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Play,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/empresa/erp-crud";
import {
  createKnowledgeSource,
  deleteKnowledgeSource,
  getSourceAccess,
  getSourceOverview,
  listKnowledgeSources,
  runSourceQuery,
  setSourceAccess,
  syncKnowledgeSource,
  testKnowledgeSourceConfig,
  updateKnowledgeSource,
  type ConnectorQuery,
  type KnowledgeSource,
  type QueryTable,
  type SourceAccess,
  type SourceOverview,
} from "@/lib/api";

// ─── Catálogo ────────────────────────────────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "number" | "select" | "textarea" | "bool" | "list";
  placeholder?: string;
  required?: boolean;
  help?: string;
  options?: { value: string; label: string }[];
}

interface ConnectorDef {
  source_type: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  mode: "documents" | "structured";
  /** Busca os dados sozinho (tem botão Sincronizar e agendamento). */
  syncs: boolean;
  fields: FieldDef[];
  howTo?: string;
}

const AUTH_OPTS = [
  { value: "none", label: "Sem autenticação" },
  { value: "bearer", label: "Bearer token" },
  { value: "api_key", label: "Chave em header" },
];

const CONNECTORS: ConnectorDef[] = [
  {
    source_type: "rest_api", label: "REST API", mode: "documents", syncs: true,
    description: "Qualquer API HTTP que devolva JSON",
    icon: <Code2 className="size-5" />, color: "text-sky-600 dark:text-sky-400",
    howTo: "Cada item da lista vira um registro pesquisável pelos agentes.",
    fields: [
      { key: "url", label: "URL", type: "url", placeholder: "https://api.exemplo.com/v1/pedidos", required: true },
      { key: "auth_type", label: "Autenticação", type: "select", options: AUTH_OPTS },
      { key: "api_key", label: "Token / chave", type: "password" },
      { key: "api_key_header", label: "Header da chave", type: "text", placeholder: "X-API-Key" },
      { key: "data_path", label: "Caminho da lista no JSON", type: "text", placeholder: "data.items", help: "Vazio = a resposta inteira." },
      { key: "id_field", label: "Campo identificador", type: "text", placeholder: "id" },
      { key: "title_field", label: "Campo de título", type: "text", placeholder: "nome" },
    ],
  },
  {
    source_type: "sql", label: "Banco SQL", mode: "structured", syncs: false,
    description: "PostgreSQL, MySQL ou SQLite por consultas aprovadas",
    icon: <Database className="size-5" />, color: "text-emerald-600 dark:text-emerald-400",
    howTo: "Nada é copiado: os agentes rodam, só leitura, as consultas cadastradas abaixo.",
    fields: [
      { key: "engine", label: "Banco", type: "select", options: [
        { value: "postgresql", label: "PostgreSQL" }, { value: "mysql", label: "MySQL" }, { value: "sqlite", label: "SQLite (arquivo no servidor)" },
      ] },
      { key: "host", label: "Host", type: "text", placeholder: "db.exemplo.com", help: "Rede interna só se liberada no servidor (CONNECTORS_ALLOWED_PRIVATE_HOSTS)." },
      { key: "port", label: "Porta", type: "number", placeholder: "5432" },
      { key: "database", label: "Database (ou arquivo SQLite)", type: "text", required: true },
      { key: "user", label: "Usuário (de preferência só leitura)", type: "text" },
      { key: "password", label: "Senha", type: "password" },
      { key: "ssl", label: "Exigir SSL", type: "bool" },
      { key: "max_rows", label: "Máx. linhas por consulta", type: "number", placeholder: "200" },
    ],
  },
  {
    source_type: "google_sheets", label: "Google Sheets", mode: "documents", syncs: true,
    description: "Linhas de planilha, de 50 em 50",
    icon: <FileSpreadsheet className="size-5" />, color: "text-green-600 dark:text-green-400",
    howTo: "Sem Service Account, a planilha precisa estar compartilhada como “qualquer pessoa com o link pode ver”.",
    fields: [
      { key: "spreadsheet_id", label: "ID da planilha", type: "text", placeholder: "1BxiMVs0XRA5nFMd…", required: true, help: "O trecho entre /d/ e /edit na URL." },
      { key: "sheet_name", label: "Aba", type: "text", placeholder: "Clientes" },
      { key: "service_account_json", label: "Service Account JSON (opcional)", type: "textarea", help: "Compartilhe a planilha com o e-mail da conta de serviço." },
    ],
  },
  {
    source_type: "slack", label: "Slack", mode: "documents", syncs: true,
    description: "Mensagens de canais, um registro por canal e dia",
    icon: <MessageSquare className="size-5" />, color: "text-purple-600 dark:text-purple-400",
    howTo: "O bot precisa estar nos canais (escopos channels:history e channels:read).",
    fields: [
      { key: "bot_token", label: "Bot Token", type: "password", placeholder: "xoxb-…", required: true },
      { key: "channel_ids", label: "IDs dos canais", type: "list", placeholder: "C012AB3CD, C034EF5GH", required: true },
      { key: "include_threads", label: "Incluir respostas em thread", type: "bool" },
    ],
  },
  {
    source_type: "notion", label: "Notion", mode: "documents", syncs: true,
    description: "Páginas de uma database, com propriedades e conteúdo",
    icon: <BookOpen className="size-5" />, color: "text-orange-600 dark:text-orange-400",
    howTo: "Compartilhe a database com a integração no Notion (“Add connections”).",
    fields: [
      { key: "integration_token", label: "Integration Token", type: "password", placeholder: "secret_…", required: true },
      { key: "database_id", label: "Database ID", type: "text", required: true },
      { key: "filter_formula", label: "Filtro (JSON da API do Notion, opcional)", type: "textarea" },
    ],
  },
  {
    source_type: "hubspot", label: "HubSpot", mode: "structured", syncs: false,
    description: "Contatos, empresas e negócios consultados na hora",
    icon: <Users className="size-5" />, color: "text-orange-500",
    howTo: "Use um token de Private App com escopo de leitura do CRM.",
    fields: [
      { key: "api_key", label: "Token do Private App", type: "password", placeholder: "pat-na1-…", required: true },
      { key: "max_rows", label: "Máx. registros por consulta", type: "number", placeholder: "100" },
    ],
  },
  {
    source_type: "salesforce", label: "Salesforce", mode: "structured", syncs: false,
    description: "Objetos por SOQL aprovado, consultados na hora",
    icon: <Briefcase className="size-5" />, color: "text-blue-500",
    howTo: "Connected App com o Client Credentials Flow habilitado.",
    fields: [
      { key: "client_id", label: "Client ID", type: "text", required: true },
      { key: "client_secret", label: "Client Secret", type: "password", required: true },
      { key: "instance_url", label: "My Domain URL", type: "url", placeholder: "https://suaorg.my.salesforce.com", required: true },
      { key: "max_rows", label: "Máx. registros por consulta", type: "number", placeholder: "200" },
    ],
  },
  {
    source_type: "email", label: "E-mail (IMAP)", mode: "documents", syncs: true,
    description: "Últimos e-mails de uma pasta, só leitura",
    icon: <Mail className="size-5" />, color: "text-red-600 dark:text-red-400",
    howTo: "No Gmail/Outlook use uma senha de app. Endereços e telefones são mascarados (LGPD).",
    fields: [
      { key: "host", label: "Servidor IMAP", type: "text", placeholder: "imap.gmail.com", required: true },
      { key: "port", label: "Porta", type: "number", placeholder: "993" },
      { key: "user", label: "Usuário", type: "text", placeholder: "contato@empresa.com", required: true },
      { key: "password", label: "Senha de app", type: "password", required: true },
      { key: "folder", label: "Pasta", type: "text", placeholder: "INBOX" },
      { key: "max_emails", label: "Máx. e-mails por sync", type: "number", placeholder: "100" },
    ],
  },
  {
    source_type: "webhook", label: "Webhook", mode: "documents", syncs: false,
    description: "Recebe dados por POST de sistemas externos",
    icon: <Webhook className="size-5" />, color: "text-yellow-600 dark:text-yellow-400",
    howTo: "Depois de salvar, o painel mostra a URL e como assinar o POST.",
    fields: [
      { key: "secret", label: "Segredo (assinatura)", type: "password", required: true },
      { key: "expected_field", label: "Campo com o texto", type: "text", placeholder: "text", help: "Vazio = o JSON inteiro." },
      { key: "id_field", label: "Campo identificador", type: "text", placeholder: "id" },
      { key: "title_field", label: "Campo de título", type: "text", placeholder: "title" },
    ],
  },
  {
    source_type: "url", label: "URL / páginas web", mode: "documents", syncs: true,
    description: "Texto de páginas, opcionalmente seguindo links",
    icon: <Globe className="size-5" />, color: "text-cyan-600 dark:text-cyan-400",
    fields: [
      { key: "url", label: "URL", type: "url", placeholder: "https://docs.minha-empresa.com", required: true },
      { key: "css_selector", label: "Seletor (opcional)", type: "text", placeholder: "article.content", help: "Aceita tag, .classe, #id ou tag.classe." },
      { key: "follow_links", label: "Seguir links do mesmo site", type: "bool" },
      { key: "max_pages", label: "Máx. páginas", type: "number", placeholder: "20" },
    ],
  },
  {
    source_type: "obsidian", label: "Obsidian", mode: "documents", syncs: true,
    description: "Vault do Obsidian numa pasta do servidor",
    icon: <BookOpen className="size-5" />, color: "text-violet-600 dark:text-violet-400",
    howTo: "Notas com private: true e a pasta .obsidian nunca entram.",
    fields: [
      { key: "vault_path", label: "Caminho do vault", type: "text", placeholder: "/vaults/minha-empresa", required: true },
      { key: "include_tags", label: "Só notas com estas tags", type: "list", placeholder: "#publico, #base" },
    ],
  },
  {
    source_type: "upload", label: "Upload manual", mode: "documents", syncs: false,
    description: "PDF, TXT e Markdown enviados em Conhecimento",
    icon: <Upload className="size-5" />, color: "text-pink-600 dark:text-pink-400",
    fields: [],
  },
];

const connectorByType = Object.fromEntries(CONNECTORS.map((c) => [c.source_type, c])) as Record<string, ConnectorDef>;

const INTERVALS = [
  { value: "", label: "Manual" },
  { value: "15", label: "A cada 15 min" },
  { value: "60", label: "A cada hora" },
  { value: "360", label: "A cada 6 horas" },
  { value: "1440", label: "Uma vez por dia" },
];

// ─── Utilitários ─────────────────────────────────────────────────────────────

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function fmtDate(d: string | null) {
  if (!d) return "nunca";
  return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Pill({ tone, children }: { tone: "ok" | "error" | "muted" | "info" | "warn"; children: React.ReactNode }) {
  const cls = {
    ok: "border-success/30 bg-success/10 text-success",
    error: "border-destructive/30 bg-destructive/10 text-destructive",
    warn: "border-warning/30 bg-warning/10 text-warning",
    info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    muted: "border-border bg-secondary text-muted-foreground",
  }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

function StatusPill({ source }: { source: KnowledgeSource }) {
  if (!source.is_active) return <Pill tone="muted">Inativo</Pill>;
  if (source.mode === "structured") return <Pill tone="info"><Play className="size-3" />Consulta na hora</Pill>;
  switch (source.last_sync_status) {
    case "running":
      return <Pill tone="info"><Loader2 className="size-3 animate-spin" />Sincronizando</Pill>;
    case "ok":
      return <Pill tone="ok"><CheckCircle2 className="size-3" />OK</Pill>;
    case "error":
      return <Pill tone="error"><AlertCircle className="size-3" />Erro</Pill>;
    default:
      return <Pill tone="muted"><Clock className="size-3" />Nunca sincronizado</Pill>;
  }
}

function listToText(v: unknown): string {
  return Array.isArray(v) ? v.join(", ") : String(v ?? "");
}

// ─── Editor de consultas (conectores estruturados) ───────────────────────────

const HUBSPOT_OBJECTS = ["contacts", "companies", "deals", "tickets", "products", "line_items"];

function QueriesEditor({
  sourceType,
  value,
  onChange,
}: {
  sourceType: string;
  value: ConnectorQuery[];
  onChange: (q: ConnectorQuery[]) => void;
}) {
  const hubspot = sourceType === "hubspot";
  const set = (i: number, patch: Partial<ConnectorQuery>) =>
    onChange(value.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Consultas que os agentes podem usar</p>
          <p className="text-[11px] text-muted-foreground">
            A IA só escolhe uma destas e passa os valores dos parâmetros — nunca escreve a consulta.
            {hubspot ? "" : " Use :nome para parâmetro (ex: WHERE mes = :mes)."}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onChange([...value, hubspot
              ? { nome: "", descricao: "", objeto: "deals", propriedades: "", filtro_propriedade: "", parametros: [] }
              : { nome: "", descricao: "", consulta: "SELECT ", parametros: [] }])
          }
        >
          <Plus className="size-3.5" /> Consulta
        </Button>
      </div>
      {value.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          Sem consultas, os agentes não conseguem usar este conector.
        </p>
      )}
      {value.map((q, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
          <div className="flex gap-2">
            <Input
              className="h-8 font-mono text-xs"
              placeholder="nome_da_consulta"
              value={q.nome}
              onChange={(e) => set(i, { nome: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
            />
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 hover:text-destructive" title="Remover consulta"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <Input className="h-8 text-xs" placeholder="O que ela responde (a IA escolhe por aqui)" value={q.descricao}
            onChange={(e) => set(i, { descricao: e.target.value })} />
          {hubspot ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select className={`${selectCls} h-8 text-xs`} value={q.objeto ?? "deals"} onChange={(e) => set(i, { objeto: e.target.value })}>
                {HUBSPOT_OBJECTS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <Input className="h-8 text-xs" placeholder="propriedades: dealname,amount" value={q.propriedades ?? ""}
                onChange={(e) => set(i, { propriedades: e.target.value })} />
              <Input className="h-8 text-xs" placeholder="filtrar por (opcional): dealstage" value={q.filtro_propriedade ?? ""}
                onChange={(e) => set(i, { filtro_propriedade: e.target.value })} />
            </div>
          ) : (
            <>
              <Textarea rows={3} className="font-mono text-xs" value={q.consulta ?? ""} onChange={(e) => set(i, { consulta: e.target.value })} />
              <Input className="h-8 text-xs" placeholder="parâmetros: mes, valor:numero, inicio:data"
                value={listToText(q.parametros)}
                onChange={(e) => set(i, { parametros: e.target.value.split(",").map((p) => p.trim()).filter(Boolean) })} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Formulário do conector ──────────────────────────────────────────────────

function ConfigDialog({
  def,
  initial,
  onClose,
  onSaved,
}: {
  def: ConnectorDef;
  initial?: KnowledgeSource;
  onClose: () => void;
  onSaved: (ks: KnowledgeSource) => void;
}) {
  const [name, setName] = useState(initial?.name ?? def.label);
  const [config, setConfig] = useState<Record<string, unknown>>(() => {
    const base: Record<string, unknown> = { ...(initial?.config ?? {}) };
    for (const f of def.fields) {
      if (f.type === "list") base[f.key] = listToText(base[f.key]);
      if (f.type === "bool" && base[f.key] === undefined) base[f.key] = f.key === "ssl" || f.key === "include_threads";
      if (f.type === "select" && base[f.key] === undefined) base[f.key] = f.options?.[0]?.value ?? "";
    }
    return base;
  });
  const [queries, setQueries] = useState<ConnectorQuery[]>(
    () => (initial?.config?.consultas as ConnectorQuery[] | undefined) ?? [],
  );
  const [interval, setInterval_] = useState(initial?.sync_interval_minutes ? String(initial.sync_interval_minutes) : "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const secretsSet = new Set(initial?.secrets_set ?? []);

  const payload = () => {
    const cfg: Record<string, unknown> = {};
    for (const f of def.fields) {
      const v = config[f.key];
      if (f.type === "bool") cfg[f.key] = Boolean(v);
      else if (f.type === "list") {
        const items = String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
        if (items.length) cfg[f.key] = items;
      } else if (String(v ?? "").trim()) cfg[f.key] = String(v).trim();
    }
    if (def.mode === "structured") cfg.consultas = queries;
    return cfg;
  };

  const save = async () => {
    const missing = def.fields.filter((f) => f.required && !String(config[f.key] ?? "").trim() && !secretsSet.has(f.key));
    if (missing.length) {
      toast.error(`Preencha: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        config: payload(),
        ...(def.syncs ? { sync_interval_minutes: interval ? Number(interval) : null } : {}),
      };
      const ks = initial
        ? await updateKnowledgeSource(initial.id, data)
        : await createKnowledgeSource({ ...data, source_type: def.source_type });
      onSaved(ks);
      toast.success(`Conector “${ks.name}” ${initial ? "salvo" : "criado"}.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar o conector.");
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await testKnowledgeSourceConfig({ source_type: def.source_type, config: payload(), id: initial?.id }));
    } catch (err) {
      setTest({ ok: false, message: err instanceof Error ? err.message : "Erro de rede ao testar." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={`grid size-9 place-items-center rounded-lg bg-secondary ${def.color}`}>{def.icon}</span>
            <div>
              <DialogTitle>{initial ? "Editar" : "Novo"} conector · {def.label}</DialogTitle>
              <DialogDescription>{def.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {def.howTo && (
          <p className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">{def.howTo}</p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs text-muted-foreground">Nome do conector</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: CRM Vendas" />
          </label>
          {def.fields.map((f) => {
            const wide = f.type === "textarea" || f.type === "url";
            const value = config[f.key];
            const saved = secretsSet.has(f.key);
            return (
              <label key={f.key} className={`space-y-1 ${wide ? "sm:col-span-2" : ""}`}>
                {f.type !== "bool" && (
                  <span className="text-xs text-muted-foreground">
                    {f.label}
                    {f.required && !saved && <span className="text-destructive"> *</span>}
                    {saved && <span className="ml-1 inline-flex items-center gap-0.5 text-success"><ShieldCheck className="size-3" />salvo cifrado</span>}
                  </span>
                )}
                {f.type === "select" ? (
                  <select className={selectCls} value={String(value ?? "")} onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === "bool" ? (
                  <span className="flex items-center gap-2 pt-5 text-sm">
                    <input type="checkbox" className="size-4 accent-primary" checked={Boolean(value)}
                      onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.checked }))} />
                    {f.label}
                  </span>
                ) : f.type === "textarea" ? (
                  <Textarea rows={3} className="font-mono text-xs" value={String(value ?? "")}
                    placeholder={saved ? "Salvo — deixe como está para manter" : f.placeholder}
                    onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))} />
                ) : (
                  <Input
                    type={f.type === "password" ? "password" : f.type === "number" ? "number" : "text"}
                    className="font-mono text-sm"
                    value={String(value ?? "")}
                    placeholder={saved ? "Salvo — deixe como está para manter" : f.placeholder}
                    onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                  />
                )}
                {f.help && <span className="block text-[11px] text-muted-foreground">{f.help}</span>}
              </label>
            );
          })}
          {def.syncs && (
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Sincronização automática</span>
              <select className={selectCls} value={interval} onChange={(e) => setInterval_(e.target.value)}>
                {INTERVALS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
        </div>

        {def.mode === "structured" && <QueriesEditor sourceType={def.source_type} value={queries} onChange={setQueries} />}

        {def.fields.length === 0 && (
          <p className="text-sm text-muted-foreground">Sem configuração: salve e envie arquivos em Conhecimento → Biblioteca.</p>
        )}

        {test && (
          <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${test.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
            {test.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
            <span>{test.message}</span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {def.fields.length > 0 ? (
            <Button variant="outline" size="sm" onClick={runTest} disabled={testing}>
              {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
              Testar conexão
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" onClick={save} disabled={saving || !name.trim()}>
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {initial ? "Salvar" : "Criar conector"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Painel "Dados do conector" ──────────────────────────────────────────────

type PanelTab = "resumo" | "dados" | "execucoes" | "acesso";

function QueryRunner({ source, q }: { source: KnowledgeSource; q: ConnectorQuery }) {
  const params = (q.parametros ?? []).map((p) => p.split(":")[0]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QueryTable | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <p className="font-mono text-xs font-semibold">{q.nome}</p>
        <p className="text-xs text-muted-foreground">{q.descricao}</p>
        {q.consulta && <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-secondary p-2 text-[11px]">{q.consulta}</pre>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {params.map((p) => (
          <Input key={p} className="h-8 w-40 text-xs" placeholder={p} value={values[p] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))} />
        ))}
        <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setResult(await runSourceQuery(source.id, q.nome, values));
          } catch (err) {
            setResult(null);
            setError(err instanceof Error ? err.message : "Falhou.");
          } finally {
            setBusy(false);
          }
        }}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Testar consulta
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {result && (
        <div className="max-w-full overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                {result.colunas.map((c) => <th key={c} className="px-2 py-1.5 font-semibold">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {result.linhas.slice(0, 20).map((row, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {row.map((cell, j) => <td key={j} className="px-2 py-1 tabular-nums">{cell === null ? "—" : String(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-2 py-1 text-[11px] text-muted-foreground">
            {result.total_linhas} linha(s){result.truncado ? " — resultado cortado no limite" : ""}. E-mail, CPF e telefone saem mascarados.
          </p>
        </div>
      )}
    </div>
  );
}

function SourcePanel({ source, onClose, onChanged }: { source: KnowledgeSource; onClose: () => void; onChanged: () => void }) {
  const def = connectorByType[source.source_type];
  const [tab, setTab] = useState<PanelTab>("resumo");
  const [overview, setOverview] = useState<SourceOverview | null>(null);
  const [access, setAccess] = useState<SourceAccess | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [savingAccess, setSavingAccess] = useState(false);

  const load = useCallback(() => {
    getSourceOverview(source.id).then(setOverview).catch(() => setOverview(null));
    getSourceAccess(source.id)
      .then((a) => {
        setAccess(a);
        setSelected(new Set(a.sectors.filter((s) => s.access === "adicional").map((s) => s.id)));
      })
      .catch(() => setAccess(null));
  }, [source.id]);
  useEffect(load, [load]);

  const structured = source.mode === "structured";
  const tabs: { id: PanelTab; label: string }[] = [
    { id: "resumo", label: "Resumo" },
    { id: "dados", label: structured ? "Consultas" : "Registros" },
    { id: "execucoes", label: "Execuções" },
    { id: "acesso", label: "Quem acessa" },
  ];
  const errors = overview?.documents.by_status.error ?? 0;
  const pending = (overview?.documents.by_status.pending ?? 0) + (overview?.documents.by_status.processing ?? 0);
  const whoCount = access ? access.sectors.filter((s) => s.access).length : 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl [&>*]:min-w-0">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={`grid size-9 place-items-center rounded-lg bg-secondary ${def?.color ?? ""}`}>{def?.icon ?? <Plug className="size-5" />}</span>
            <div className="min-w-0">
              <DialogTitle className="flex flex-wrap items-center gap-2">{source.name} <StatusPill source={source} /></DialogTitle>
              <DialogDescription>{def?.label ?? source.source_type} · {structured ? "consultado na hora pelos agentes" : "copiado para a busca dos agentes"}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex gap-1 border-b border-border">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${tab === t.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "resumo" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(structured
                ? [
                    ["Consultas", String(overview?.queries.length ?? "—")],
                    ["Setores com acesso", String(whoCount)],
                    ["Última execução", fmtDate(overview?.runs[0]?.started_at ?? null)],
                    ["Modo", "Só leitura"],
                  ]
                : [
                    ["Registros", String(overview?.documents.active ?? "—")],
                    ["Indexando / com erro", `${pending} / ${errors}`],
                    ["Último sync", fmtDate(source.last_synced_at)],
                    ["Setores com acesso", String(whoCount)],
                  ]
              ).map(([label, value]) => (
                <div key={label} className="rounded-xl border border-border bg-secondary/40 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className="mt-1 font-display text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>
            {source.last_sync_message && (
              <p className={`rounded-lg border px-3 py-2 text-sm ${source.last_sync_status === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-secondary/40 text-muted-foreground"}`}>
                {source.last_sync_message}
              </p>
            )}
            {source.webhook_url && (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <p className="text-sm font-medium">Como enviar dados</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-secondary px-2 py-1 text-xs">{source.webhook_url}</code>
                  <Button size="icon" variant="ghost" className="size-8" title="Copiar URL"
                    onClick={() => { void navigator.clipboard?.writeText(source.webhook_url); toast.success("URL copiada."); }}>
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  POST com JSON e o header <code>X-Webhook-Signature: sha256=&lt;HMAC-SHA256 do corpo com o segredo&gt;</code> (ou{" "}
                  <code>X-Webhook-Secret</code> com o próprio segredo). Cada POST vira um registro; o mesmo <code>id</code> atualiza.
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {structured
                ? "Nada é copiado: quando um agente com acesso pergunta algo que uma consulta responde, ela roda na hora, só leitura."
                : "O conteúdo entra na busca semântica. E-mail, CPF e telefone são mascarados antes de gravar (LGPD). O que sumir da fonte sai da busca no próximo sync."}
            </p>
          </div>
        )}

        {tab === "dados" && !structured && (
          <div className="space-y-2">
            {overview?.recent_documents.length ? overview.recent_documents.map((d) => (
              <div key={d.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{d.title}</p>
                  <Pill tone={d.status === "indexed" ? "ok" : d.status === "error" ? "error" : "warn"}>
                    {d.status === "indexed" ? "pesquisável" : d.status === "error" ? "erro" : "indexando"}
                  </Pill>
                </div>
                {d.error ? (
                  <p className="mt-1 text-xs text-destructive">
                    Chegou, mas ainda não está na busca: falhou ao gerar os embeddings ({d.error}). Confira o provedor
                    de embeddings (EMBEDDING_PROVIDER — Ollama por padrão) e sincronize de novo.
                  </p>
                ) : (
                  <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{d.excerpt}</p>
                )}
              </div>
            )) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Nenhum registro ainda — sincronize o conector.</p>
            )}
            {(overview?.documents.active ?? 0) > 8 && (
              <p className="text-center text-xs text-muted-foreground">Mostrando os 8 mais recentes de {overview?.documents.active}. Todos em Conhecimento → Biblioteca.</p>
            )}
          </div>
        )}

        {tab === "dados" && structured && (
          <div className="min-w-0 space-y-2">
            {overview?.queries.length ? overview.queries.map((q) => <QueryRunner key={q.nome} source={source} q={q} />) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma consulta cadastrada — edite o conector.</p>
            )}
          </div>
        )}

        {tab === "execucoes" && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Quando</th><th className="px-3 py-2">Origem</th><th className="px-3 py-2">Resultado</th><th className="px-3 py-2 text-right">Novos / alterados / removidos</th>
                </tr>
              </thead>
              <tbody>
                {overview?.runs.length ? overview.runs.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 align-top">
                    <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.started_at)}</td>
                    <td className="px-3 py-2">{{ manual: "manual", schedule: "agendado", webhook: "webhook" }[r.trigger]}</td>
                    <td className="px-3 py-2">
                      <Pill tone={r.status === "ok" ? "ok" : r.status === "error" ? "error" : "info"}>{r.status}</Pill>
                      <p className="mt-1 text-xs text-muted-foreground">{r.message}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.created} / {r.updated} / {r.removed}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Nenhuma execução ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "acesso" && access && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Um agente só enxerga as fontes do próprio setor. <strong className="text-foreground">{access.full_access.join(", ") || "CEO e Orquestrador-Geral"}</strong>{" "}
              {access.full_access.length === 1 ? "tem" : "têm"} acesso a tudo.
            </p>
            <div className="divide-y divide-border rounded-xl border border-border">
              {access.sectors.map((s) => {
                const principal = s.access === "principal";
                return (
                  <label key={s.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" className="size-4 accent-primary" disabled={principal}
                      checked={principal || selected.has(s.id)}
                      onChange={(e) => setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(s.id); else next.delete(s.id);
                        return next;
                      })} />
                    <span className="flex-1 font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground">{s.agents} agente(s)</span>
                    {principal && <Pill tone="info">cérebro principal</Pill>}
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">O cérebro principal do setor muda na janela da sala, no Escritório 3D.</p>
              <Button size="sm" disabled={savingAccess} onClick={async () => {
                setSavingAccess(true);
                try {
                  const a = await setSourceAccess(source.id, [...selected]);
                  setAccess(a);
                  toast.success("Acesso dos setores atualizado.");
                  onChanged();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
                } finally {
                  setSavingAccess(false);
                }
              }}>
                {savingAccess && <Loader2 className="size-3.5 animate-spin" />} Salvar acesso
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Cartão do conector ──────────────────────────────────────────────────────

function ConnectorCard({
  source,
  onOpen,
  onEdit,
  onDelete,
  onSync,
  syncing,
}: {
  source: KnowledgeSource;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSync: () => void;
  syncing: boolean;
}) {
  const def = connectorByType[source.source_type];
  const queries = Array.isArray(source.config?.consultas) ? (source.config.consultas as unknown[]).length : 0;
  return (
    <div className="flex items-start gap-4 rounded-xl border border-border bg-surface p-4 transition hover:shadow-sm">
      <button type="button" onClick={onOpen} className={`grid size-10 shrink-0 place-items-center rounded-xl bg-secondary ${def?.color ?? "text-muted-foreground"}`} title="Dados do conector">
        {def?.icon ?? <Plug className="size-5" />}
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{source.name}</span>
          <Pill tone="muted">{def?.label ?? source.source_type}</Pill>
          <StatusPill source={source} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {source.mode === "structured"
            ? `${queries} consulta(s) disponíveis para os agentes`
            : `${source.document_count} registro(s) · último sync ${fmtDate(source.last_synced_at)}${source.sync_interval_minutes ? ` · automático a cada ${source.sync_interval_minutes} min` : ""}`}
        </p>
        {source.last_sync_status === "error" && source.last_sync_message && (
          <p className="mt-0.5 line-clamp-1 text-xs text-destructive">{source.last_sync_message}</p>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        {def?.syncs && (
          <Button variant="ghost" size="icon" className="size-8" onClick={onSync} disabled={syncing} title="Sincronizar agora">
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="size-8" onClick={onEdit} title="Editar"><Pencil className="size-4" /></Button>
        <Button variant="ghost" size="icon" className="size-8 hover:text-destructive" onClick={onDelete} title="Remover"><Trash2 className="size-4" /></Button>
      </div>
    </div>
  );
}

// ─── Aba ─────────────────────────────────────────────────────────────────────

export function ConnectorsTab() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ def: ConnectorDef; source?: KnowledgeSource } | null>(null);
  const [panel, setPanel] = useState<KnowledgeSource | null>(null);
  const [removing, setRemoving] = useState<KnowledgeSource | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setSources(await listKnowledgeSources());
    } catch {
      toast.error("Erro ao carregar conectores.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Enquanto algum sync roda, atualiza a lista a cada 3s
  const running = useMemo(() => sources.some((s) => s.last_sync_status === "running"), [sources]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [running, load]);

  const handleSync = async (source: KnowledgeSource) => {
    setSyncingId(source.id);
    try {
      const r = await syncKnowledgeSource(source.id);
      toast.success(r.queued ? `Sincronizando “${source.name}”…` : r.detail);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao sincronizar.");
    } finally {
      setSyncingId(null);
    }
  };

  const fallbackDef = (s: KnowledgeSource): ConnectorDef => ({
    source_type: s.source_type, label: s.source_type, description: "Tipo sem formulário", mode: s.mode,
    icon: <Plug className="size-5" />, color: "text-muted-foreground", syncs: false, fields: [],
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Conectores configurados <span className="ml-1 text-xs font-normal text-muted-foreground">({sources.length})</span>
          </h3>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="size-3.5" /> Atualizar
          </Button>
        </div>
        {loading ? (
          <div className="rounded-xl border border-border bg-surface py-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : sources.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            Nenhum conector ainda. Adicione um abaixo.
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map((s) => (
              <ConnectorCard
                key={s.id}
                source={s}
                onOpen={() => setPanel(s)}
                onEdit={() => setDialog({ def: connectorByType[s.source_type] ?? fallbackDef(s), source: s })}
                onDelete={() => setRemoving(s)}
                onSync={() => void handleSync(s)}
                syncing={syncingId === s.id}
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Adicionar conector</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CONNECTORS.map((def) => (
            <button
              key={def.source_type}
              onClick={() => setDialog({ def })}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition hover:border-ring"
            >
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg bg-secondary ${def.color}`}>{def.icon}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {def.label}
                  {def.mode === "structured" && <Pill tone="info">consulta</Pill>}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{def.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {dialog && (
        <ConfigDialog
          def={dialog.def}
          initial={dialog.source}
          onClose={() => setDialog(null)}
          onSaved={() => void load()}
        />
      )}
      {panel && (
        <SourcePanel
          source={sources.find((s) => s.id === panel.id) ?? panel}
          onClose={() => setPanel(null)}
          onChanged={() => void load()}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remover “${removing?.name ?? ""}”?`}
        description="O conector e os registros dele saem da busca dos agentes na hora. Nada é apagado de verdade: o histórico continua no banco."
        confirmLabel="Remover"
        onConfirm={async () => {
          await deleteKnowledgeSource(removing!.id);
          toast.success("Conector removido.");
          setRemoving(null);
          await load();
        }}
      />
    </div>
  );
}
