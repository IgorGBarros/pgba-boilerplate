// frontend/src/pages/Studio.tsx
import { useEffect, useRef, useState } from "react";
import { Rocket, Sparkles, Building2, Plus, Circle } from "lucide-react";
import ChatPanel from "@/components/builder/ChatPanel";
import PreviewPanel from "@/components/builder/PreviewPanel";
import HistorySidebar from "@/components/builder/HistorySidebar";
import CommandPalette from "@/components/builder/CommandPalette";
import SettingsModal from "@/components/builder/SettingsModal";
import CompanyOverview from "@/components/builder/CompanyOverview";
import NewProjectModal from "@/components/builder/NewProjectModal";
import { useChatPersistence } from "@/hooks/useChatPersistence";
import { useSettings } from "@/hooks/useSettings";
import {
  connectGenerateStream,
  triggerGeneratePage,
  listProjectFiles,
  listWorkspaces,
  createWorkspace,
  startWorkspace,
  type GenerateLogEvent,
  type ProjectFile,
  type Workspace,
} from "@/lib/devserver";
import type { ChatMessage } from "@/types/builder";

const PRINCIPAL_URL = "http://localhost:5173";
type StudioView = "generate" | "company";

/**
 * Painel principal do sistema (ver CLAUDE.md).
 *
 * Modelo de PRINCIPAL vs. SECUNDÁRIO (igual ao Lovable de verdade):
 * - PRINCIPAL: este próprio Studio (porta 5173/5174) — sempre no ar, com
 *   toda a automação (harness, credenciais, guardrails). Editar aqui
 *   estende o PRÓPRIO app do Studio.
 * - SECUNDÁRIO: cada "projeto local" é um processo Vite isolado, em
 *   porta própria (`devserver/lib/workspace.mjs` aloca 4000-4099) — é
 *   onde a IA constrói um produto novo do zero, sem misturar com o
 *   principal. Pode existir mais de um rodando ao mesmo tempo.
 *
 * "Publicar no GitHub" é uma ação distinta de "criar projeto local": cria
 * um repositório de verdade (agency.create_project, template
 * simple-commercial) — hoje não sincroniza automaticamente com o que foi
 * gerado no workspace local (limitação conhecida, ver CLAUDE.md).
 */
export default function Studio() {
  const { messages, setMessages, history, clearAndArchive, deleteConversation, restoreConversation } = useChatPersistence();
  const { settings, updateSettings, resetSettings } = useSettings();

  const [view, setView] = useState<StudioView>("generate");
  const [activeProject, setActiveProject] = useState<string | null>(null); // null = Principal
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [logs, setLogs] = useState<GenerateLogEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [companyRefreshKey, setCompanyRefreshKey] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const activeWorkspace = workspaces.find((w) => w.name === activeProject) ?? null;
  const previewUrl = activeWorkspace?.running ? `http://localhost:${activeWorkspace.port}` : PRINCIPAL_URL;

  async function refreshFiles() {
    setFiles(await listProjectFiles(activeProject ?? undefined));
  }

  async function refreshWorkspaces() {
    setWorkspaces(await listWorkspaces());
  }

  useEffect(() => {
    refreshWorkspaces();
    return () => eventSourceRef.current?.close();
  }, []);

  useEffect(() => {
    refreshFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject]);

  function addMessage(msg: Omit<ChatMessage, "id" | "timestamp">) {
    setMessages((prev) => [...prev, { ...msg, id: crypto.randomUUID(), timestamp: new Date() }]);
  }

  async function handleCreateLocalProject() {
    const name = prompt("Nome do novo projeto (vira uma pasta local + porta própria):");
    if (!name?.trim()) return;

    addMessage({ type: "plan", content: `Criando projeto local "${name}" (npm install pode levar alguns segundos)...` });
    try {
      await createWorkspace(name.trim());
      const started = await startWorkspace(name.trim());
      await refreshWorkspaces();
      setActiveProject(started.name);
      addMessage({ type: "assistant", content: `Projeto "${started.name}" no ar em http://localhost:${started.port}.` });
    } catch (err) {
      addMessage({ type: "error", content: err instanceof Error ? err.message : "Falha ao criar projeto local." });
    }
  }

  async function handleSend(prompt: string) {
    addMessage({ type: "user", content: prompt });
    addMessage({ type: "plan", content: "Planejando e gerando a página..." });
    setIsLoading(true);

    const jobId = `job_${Date.now()}`;
    const accessToken = localStorage.getItem("pgba_access_token") ?? undefined;

    const source = connectGenerateStream(jobId, (event) => {
      setLogs((prev) => [...prev, event]);

      if (event.stage === "write") {
        addMessage({ type: "assistant", content: event.message, fileName: event.result?.filePath });
      } else if (event.stage === "validate" && event.message.includes("falhou")) {
        addMessage({ type: "fix", content: event.message });
      } else if (event.stage === "done") {
        addMessage({ type: "assistant", content: event.message });
      } else if (event.stage === "complete") {
        setIsLoading(false);
        refreshFiles();
        source.close();
      } else if (event.stage === "error") {
        addMessage({ type: "error", content: event.message });
        setIsLoading(false);
        source.close();
      }
    });
    eventSourceRef.current = source;

    try {
      await triggerGeneratePage({ jobId, prompt, accessToken, workspace: activeProject ?? undefined });
    } catch (err) {
      addMessage({ type: "error", content: err instanceof Error ? err.message : "Falha ao iniciar geração." });
      setIsLoading(false);
      source.close();
    }
  }

  function handleReset() {
    clearAndArchive();
    setLogs([]);
    setActiveConversation(null);
  }

  function handleNewChat() {
    clearAndArchive();
    setActiveConversation(null);
    setLogs([]);
  }

  function handleSelectConversation(id: string) {
    setActiveConversation(id);
    restoreConversation(id);
    setLogs([]);
  }

  return (
    <div className="flex h-[calc(100vh-57px)] w-full overflow-hidden">
      <HistorySidebar
        isCollapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeConversationId={activeConversation}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        conversations={history}
        onDeleteConversation={deleteConversation}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Seletor de projeto: Principal (este Studio) vs. secundários (processo/porta próprios) */}
        <div className="flex items-center gap-1 border-b border-white/10 bg-surface px-4 py-1.5">
          <button
            onClick={() => setActiveProject(null)}
            className={`flex items-center gap-1.5 rounded-card px-2.5 py-1 text-[11px] font-medium transition ${
              activeProject === null ? "bg-white/10 text-slate-100" : "text-slate-500 hover:text-slate-200"
            }`}
          >
            Principal
          </button>
          {workspaces.map((w) => (
            <button
              key={w.name}
              onClick={() => setActiveProject(w.name)}
              className={`flex items-center gap-1.5 rounded-card px-2.5 py-1 text-[11px] font-medium transition ${
                activeProject === w.name ? "bg-white/10 text-slate-100" : "text-slate-500 hover:text-slate-200"
              }`}
            >
              <Circle className={`h-1.5 w-1.5 ${w.running ? "fill-green-400 text-green-400" : "fill-slate-600 text-slate-600"}`} />
              {w.name}
            </button>
          ))}
          <button onClick={handleCreateLocalProject} className="flex items-center gap-1 rounded-card px-2.5 py-1 text-[11px] text-slate-500 hover:text-brand-500" title="Criar projeto local (processo/porta próprios)">
            <Plus className="h-3 w-3" />
            Projeto local
          </button>
        </div>

        {/* Navegação interna (Gerar / Empresa) + Publicar no GitHub */}
        <div className="flex items-center justify-between border-b border-white/10 bg-surface-raised px-4 py-2">
          <div className="flex gap-1">
            <button
              onClick={() => setView("generate")}
              className={`flex items-center gap-1.5 rounded-card px-3 py-1.5 text-xs font-medium transition ${
                view === "generate" ? "bg-brand-500 text-white" : "text-slate-400 hover:bg-white/5"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Gerar
            </button>
            <button
              onClick={() => setView("company")}
              className={`flex items-center gap-1.5 rounded-card px-3 py-1.5 text-xs font-medium transition ${
                view === "company" ? "bg-brand-500 text-white" : "text-slate-400 hover:bg-white/5"
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              Empresa
            </button>
          </div>

          <button
            onClick={() => setNewProjectOpen(true)}
            className="flex items-center gap-1.5 rounded-card bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
            title="Cria um repositório GitHub real com o template simple-commercial (independente do projeto local selecionado acima)"
          >
            <Rocket className="h-3.5 w-3.5" />
            Publicar no GitHub
          </button>
        </div>

        {view === "generate" ? (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-[42%] shrink-0">
              <ChatPanel messages={messages} isLoading={isLoading} onSend={handleSend} onReset={handleReset} />
            </div>
            <div className="flex-1">
              <PreviewPanel previewUrl={previewUrl} files={files} logs={logs} onClearLogs={() => setLogs([])} workspace={activeProject ?? undefined} />
            </div>
          </div>
        ) : (
          <CompanyOverview key={companyRefreshKey} />
        )}
      </div>

      <CommandPalette
        onNewChat={handleNewChat}
        onToggleTerminal={() => setIsTerminalOpen(!isTerminalOpen)}
        onResetChat={handleReset}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onUpdate={updateSettings} onReset={resetSettings} />

      <NewProjectModal isOpen={newProjectOpen} onClose={() => setNewProjectOpen(false)} onCreated={() => setCompanyRefreshKey((k) => k + 1)} />
    </div>
  );
}
