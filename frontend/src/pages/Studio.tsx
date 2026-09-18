// frontend/src/pages/Studio.tsx
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Rocket, Sparkles, Building2, Box, Boxes, AlertTriangle, ListChecks, ShieldAlert, MessagesSquare, Download, FolderTree, ScrollText } from "lucide-react";
import ChatPanel from "@/components/builder/ChatPanel";
import PreviewPanel from "@/components/builder/PreviewPanel";
import HistorySidebar from "@/components/builder/HistorySidebar";
import CommandPalette from "@/components/builder/CommandPalette";
import SettingsModal from "@/components/builder/SettingsModal";
import CompanyOverview from "@/components/builder/CompanyOverview";
import TaskBoard from "@/components/builder/TaskBoard";
import GovernancePanel from "@/components/builder/GovernancePanel";
import LogsPanel from "@/components/builder/LogsPanel";
import KnowledgePanel from "@/components/builder/KnowledgePanel";
import SectorMessagesPanel from "@/components/builder/SectorMessagesPanel";
import NewProjectModal from "@/components/builder/NewProjectModal";
import ImportProjectModal from "@/components/builder/ImportProjectModal";
import ProjectsTree from "@/components/builder/ProjectsTree";
import { useChatPersistence } from "@/hooks/useChatPersistence";
import { useSettings } from "@/hooks/useSettings";
import { listAgents, createTask, reportTaskResult, type Agent } from "@/lib/api";
import {
  connectGenerateStream,
  triggerGeneratePage,
  listProjectFiles,
  listWorkspaces,
  startWorkspace,
  waitForServerReady,
  isDevServerReachable,
  type GenerateLogEvent,
  type ProjectFile,
  type Workspace,
} from "@/lib/devserver";
import type { ChatMessage } from "@/types/builder";

// Carregado sob demanda: Three.js + @react-three/fiber são pesados —
// só quem abre a aba "Escritório 3D" paga esse custo.
const CompanyOffice3D = lazy(() => import("@/components/builder/CompanyOffice3D"));

// `?embed=1&tab=pages`: mostra só as páginas geradas, sem cabeçalho/abas
// do app inteiro — apontar pra "http://localhost:5173" puro faria o
// iframe carregar o Studio de novo (com sua própria aba Estúdio, com
// outro iframe apontando pra si mesma — a recursão visual que aparecia
// na tela quando "Principal" estava selecionado).
const PRINCIPAL_URL = "http://localhost:5173/?embed=1&tab=pages";
type StudioView = "generate" | "company" | "office3d" | "tasks" | "governance" | "messages" | "projects" | "logs" | "knowledge";

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
 * Uso exclusivo em notebook/desktop (14" ou maior) — sem suporte a
 * celular. Chat e Preview sempre lado a lado; sem seletor de painel.
 */
export default function Studio() {
  const { messages, setMessages, history, clearAndArchive, deleteConversation, restoreConversation } = useChatPersistence();
  const { settings, updateSettings, resetSettings } = useSettings();

  const [view, setView] = useState<StudioView>("company");
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
  const [importProjectOpen, setImportProjectOpen] = useState(false);
  const [companyRefreshKey, setCompanyRefreshKey] = useState(0);
  const [startingProject, setStartingProject] = useState<string | null>(null);
  const [devServerDown, setDevServerDown] = useState(false);
  // Achado uma vez, no mount — usado pra criar uma Task real antes de
  // gerar página (ver handleSend). Se ficar null (seed_company nunca
  // rodou, ou o agente foi renomeado), handleSend cai de volta pro
  // comportamento antigo, sem Task nenhuma — nunca bloqueia a geração
  // por causa disso, governança é aditiva aqui, não um portão.
  const [frontendAgentId, setFrontendAgentId] = useState<number | null>(null);
  // Gerar não abre mais sozinho: só fica disponível depois que a aba
  // Projetos manda abrir Principal ou um projeto específico
  // (handleOpenGerar) — sem isso, mostra estado vazio pedindo pra
  // selecionar primeiro. Evita "gerar solto" sem saber em cima de qual
  // pasta está trabalhando.
  const [hasOpenedGerar, setHasOpenedGerar] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const activeWorkspace = workspaces.find((w) => w.name === activeProject) ?? null;
  const previewUrl = activeWorkspace?.running ? `http://localhost:${activeWorkspace.port}` : PRINCIPAL_URL;

  async function refreshFiles() {
    setFiles(await listProjectFiles(activeProject ?? undefined));
  }

  async function refreshWorkspaces() {
    const data = await listWorkspaces();
    setWorkspaces(data);
    // listWorkspaces() já engole erro de rede (nunca lança) — o jeito de
    // saber se a chamada realmente falhou é perguntar pro próprio
    // cliente depois dela rodar, não pelo valor de retorno.
    setDevServerDown(!isDevServerReachable());
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

  useEffect(() => {
    listAgents()
      .then((agents) => {
        const frontend = agents.find((a: Agent) => a.name === "AI Frontend");
        if (frontend) setFrontendAgentId(frontend.id);
      })
      .catch(() => {
        // Silencioso de propósito — sem agente, handleSend só não cria
        // Task, gera a página igual sempre gerou.
      });
  }, []);

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

  /**
   * Chamada pela aba Projetos quando o usuário clica "Abrir Gerar" num
   * item selecionado — nunca disparada pelo próprio Gerar. Isso é a
   * peça que fecha "Gerar só aparece depois de selecionar um projeto":
   * sem passar por aqui, `hasOpenedGerar` continua false e a tela
   * mostra o estado vazio em vez do chat.
   */
  function handleOpenGerar(workspaceName: string | null) {
    setHasOpenedGerar(true);
    handleSelectProject(workspaceName);
    setView("generate");
  }

  async function handleSend(prompt: string) {
    addMessage({ type: "user", content: prompt });
    addMessage({ type: "plan", content: "Planejando e gerando a página..." });
    setIsLoading(true);

    // Task real pro AI Frontend ANTES de gerar — assim a governança
    // (aba Tarefas, aprovação) vê isso desde o início, não só depois de
    // pronto. Nunca bloqueia a geração: se o agente não foi achado (ver
    // useEffect acima) ou a criação falhar por qualquer motivo, segue
    // sem Task nenhuma — exatamente o comportamento de antes desta
    // mudança.
    let taskId: number | null = null;
    if (frontendAgentId !== null) {
      try {
        const task = await createTask({ agentId: frontendAgentId, brief: prompt, taskType: "gerar_pagina" });
        taskId = task.id;
      } catch {
        // Silencioso de propósito — geração de página não deveria falhar
        // só porque o registro de governança falhou.
      }
    }

    const generatedFiles: string[] = [];
    const jobId = `job_${Date.now()}`;
    const accessToken = localStorage.getItem("pgba_access_token") ?? undefined;

    const source = connectGenerateStream(jobId, (event) => {
      setLogs((prev) => [...prev, event]);

      if (event.stage === "write") {
        addMessage({ type: "assistant", content: event.message, fileName: event.result?.filePath });
        if (event.result?.filePath) generatedFiles.push(event.result.filePath);
      } else if (event.stage === "validate" && event.message.includes("falhou")) {
        addMessage({ type: "fix", content: event.message });
      } else if (event.stage === "done") {
        addMessage({ type: "assistant", content: event.message });
      } else if (event.stage === "complete") {
        setIsLoading(false);
        refreshFiles();
        source.close();
        if (taskId !== null) {
          reportTaskResult(taskId, {
            success: true,
            result: { summary: "Página gerada e validada (typecheck/lint) com sucesso.", prompt },
            currentFiles: generatedFiles,
          }).catch(() => {
            // Idem — falha ao registrar nunca deveria desfazer uma
            // geração que já funcionou.
          });
        }
      } else if (event.stage === "error") {
        addMessage({ type: "error", content: event.message });
        setIsLoading(false);
        source.close();
        if (taskId !== null) {
          reportTaskResult(taskId, { success: false, result: { error: event.message } }).catch(() => {});
        }
      }
    });
    eventSourceRef.current = source;

    try {
      await triggerGeneratePage({ jobId, prompt, accessToken, workspace: activeProject ?? undefined });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao iniciar geração.";
      addMessage({ type: "error", content: message });
      setIsLoading(false);
      source.close();
      if (taskId !== null) {
        reportTaskResult(taskId, { success: false, result: { error: message } }).catch(() => {});
      }
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
        {devServerDown && (
          <div className="flex items-center gap-2 border-b border-yellow-500/20 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Dev-server não está respondendo (porta 5174). Gerar página, ver arquivos e projetos locais não vão
            funcionar até você rodar <code className="rounded bg-black/20 px-1 py-0.5">npm run dev:admin</code> em vez de
            <code className="rounded bg-black/20 px-1 py-0.5">npm run dev</code>.
          </div>
        )}

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
            <button
              onClick={() => setView("projects")}
              className={`flex items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                view === "projects" ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30" : "text-slate-400 hover:bg-white/5"
              }`}
            >
              <FolderTree className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Projetos</span>
            </button>
            <button
              onClick={() => setView("office3d")}
              className={`flex items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                view === "office3d" ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30" : "text-slate-400 hover:bg-white/5"
              }`}
            >
              <Box className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Escritório 3D</span>
            </button>
            <button
              onClick={() => setView("tasks")}
              className={`flex items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                view === "tasks" ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30" : "text-slate-400 hover:bg-white/5"
              }`}
            >
              <ListChecks className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Tarefas</span>
            </button>
            <button
              onClick={() => setView("governance")}
              className={`flex items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                view === "governance" ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30" : "text-slate-400 hover:bg-white/5"
              }`}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Aprovações e Políticas</span>
            </button>
            <button
              onClick={() => setView("logs")}
              className={`flex items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                view === "logs" ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30" : "text-slate-400 hover:bg-white/5"
              }`}
            >
              <ScrollText className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logs</span>
            </button>
            <button
              onClick={() => setView("knowledge")}
              className={`flex items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                view === "knowledge" ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30" : "text-slate-400 hover:bg-white/5"
              }`}
            >
              <Boxes className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Conhecimento</span>
            </button>
            <button
              onClick={() => setView("messages")}
              className={`flex items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                view === "messages" ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30" : "text-slate-400 hover:bg-white/5"
              }`}
            >
              <MessagesSquare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Mensagens</span>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setImportProjectOpen(true)}
              className="flex items-center gap-1.5 rounded-card border border-white/10 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/5 sm:px-3"
              title="Registra um repositório GitHub que já existe (nunca cria um novo)"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Importar projeto</span>
            </button>
            <button
              onClick={() => setNewProjectOpen(true)}
              className="flex items-center gap-1.5 rounded-card bg-brand-500 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm shadow-brand-500/30 transition hover:bg-brand-700 sm:px-3"
              title="Cria pasta local + repositório GitHub com o template simple-commercial, atomicamente"
            >
              <Rocket className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Novo projeto</span>
            </button>
          </div>
        </div>

        {view === "generate" && !hasOpenedGerar && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <Sparkles className="h-8 w-8 text-slate-600" />
            <p className="text-sm font-medium text-slate-300">Selecione um projeto primeiro</p>
            <p className="max-w-sm text-xs text-slate-500">
              Gerar página precisa saber em qual pasta trabalhar — abra o Motor Principal ou um projeto na aba
              Projetos, e clique em "Abrir Gerar" ali.
            </p>
            <button
              onClick={() => setView("projects")}
              className="mt-2 flex items-center gap-1.5 rounded-card bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              <FolderTree className="h-4 w-4" />
              Ir pra Projetos
            </button>
          </div>
        )}
        {view === "generate" && hasOpenedGerar && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-1.5 border-b border-white/10 bg-black/20 px-4 py-1.5 text-[11px] text-slate-400">
              <FolderTree className="h-3 w-3" />
              Trabalhando em: <span className="font-medium text-slate-200">{activeProject ?? "Motor Principal"}</span>
              {startingProject === activeProject && startingProject !== null && (
                <span className="flex items-center gap-1 text-yellow-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
                  iniciando...
                </span>
              )}
            </div>
            <div className="flex flex-1 overflow-hidden">
              <div className="w-[38%] min-w-[380px] shrink-0 xl:w-[34%]">
                <ChatPanel messages={messages} isLoading={isLoading} onSend={handleSend} onReset={handleReset} />
              </div>
              <div className="min-w-0 flex-1">
                <PreviewPanel previewUrl={previewUrl} files={files} logs={logs} onClearLogs={() => setLogs([])} workspace={activeProject ?? undefined} />
              </div>
            </div>
          </div>
        )}
        {view === "company" && <CompanyOverview key={companyRefreshKey} />}
        {view === "office3d" && (
          <Suspense fallback={<p className="p-6 text-sm text-slate-500">Carregando o escritório 3D...</p>}>
            <CompanyOffice3D key={companyRefreshKey} />
          </Suspense>
        )}
        {view === "tasks" && <TaskBoard />}
        {view === "governance" && <GovernancePanel />}
        {view === "logs" && <LogsPanel />}
        {view === "knowledge" && <KnowledgePanel />}
        {view === "messages" && <SectorMessagesPanel />}
        {view === "projects" && (
          <ProjectsTree
            onOpenGerar={handleOpenGerar}
            onNewProject={() => setNewProjectOpen(true)}
            onImportProject={() => setImportProjectOpen(true)}
          />
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
      <ImportProjectModal isOpen={importProjectOpen} onClose={() => setImportProjectOpen(false)} onImported={() => setCompanyRefreshKey((k) => k + 1)} />
    </div>
  );
}