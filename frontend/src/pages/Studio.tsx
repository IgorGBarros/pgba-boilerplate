// frontend/src/pages/Studio.tsx
import { useEffect, useRef, useState } from "react";
import { Rocket, Sparkles, Building2, Plus, Circle, MessageSquare, Eye, PanelLeft } from "lucide-react";
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
  waitForServerReady,
  type GenerateLogEvent,
  type ProjectFile,
  type Workspace,
} from "@/lib/devserver";
import type { ChatMessage } from "@/types/builder";

const PRINCIPAL_URL = "http://localhost:5173";
type StudioView = "generate" | "company";
type MobilePanel = "chat" | "preview";

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
 *
 * Responsivo: abaixo do breakpoint `lg`, Chat e Preview nunca ficam lado
 * a lado (não cabem) — um seletor de painel decide qual mostrar. Em
 * telas `lg+`, os dois ficam visíveis ao mesmo tempo, como antes.
 */
export default function Studio() {
  const { messages, setMessages, history, clearAndArchive, deleteConversation, restoreConversation } = useChatPersistence();
  const { settings, updateSettings, resetSettings } = useSettings();

  const [view, setView] = useState<StudioView>("generate");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chat");
  const [activeProject, setActiveProject] = useState<string | null>(null); // null = Principal
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [logs, setLogs] = useState<GenerateLogEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [companyRefreshKey, setCompanyRefreshKey] = useState(0);
  const [startingProject, setStartingProject] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const activeWorkspace = workspaces.find((w) => w.name === activeProject) ?? null;
  const previewUrl = activeWorkspace?.running ? `http://localhost:${activeWorkspace.port}` : PRINCIPAL_URL;

  async function refreshFiles() {
    setFiles(await listProjectFiles(activeProject ?? undefined));
  }

  async function refreshWorkspaces() {
    setWorkspaces(await listWorkspaces());
  }

  // Sem isso, um workspace criado numa sessão anterior (devserver
  // reiniciado nesse meio-tempo) aparece pra sempre como "parado" na UI,
  // mesmo que continue existindo em disco — e clicar nele nunca troca o
  // preview, porque `running` nunca é reavaliado depois do mount inicial.
  useEffect(() => {
    refreshWorkspaces();
    const interval = setInterval(refreshWorkspaces, 5000);
    return () => {
      clearInterval(interval);
      eventSourceRef.current?.close();
    };
  }, []);

  useEffect(() => {
    refreshFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject]);

  function addMessage(msg: Omit<ChatMessage, "id" | "timestamp">) {
    setMessages((prev) => [...prev, { ...msg, id: crypto.randomUUID(), timestamp: new Date() }]);
  }

  // Este é o ponto que faltava: selecionar um projeto secundário só
  // trocava `activeProject`, nunca verificava se o processo estava
  // rodando de verdade — se não estivesse (ex: criado numa sessão
  // anterior), o preview silenciosamente continuava mostrando o
  // principal, dando a impressão de que a troca de projeto não fazia nada.
  async function handleSelectProject(name: string | null) {
    setActiveProject(name);
    if (name === null) return;

    const existing = workspaces.find((w) => w.name === name);
    if (existing?.running) return;

    setStartingProject(name);
    addMessage({ type: "plan", content: `Iniciando "${name}"...` });
    try {
      const started = await startWorkspace(name);
      const ready = await waitForServerReady(`http://localhost:${started.port}`);
      await refreshWorkspaces();
      addMessage({
        type: ready ? "assistant" : "error",
        content: ready
          ? `"${name}" no ar em http://localhost:${started.port}.`
          : `"${name}" subiu mas não respondeu a tempo em http://localhost:${started.port} — tente de novo em alguns segundos.`,
      });
    } catch (err) {
      addMessage({ type: "error", content: err instanceof Error ? err.message : `Falha ao iniciar "${name}".` });
    } finally {
      setStartingProject(null);
    }
  }

  async function handleCreateLocalProject() {
    const name = prompt("Nome do novo projeto (vira uma pasta local + porta própria):");
    if (!name?.trim()) return;

    addMessage({ type: "plan", content: `Criando projeto local "${name}" (npm install pode levar alguns segundos)...` });
    setStartingProject(name.trim());
    try {
      await createWorkspace(name.trim());
      const started = await startWorkspace(name.trim());
      const ready = await waitForServerReady(`http://localhost:${started.port}`);
      await refreshWorkspaces();
      setActiveProject(started.name);
      addMessage({
        type: ready ? "assistant" : "error",
        content: ready
          ? `Projeto "${started.name}" no ar em http://localhost:${started.port}.`
          : `Projeto "${started.name}" criado mas não respondeu a tempo — tente selecioná-lo de novo em alguns segundos.`,
      });
    } catch (err) {
      addMessage({ type: "error", content: err instanceof Error ? err.message : "Falha ao criar projeto local." });
    } finally {
      setStartingProject(null);
    }
  }

  async function handleSend(prompt: string) {
    addMessage({ type: "user", content: prompt });
    addMessage({ type: "plan", content: "Planejando e gerando a página..." });
    setIsLoading(true);
    setMobilePanel("chat");

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
    <div className="flex h-[calc(100dvh-56px)] w-full overflow-hidden">
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

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Seletor de projeto: Principal (este Studio) vs. secundários (processo/porta próprios) */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 bg-surface px-3 py-1.5 sm:px-4">
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="mr-1 flex shrink-0 items-center justify-center rounded-card p-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-100 lg:hidden"
            title="Histórico de conversas"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleSelectProject(null)}
            className={`shrink-0 rounded-card px-2.5 py-1 text-[11px] font-medium transition ${
              activeProject === null ? "bg-white/10 text-slate-100" : "text-slate-500 hover:text-slate-200"
            }`}
          >
            Principal
          </button>
          {workspaces.map((w) => (
            <button
              key={w.name}
              onClick={() => handleSelectProject(w.name)}
              disabled={startingProject === w.name}
              className={`flex shrink-0 items-center gap-1.5 rounded-card px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                activeProject === w.name ? "bg-white/10 text-slate-100" : "text-slate-500 hover:text-slate-200"
              }`}
            >
              <Circle className={`h-1.5 w-1.5 shrink-0 ${w.running ? "fill-green-400 text-green-400" : "fill-slate-600 text-slate-600"}`} />
              {w.name}
              {startingProject === w.name && <span className="text-[10px] text-slate-500">(iniciando...)</span>}
            </button>
          ))}
          <button
            onClick={handleCreateLocalProject}
            disabled={!!startingProject}
            className="flex shrink-0 items-center gap-1 rounded-card px-2.5 py-1 text-[11px] text-slate-500 transition hover:text-brand-500 disabled:opacity-50"
            title="Criar projeto local (processo/porta próprios)"
          >
            <Plus className="h-3 w-3" />
            <span className="hidden sm:inline">Projeto local</span>
          </button>
        </div>

        {/* Navegação interna (Gerar / Empresa) + Publicar no GitHub */}
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-surface-raised px-3 py-2 sm:px-4">
          <div className="flex gap-1">
            <button
              onClick={() => setView("generate")}
              className={`flex items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                view === "generate" ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30" : "text-slate-400 hover:bg-white/5"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Gerar</span>
            </button>
            <button
              onClick={() => setView("company")}
              className={`flex items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                view === "company" ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30" : "text-slate-400 hover:bg-white/5"
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Empresa</span>
            </button>
          </div>

          {/* Troca de painel — só existe abaixo de `lg`, onde chat+preview não cabem lado a lado */}
          {view === "generate" && (
            <div className="flex gap-1 rounded-card bg-black/20 p-0.5 lg:hidden">
              <button
                onClick={() => setMobilePanel("chat")}
                className={`flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium transition ${
                  mobilePanel === "chat" ? "bg-white/10 text-slate-100" : "text-slate-500"
                }`}
              >
                <MessageSquare className="h-3 w-3" />
                Chat
              </button>
              <button
                onClick={() => setMobilePanel("preview")}
                className={`flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium transition ${
                  mobilePanel === "preview" ? "bg-white/10 text-slate-100" : "text-slate-500"
                }`}
              >
                <Eye className="h-3 w-3" />
                Preview
              </button>
            </div>
          )}

          <button
            onClick={() => setNewProjectOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-card bg-brand-500 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm shadow-brand-500/30 transition hover:bg-brand-700 sm:px-3"
            title="Cria um repositório GitHub real com o template simple-commercial (independente do projeto local selecionado acima)"
          >
            <Rocket className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Publicar no GitHub</span>
          </button>
        </div>

        {view === "generate" ? (
          <div className="flex flex-1 overflow-hidden">
            <div className={`${mobilePanel === "chat" ? "flex" : "hidden"} w-full shrink-0 lg:flex lg:w-[38%] xl:w-[34%]`}>
              <ChatPanel messages={messages} isLoading={isLoading} onSend={handleSend} onReset={handleReset} />
            </div>
            <div className={`${mobilePanel === "preview" ? "flex" : "hidden"} min-w-0 flex-1 lg:flex`}>
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