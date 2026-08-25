// frontend/src/pages/Studio.tsx
import { useEffect, useRef, useState } from "react";
import ChatPanel from "@/components/builder/ChatPanel";
import PreviewPanel from "@/components/builder/PreviewPanel";
import HistorySidebar from "@/components/builder/HistorySidebar";
import CommandPalette from "@/components/builder/CommandPalette";
import SettingsModal from "@/components/builder/SettingsModal";
import { useChatPersistence } from "@/hooks/useChatPersistence";
import { useSettings } from "@/hooks/useSettings";
import {
  connectGenerateStream,
  triggerGeneratePage,
  listProjectFiles,
  type GenerateLogEvent,
  type ProjectFile,
} from "@/lib/devserver";
import type { ChatMessage } from "@/types/builder";

const PREVIEW_URL = "http://localhost:5173";

/**
 * Substitui o AdminCreate.tsx por uma experiência completa estilo
 * builder — chat + histórico persistido + preview ao vivo + árvore de
 * arquivos + terminal + paleta de comandos — adaptado do LovableClone
 * (create-ia-frontend), ligado à infraestrutura real deste projeto
 * (`devserver` via SSE, `harness/generate` com guardrails), não a um
 * backend Express solto sem validação.
 *
 * Diferença deliberada do original: configuração de modelo/credencial de
 * IA NÃO mora aqui (nem em localStorage) — isso é responsabilidade do
 * `harness` no backend. Ver SettingsModal.tsx.
 */
export default function Studio() {
  const { messages, setMessages, history, clearAndArchive, deleteConversation, restoreConversation } = useChatPersistence();
  const { settings, updateSettings, resetSettings } = useSettings();

  const [logs, setLogs] = useState<GenerateLogEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  async function refreshFiles() {
    setFiles(await listProjectFiles());
  }

  useEffect(() => {
    refreshFiles();
    return () => eventSourceRef.current?.close();
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

      <div className="w-[38%] shrink-0">
        <ChatPanel messages={messages} isLoading={isLoading} onSend={handleSend} onReset={handleReset} />
      </div>

      <div className="flex-1">
        <PreviewPanel previewUrl={PREVIEW_URL} files={files} logs={logs} onClearLogs={() => setLogs([])} />
      </div>

      <CommandPalette
        onNewChat={handleNewChat}
        onToggleTerminal={() => setIsTerminalOpen(!isTerminalOpen)}
        onResetChat={handleReset}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdate={updateSettings}
        onReset={resetSettings}
      />
    </div>
  );
}
