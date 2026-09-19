// frontend/src/components/builder/GeneratePanel.tsx
import { useEffect, useRef, useState } from "react";
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
import type { ChatMessage } from "@/types/builder";

// Mostra só as páginas geradas, sem carregar o Studio de novo dentro do iframe.
const PREVIEW_URL = "http://localhost:5173/?embed=1&tab=pages";

export default function GeneratePanel() {
  const { messages, setMessages, history, clearAndArchive, deleteConversation, restoreConversation } =
    useChatPersistence("generate");

  const [logs, setLogs] = useState<GenerateLogEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    listProjectFiles().then(setFiles).catch(() => {});
  }, []);

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
        listProjectFiles().then(setFiles).catch(() => {});
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
    <div className="flex h-[calc(100dvh-112px)] w-full overflow-hidden">
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

      <div className="w-[38%] min-w-[340px] shrink-0 xl:w-[34%]">
        <ChatPanel messages={messages} isLoading={isLoading} onSend={handleSend} onReset={handleReset} />
      </div>

      <div className="min-w-0 flex-1">
        <PreviewPanel
          previewUrl={PREVIEW_URL}
          files={files}
          logs={logs}
          onClearLogs={() => setLogs([])}
          isTerminalOpen={isTerminalOpen}
          onToggleTerminal={() => setIsTerminalOpen((v) => !v)}
        />
      </div>
    </div>
  );
}
