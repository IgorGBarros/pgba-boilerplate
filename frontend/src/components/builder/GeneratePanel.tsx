// frontend/src/components/builder/GeneratePanel.tsx
import { useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import ChatPanel from "@/components/builder/ChatPanel";
import HistorySidebar from "@/components/builder/HistorySidebar";
import PreviewPanel from "@/components/builder/PreviewPanel";
import { useChatPersistence } from "@/hooks/useChatPersistence";
import {
  connectGenerateStream,
  listProjectFiles,
  triggerGeneratePage,
  type GenerateLogEvent,
  type ProjectFile,
} from "@/lib/devserver";
import { listProjects, type Project } from "@/lib/api";
import type { ChatMessage } from "@/types/builder";

// Mostra só as páginas geradas, sem carregar o Studio de novo dentro do iframe.
const PREVIEW_URL = "http://localhost:5173/?embed=1&tab=pages";

interface GeneratePanelProps {
  initialProjectId?: number;
}

export default function GeneratePanel({ initialProjectId }: GeneratePanelProps) {
  const { messages, setMessages, history, clearAndArchive, deleteConversation, restoreConversation } =
    useChatPersistence("generate");

  const [logs, setLogs] = useState<GenerateLogEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [chatWidth, setChatWidth] = useState(38); // percent
  const dragging = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  function refreshFiles(project?: Project | null) {
    const p = project ?? activeProject;
    listProjectFiles(p?.workspace || undefined, p?.local_path || undefined)
      .then(setFiles)
      .catch(() => {});
  }

  useEffect(() => {
    listProjects().then((list) => {
      setProjects(list);
      if (initialProjectId != null) {
        setActiveProjectId(initialProjectId);
        const proj = list.find((p) => p.id === initialProjectId) ?? null;
        if (proj) refreshFiles(proj);
      }
    }).catch(() => {});
    if (initialProjectId == null) refreshFiles(null);
  }, []);

  useEffect(() => {
    if (initialProjectId == null) return;
    setActiveProjectId(initialProjectId);
    const proj = projects.find((p) => p.id === initialProjectId) ?? null;
    if (proj) refreshFiles(proj);
  }, [initialProjectId]);

  // Cmd+K (Mac) / Ctrl+K (Windows) — alterna o terminal
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsTerminalOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Fecha o stream anterior se o componente desmontar
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  function startDrag(e: React.MouseEvent) {
    dragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !rootRef.current) return;
      const rect = rootRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setChatWidth(Math.max(20, Math.min(60, pct)));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function addMessage(msg: Omit<ChatMessage, "id" | "timestamp">) {
    setMessages((prev) => [...prev, { ...msg, id: crypto.randomUUID(), timestamp: new Date() }]);
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
      await triggerGeneratePage({ jobId, prompt, accessToken });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao iniciar geração.";
      addMessage({ type: "error", content: message });
      toast.error(message);
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
    <div ref={rootRef} className="flex h-[calc(100dvh-112px)] w-full overflow-hidden">
      <HistorySidebar
        isCollapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeConversationId={activeConversation}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        conversations={history}
        onDeleteConversation={deleteConversation}
        onOpenSettings={() => {}}
      />

      <div className="shrink-0 overflow-hidden" style={{ width: `${chatWidth}%`, minWidth: "280px" }}>
        <ChatPanel messages={messages} isLoading={isLoading} onSend={handleSend} onReset={handleReset} />
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={startDrag}
        className="flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-white/5 hover:bg-white/10"
        title="Arraste para redimensionar"
      >
        <GripVertical className="h-4 w-4 text-slate-600" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Seletor de projeto — define de onde a árvore de arquivos é carregada */}
        {projects.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-surface px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">Projeto</span>
            <select
              value={activeProjectId ?? ""}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                setActiveProjectId(id);
                const proj = id ? projects.find((p) => p.id === id) ?? null : null;
                refreshFiles(proj);
              }}
              className="flex-1 rounded border border-white/10 bg-transparent px-2 py-0.5 text-xs text-slate-300 focus:border-brand-500 focus:outline-none"
            >
              <option value="">— Studio (padrão) —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.local_path ? " (pasta local)" : p.workspace ? " (workspace)" : ""}
                </option>
              ))}
            </select>
            {activeProject?.local_path && (
              <span className="max-w-[200px] truncate text-[10px] text-slate-500" title={activeProject.local_path}>
                {activeProject.local_path}
              </span>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <PreviewPanel
            previewUrl={PREVIEW_URL}
            files={files}
            logs={logs}
            onClearLogs={() => setLogs([])}
            workspace={activeProject?.workspace || undefined}
            localPath={activeProject?.local_path || undefined}
            isTerminalOpen={isTerminalOpen}
            onToggleTerminal={() => setIsTerminalOpen((v) => !v)}
          />
        </div>
      </div>
    </div>
  );
}
