import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Link2,
  Database,
  Globe,
  BookOpen,
  Upload,
  Webhook,
  Mail,
  FileSpreadsheet,
  MessageSquare,
  Briefcase,
  Users,
  Code2,
  Pencil,
  X,
  Plug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  KnowledgeSource,
  listKnowledgeSources,
  createKnowledgeSource,
  updateKnowledgeSource,
  deleteKnowledgeSource,
  testKnowledgeSourceConnection,
  syncKnowledgeSource,
} from "@/lib/api";
import { toast } from "sonner";

// ─── Connector catalog ────────────────────────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "number";
  placeholder?: string;
  required?: boolean;
}

interface ConnectorDef {
  source_type: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  fields: FieldDef[];
  canSync?: boolean;
}

const CONNECTORS: ConnectorDef[] = [
  {
    source_type: "rest_api",
    label: "REST API",
    description: "Qualquer API HTTP com suporte a GET/POST",
    icon: <Code2 className="size-5" />,
    color: "text-blue-400",
    canSync: true,
    fields: [
      { key: "url", label: "URL base", type: "url", placeholder: "https://api.exemplo.com/v1", required: true },
      { key: "auth_type", label: "Tipo de autenticação (none/bearer/api_key)", type: "text", placeholder: "bearer" },
      { key: "api_key", label: "API Key / Bearer Token", type: "password" },
      { key: "api_key_header", label: "Header de autenticação", type: "text", placeholder: "X-API-Key" },
      { key: "data_path", label: "JSON path para os dados", type: "text", placeholder: "data.items" },
    ],
  },
  {
    source_type: "sql",
    label: "Banco SQL",
    description: "PostgreSQL, MySQL, SQLite via queries pré-aprovadas",
    icon: <Database className="size-5" />,
    color: "text-emerald-400",
    fields: [
      { key: "host", label: "Host", type: "text", placeholder: "db.exemplo.com", required: true },
      { key: "port", label: "Porta", type: "number", placeholder: "5432" },
      { key: "database", label: "Database", type: "text", placeholder: "pgba_prod", required: true },
      { key: "user", label: "Usuário", type: "text", required: true },
      { key: "password", label: "Senha", type: "password" },
      { key: "ssl", label: "SSL (true/false)", type: "text", placeholder: "true" },
    ],
  },
  {
    source_type: "google_sheets",
    label: "Google Sheets",
    description: "Leitura de planilhas via Google Sheets API",
    icon: <FileSpreadsheet className="size-5" />,
    color: "text-green-400",
    canSync: true,
    fields: [
      { key: "spreadsheet_id", label: "ID da planilha", type: "text", placeholder: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", required: true },
      { key: "sheet_name", label: "Aba (opcional)", type: "text", placeholder: "Sheet1" },
      { key: "service_account_json", label: "Service Account JSON (inline)", type: "password", placeholder: '{"type":"service_account",...}' },
    ],
  },
  {
    source_type: "slack",
    label: "Slack",
    description: "Canais e mensagens via Slack Bot API",
    icon: <MessageSquare className="size-5" />,
    color: "text-purple-400",
    canSync: true,
    fields: [
      { key: "bot_token", label: "Bot Token", type: "password", placeholder: "xoxb-...", required: true },
      { key: "channel_ids", label: "IDs de canais (vírgula)", type: "text", placeholder: "C012AB3CD,C034EF5GH" },
      { key: "include_threads", label: "Incluir threads (true/false)", type: "text", placeholder: "true" },
    ],
  },
  {
    source_type: "notion",
    label: "Notion",
    description: "Páginas e databases do Notion via Integration Token",
    icon: <BookOpen className="size-5" />,
    color: "text-orange-400",
    canSync: true,
    fields: [
      { key: "integration_token", label: "Integration Token", type: "password", placeholder: "secret_...", required: true },
      { key: "database_id", label: "Database ID", type: "text", placeholder: "a0b1c2d3e4f5...", required: true },
      { key: "filter_formula", label: "Filtro JSON (opcional)", type: "text" },
    ],
  },
  {
    source_type: "hubspot",
    label: "HubSpot",
    description: "CRM — contatos, empresas, negócios via HubSpot API",
    icon: <Users className="size-5" />,
    color: "text-orange-500",
    canSync: true,
    fields: [
      { key: "api_key", label: "API Key", type: "password", placeholder: "pat-na1-...", required: true },
      { key: "objects", label: "Objetos a sincronizar", type: "text", placeholder: "contacts,companies,deals" },
    ],
  },
  {
    source_type: "salesforce",
    label: "Salesforce",
    description: "CRM — objetos Salesforce via Connected App",
    icon: <Briefcase className="size-5" />,
    color: "text-blue-500",
    canSync: true,
    fields: [
      { key: "client_id", label: "Client ID", type: "text", required: true },
      { key: "client_secret", label: "Client Secret", type: "password", required: true },
      { key: "instance_url", label: "Instance URL", type: "url", placeholder: "https://suaorg.salesforce.com", required: true },
      { key: "soql_query", label: "SOQL query (opcional)", type: "text", placeholder: "SELECT Id, Name FROM Account" },
    ],
  },
  {
    source_type: "email",
    label: "E-mail (IMAP)",
    description: "Leitura de caixa de entrada via IMAP",
    icon: <Mail className="size-5" />,
    color: "text-red-400",
    canSync: true,
    fields: [
      { key: "host", label: "Host IMAP", type: "text", placeholder: "imap.gmail.com", required: true },
      { key: "port", label: "Porta", type: "number", placeholder: "993" },
      { key: "user", label: "E-mail", type: "text", placeholder: "contato@empresa.com", required: true },
      { key: "password", label: "Senha / App Password", type: "password" },
      { key: "folder", label: "Pasta", type: "text", placeholder: "INBOX" },
      { key: "max_emails", label: "Máx. e-mails por sync", type: "number", placeholder: "100" },
    ],
  },
  {
    source_type: "webhook",
    label: "Webhook",
    description: "Recebe dados via POST de sistemas externos",
    icon: <Webhook className="size-5" />,
    color: "text-yellow-400",
    fields: [
      { key: "secret", label: "Webhook Secret", type: "password" },
      { key: "expected_field", label: "Campo de conteúdo", type: "text", placeholder: "text" },
    ],
  },
  {
    source_type: "url",
    label: "URL / Web Scraping",
    description: "Extrai conteúdo de páginas web",
    icon: <Globe className="size-5" />,
    color: "text-cyan-400",
    canSync: true,
    fields: [
      { key: "url", label: "URL", type: "url", placeholder: "https://docs.minha-empresa.com", required: true },
      { key: "css_selector", label: "CSS selector (opcional)", type: "text", placeholder: "article.content" },
      { key: "follow_links", label: "Seguir links internos (true/false)", type: "text", placeholder: "false" },
    ],
  },
  {
    source_type: "obsidian",
    label: "Obsidian",
    description: "Vault do Obsidian via caminho no servidor",
    icon: <BookOpen className="size-5" />,
    color: "text-violet-400",
    canSync: true,
    fields: [
      { key: "vault_path", label: "Caminho do vault", type: "text", placeholder: "/vaults/minha-empresa", required: true },
      { key: "include_tags", label: "Tags a incluir (JSON)", type: "text", placeholder: '["#publico","#base"]' },
      { key: "exclude_folders", label: "Pastas a ignorar (JSON)", type: "text", placeholder: '["Pessoal","Rascunhos"]' },
    ],
  },
  {
    source_type: "upload",
    label: "Upload manual",
    description: "PDF, TXT e Markdown via upload direto",
    icon: <Upload className="size-5" />,
    color: "text-pink-400",
    fields: [],
  },
];

const connectorByType = Object.fromEntries(CONNECTORS.map((c) => [c.source_type, c]));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ source }: { source: KnowledgeSource }) {
  if (!source.is_active) return <Badge variant="secondary" className="text-xs">Inativo</Badge>;
  if (source.last_synced_at) return (
    <Badge className="text-xs gap-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
      <CheckCircle2 className="size-3" />
      Sincronizado
    </Badge>
  );
  return (
    <Badge className="text-xs gap-1 bg-yellow-500/15 text-yellow-400 border-yellow-500/30">
      <Clock className="size-3" />
      Pendente
    </Badge>
  );
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ─── Config Dialog ────────────────────────────────────────────────────────────

interface ConfigDialogProps {
  def: ConnectorDef;
  initial?: KnowledgeSource;
  onClose: () => void;
  onSaved: (ks: KnowledgeSource) => void;
}

function ConfigDialog({ def, initial, onClose, onSaved }: ConfigDialogProps) {
  const [name, setName] = useState(initial?.name ?? `${def.label} #1`);
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const base: Record<string, string> = {};
    if (initial?.config) {
      for (const [k, v] of Object.entries(initial.config)) {
        base[k] = String(v ?? "");
      }
    }
    return base;
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const setField = (key: string, value: string) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const cfg: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(config)) {
        if (v.trim()) cfg[k] = v.trim();
      }
      const ks = initial
        ? await updateKnowledgeSource(initial.id, { name, config: cfg })
        : await createKnowledgeSource({ name, source_type: def.source_type, config: cfg });
      onSaved(ks);
      toast.success(`Conector "${name}" ${initial ? "atualizado" : "criado"}.`);
      onClose();
    } catch {
      toast.error("Erro ao salvar conector.");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!initial) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testKnowledgeSourceConnection(initial.id);
      setTestResult(result);
    } catch {
      setTestResult({ ok: false, message: "Erro de rede ao testar conexão." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <span className={`${def.color}`}>{def.icon}</span>
            <div>
              <h3 className="font-semibold text-foreground">{initial ? "Editar" : "Novo"} {def.label}</h3>
              <p className="text-xs text-muted-foreground">{def.description}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nome do conector</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: CRM Vendas" className="bg-background" />
          </div>

          {def.fields.map((field) => (
            <div key={field.key} className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {field.label}
                {field.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              <Input
                type={field.type === "password" ? "password" : "text"}
                value={config[field.key] ?? ""}
                onChange={(e) => setField(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="bg-background font-mono text-sm"
              />
            </div>
          ))}

          {def.fields.length === 0 && (
            <p className="text-sm text-muted-foreground">Este tipo não tem configurações adicionais — salve e use o botão de upload diretamente.</p>
          )}

          {testResult && (
            <div className={`flex items-start gap-2 rounded-lg p-3 text-sm border ${testResult.ok ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>
              {testResult.ok ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" /> : <AlertCircle className="size-4 shrink-0 mt-0.5" />}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border gap-3">
          <div>
            {initial && (
              <Button variant="outline" size="sm" onClick={handleTest} disabled={testing} className="gap-2">
                <Link2 className="size-3.5" />
                {testing ? "Testando..." : "Testar conexão"}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()} className="gap-2">
              {saving ? <RefreshCw className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {initial ? "Salvar alterações" : "Criar conector"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Active connector card ────────────────────────────────────────────────────

interface ConnectorCardProps {
  source: KnowledgeSource;
  onEdit: () => void;
  onDelete: () => void;
  onSync: () => void;
  syncing: boolean;
}

function ConnectorCard({ source, onEdit, onDelete, onSync, syncing }: ConnectorCardProps) {
  const def = connectorByType[source.source_type];
  return (
    <div className="panel flex items-start gap-4">
      <span className={`shrink-0 grid size-10 place-items-center rounded-xl bg-muted/40 ${def?.color ?? "text-muted-foreground"}`}>
        {def?.icon ?? <Plug className="size-5" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-foreground">{source.name}</span>
          <Badge variant="outline" className="text-xs">{def?.label ?? source.source_type}</Badge>
          <StatusBadge source={source} />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Último sync: {fmtDate(source.last_synced_at)}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {def?.canSync && (
          <button
            onClick={onSync}
            disabled={syncing}
            title="Sincronizar agora"
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
          </button>
        )}
        <button
          onClick={onEdit}
          title="Editar"
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Pencil className="size-4" />
        </button>
        <button
          onClick={onDelete}
          title="Remover"
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Main tab export ──────────────────────────────────────────────────────────

export function ConnectorsTab() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ def: ConnectorDef; source?: KnowledgeSource } | null>(null);
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

  const handleSaved = (ks: KnowledgeSource) => {
    setSources((prev) => {
      const idx = prev.findIndex((s) => s.id === ks.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = ks;
        return next;
      }
      return [ks, ...prev];
    });
  };

  const handleDelete = async (source: KnowledgeSource) => {
    if (!confirm(`Remover conector "${source.name}"? Isso apaga os documentos indexados.`)) return;
    try {
      await deleteKnowledgeSource(source.id);
      setSources((prev) => prev.filter((s) => s.id !== source.id));
      toast.success("Conector removido.");
    } catch {
      toast.error("Erro ao remover conector.");
    }
  };

  const handleSync = async (source: KnowledgeSource) => {
    setSyncingId(source.id);
    try {
      await syncKnowledgeSource(source.id);
      toast.success(`Sync de "${source.name}" enfileirado.`);
      setTimeout(load, 1500);
    } catch {
      toast.error("Erro ao iniciar sync.");
    } finally {
      setSyncingId(null);
    }
  };

  const configured = sources.filter((s) => connectorByType[s.source_type]);
  const uncategorized = sources.filter((s) => !connectorByType[s.source_type]);

  return (
    <div className="space-y-6">
      {/* Active connectors */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Conectores configurados
            <span className="ml-2 text-xs text-muted-foreground font-normal">({sources.length})</span>
          </h3>
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className="size-3.5" />
            Atualizar
          </Button>
        </div>

        {loading ? (
          <div className="panel text-sm text-muted-foreground text-center py-8">Carregando...</div>
        ) : sources.length === 0 ? (
          <div className="panel text-sm text-muted-foreground text-center py-8">
            Nenhum conector ainda. Adicione um abaixo.
          </div>
        ) : (
          <div className="space-y-2">
            {configured.map((s) => (
              <ConnectorCard
                key={s.id}
                source={s}
                onEdit={() => setDialog({ def: connectorByType[s.source_type]!, source: s })}
                onDelete={() => void handleDelete(s)}
                onSync={() => void handleSync(s)}
                syncing={syncingId === s.id}
              />
            ))}
            {uncategorized.map((s) => (
              <ConnectorCard
                key={s.id}
                source={s}
                onEdit={() => {
                  const fallback: ConnectorDef = {
                    source_type: s.source_type,
                    label: s.source_type,
                    description: "Tipo personalizado",
                    icon: <Plug className="size-5" />,
                    color: "text-muted-foreground",
                    fields: [],
                  };
                  setDialog({ def: fallback, source: s });
                }}
                onDelete={() => void handleDelete(s)}
                onSync={() => void handleSync(s)}
                syncing={syncingId === s.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Connector gallery */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Adicionar conector</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CONNECTORS.map((def) => (
            <button
              key={def.source_type}
              onClick={() => setDialog({ def })}
              className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:border-border/80 hover:bg-muted/30 transition-all text-left"
            >
              <span className={`shrink-0 grid size-8 place-items-center rounded-lg bg-muted/40 ${def.color}`}>
                {def.icon}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{def.label}</p>
                <p className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">{def.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Dialog */}
      {dialog && (
        <ConfigDialog
          def={dialog.def}
          initial={dialog.source}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
