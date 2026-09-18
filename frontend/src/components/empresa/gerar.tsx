import { useState } from "react";
import { toast } from "sonner";
import HistorySidebar from "@/components/builder/HistorySidebar";
import ChatPanel from "@/components/builder/ChatPanel";
import SettingsModal from "@/components/builder/SettingsModal";
import { useChatPersistence } from "@/hooks/useChatPersistence";
import { askStructured } from "@/lib/api";
import { DEFAULT_SETTINGS } from "@/types/settings";
import type { AppSettings } from "@/types/settings";
import type { ChatMessage } from "@/types/builder";

export function Gerar() {
  const { messages, setMessages, history, clearAndArchive, deleteConversation, restoreConversation } =
    useChatPersistence();
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const handleSend = async (content: string) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      type: "user",
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    try {
      const result = await askStructured(content);
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        type: "assistant",
        content: result.answer,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar mensagem");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = () => {
    clearAndArchive();
    setActiveConversationId(null);
  };

  const handleSelectConversation = (id: string) => {
    restoreConversation(id);
    setActiveConversationId(id);
  };

  const handleReset = () => {
    clearAndArchive();
    setActiveConversationId(null);
  };

  return (
    <>
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdate={(partial) => setSettings((prev) => ({ ...prev, ...partial }))}
        onReset={() => setSettings(DEFAULT_SETTINGS)}
      />
      <div className="flex h-[calc(100vh-56px-112px)] overflow-hidden rounded-lg border border-border">
        <HistorySidebar
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
          activeConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
          onNewChat={handleNewChat}
          conversations={history}
          onDeleteConversation={deleteConversation}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <div className="min-w-0 flex-1">
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            onSend={handleSend}
            onReset={handleReset}
          />
        </div>
      </div>
    </>
  );
}
