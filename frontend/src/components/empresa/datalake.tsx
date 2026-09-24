import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Database,
  Table2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileText,
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
import {
  SchemaApp,
  ObsidianNote,
  SyncEvent,
  fetchSchemaCatalog,
  listObsidianNotes,
  listSyncEvents,
  listKnowledgeSources,
  syncKnowledgeSource,
} from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type RoadmapStatus = "done" | "in-progress" | "planned";

interface RoadmapItem {
  label: string;
  status: RoadmapStatus;
}

// ─── Static roadmap (planned features — not backed by DB) ─────────────────────

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

function RoadmapIcon({ status }: { status: RoadmapStatus }) {
  if (status === "done") return <CheckCircle2 className="w-4 h-4 text-success shrink-0" />;
  if (status === "in-progress") return <Zap className="w-4 h-4 text-warning shrink-0" />;
  return <Circle className="w-4 h-4 text-muted-foreground shrink-0" />;
}

// ─── Tab 1: Catálogo de Tabelas ───────────────────────────────────────────────

function CatalogTab() {
  const [schemas, setSchemas] = useState<SchemaApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSchema, setSelectedSchema] = useState<string>("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  useEffect(() => {
    fetchSchemaCatalog()
      .then((data) => {
        setSchemas(data);
        if (data.length > 0) setSelectedSchema(data[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalTables = schemas.reduce((s, sc) => s + sc.tables.length, 0);
  const totalRows = schemas.reduce((s, sc) => s + sc.tables.reduce((t, tb) => t + tb.rows, 0), 0);
  const activeSchema = schemas.find((s) => s.id === selectedSchema);

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Total Tabelas" value={totalTables.toString()} icon={<Table2 className="w-4 h-4" />} />
        <Metric label="Total Registros" value={fmtRows(totalRows)} icon={<Database className="w-4 h-4" />} />
        <Metric label="Apps Instalados" value={schemas.length.toString()} icon={<HardDrive className="w-4 h-4" />} />
        <Metric label="Atualizado" value="agora" icon={<Clock className="w-4 h-4" />} />
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground py-6 text-center">Carregando schema...</p>
      ) : schemas.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">Nenhum schema disponível.</p>
      ) : (
        <div className="flex gap-4">
          {/* Sidebar */}
          <div className="w-52 shrink-0 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 mb-2">
              Apps / Schemas
            </p>
            {schemas.map((sc) => (
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
          {activeSchema && (
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
                          <Badge variant="outline" className="text-xs shrink-0">{activeSchema.id}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{table.description}</p>
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          <span className="font-mono">{fmtRows(table.rows)} linhas</span>
                          <span>{table.columns.length} colunas</span>
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
                              <span className="font-mono text-xs px-1.5 py-0.5 rounded shrink-0 bg-primary/10 text-primary">
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
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab 2: Obsidian ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  indexed:  { label: "Indexada",           className: "text-success bg-success/10" },
  pending:  { label: "Pendente",           className: "text-warning bg-warning/10" },
  excluded: { label: "Excluída (private)", className: "text-muted-foreground bg-secondary" },
};

function ObsidianTab() {
  const [notes, setNotes] = useState<ObsidianNote[]>([]);
  const [syncEvents, setSyncEvents] = useState<SyncEvent[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const refresh = () => {
    listObsidianNotes().then(setNotes).catch(() => {});
    listSyncEvents().then(setSyncEvents).catch(() => {});
  };

  useEffect(() => { refresh(); }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const sources = await listKnowledgeSources();
      const obsidianSources = sources.filter((s) => s.source_type === "obsidian");
      if (obsidianSources.length === 0) {
        setSyncError("Nenhuma KnowledgeSource do tipo Obsidian configurada. Crie uma no painel de Conhecimento.");
        return;
      }
      await Promise.all(obsidianSources.map((s) => syncKnowledgeSource(s.id)));
      refresh();
    } catch {
      setSyncError("Falha ao iniciar sincronização.");
    } finally {
      setSyncing(false);
    }
  }

  const indexedCount = notes.filter((n) => n.status === "indexed").length;
  const totalChunks = notes.reduce((s, n) => s + n.chunks, 0);
  const lastSync = syncEvents[0];

  return (
    <div className="space-y-5">
      {/* Status card */}
      <div className="panel-elevated grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Última Sincronização</p>
          <p className="text-sm text-foreground">
            {lastSync ? new Date(lastSync.created_at).toLocaleString("pt-BR") : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Notas Indexadas</p>
          <p className="text-sm text-foreground font-semibold">{indexedCount.toLocaleString("pt-BR")}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Chunks Indexados</p>
          <p className="text-sm text-foreground font-semibold">{totalChunks.toLocaleString("pt-BR")}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Total de Notas</p>
          <p className="text-sm text-foreground font-semibold">{notes.length}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <SectionHeader title="Notas do Vault" />
        <Button size="sm" onClick={handleSync} disabled={syncing} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Sincronizando..." : "Sincronizar Agora"}
        </Button>
      </div>
      {syncError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {syncError}
        </p>
      )}

      {notes.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          Nenhuma nota Obsidian indexada. Configure uma KnowledgeSource do tipo obsidian no backend.
        </p>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-2 pr-4 font-medium">Título</th>
                <th className="text-left py-2 pr-4 font-medium">Tags</th>
                <th className="text-left py-2 pr-4 font-medium whitespace-nowrap">Modificação</th>
                <th className="text-right py-2 pr-4 font-medium">Chunks</th>
                <th className="text-left py-2 pr-4 font-medium">Embedding</th>
                <th className="text-left py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {notes.map((note) => {
                const sc = STATUS_CONFIG[note.status] ?? { label: note.status, className: "text-muted-foreground bg-secondary" };
                return (
                  <tr key={note.id} className="hover:bg-secondary/50 transition-colors">
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
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                      {note.last_modified ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs text-foreground">{note.chunks}</td>
                    <td className="py-2.5 pr-4">
                      {note.has_embedding ? (
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
      )}

      {/* Sync log */}
      <SectionHeader title="Log de Sincronização" />
      {syncEvents.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">Nenhum evento de sincronização registrado.</p>
      ) : (
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
              {syncEvents.map((ev) => (
                <tr key={ev.id} className="hover:bg-secondary/50 transition-colors">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    {new Date(ev.created_at).toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-xs text-success">+{ev.added}</td>
                  <td className="py-2 pr-4 text-right font-mono text-xs text-warning">{ev.updated}</td>
                  <td className="py-2 pr-4 text-right font-mono text-xs text-muted-foreground">
                    {ev.removed > 0 ? `-${ev.removed}` : "—"}
                  </td>
                  <td className="py-2 text-right font-mono text-xs text-muted-foreground">{ev.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

export function DataLakeView({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-5">
      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-gradient-to-r from-violet-600/20 via-purple-600/10 to-transparent border border-violet-500/20 px-5 py-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="shrink-0 grid size-8 place-items-center rounded-md text-violet-300 hover:text-violet-100 hover:bg-violet-500/20 transition-colors">
            <ArrowLeft className="size-4" />
          </button>
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-500/20 text-violet-300">
              <Database className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-lg font-display text-foreground">Data Lake</h2>
              <p className="text-xs text-muted-foreground">Catálogo de dados, fontes de conhecimento e integrações analíticas</p>
            </div>
          </div>
        </div>
      </div>

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
