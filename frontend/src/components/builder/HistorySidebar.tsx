// frontend/src/components/builder/HistorySidebar.tsx
import { useState } from "react";
import { Plus, Search, Trash2, ChevronLeft, ChevronRight, FileCode, Settings, Clock } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { Conversation } from "@/types/builder";

interface HistorySidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  conversations: Conversation[];
  onDeleteConversation: (id: string) => void;
  onOpenSettings: () => void;
}

function formatTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

export default function HistorySidebar({
  isCollapsed,
  onToggle,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  conversations,
  onDeleteConversation,
  onOpenSettings,
}: HistorySidebarProps) {
  const [search, setSearch] = useState("");
  const filtered = conversations.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()));

  function handleSelect(id: string) {
    onSelectConversation(id);
  }

  const content = (
    <>
      <div className="flex items-center justify-between px-2 py-3">
        {!isCollapsed && <span className="pl-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Histórico</span>}
        <button onClick={onToggle} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100">
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <div className="px-2 pb-2">
        <button
          onClick={onNewChat}
          className={`flex w-full items-center gap-2 rounded-lg border border-dashed border-white/15 px-3 py-2 text-xs text-slate-400 transition hover:border-brand-500/50 hover:text-brand-500 ${
            isCollapsed ? "justify-center px-0" : ""
          }`}
        >
          <Plus className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span>Nova conversa</span>}
        </button>
      </div>

      {!isCollapsed && (
        <div className="px-2 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversas..."
              className="flex-1 bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2">
        <AnimatePresence>
          {filtered.length === 0 && !isCollapsed && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-2 py-4 text-center text-[11px] text-slate-500">
              Nenhuma conversa ainda
            </motion.p>
          )}
          {filtered.map((conv) => (
            <motion.button
              key={conv.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              onClick={() => handleSelect(conv.id)}
              className={`group mb-1 flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition ${
                activeConversationId === conv.id ? "bg-brand-500/10 text-brand-500" : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
              } ${isCollapsed ? "justify-center" : ""}`}
            >
              <FileCode className="mt-0.5 h-4 w-4 shrink-0" />
              {!isCollapsed && (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{conv.title}</p>
                  <p className="mt-0.5 truncate text-[10px] opacity-60">{conv.lastMessage}</p>
                </div>
              )}
              {!isCollapsed && (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[10px] opacity-50">{formatTime(conv.timestamp)}</span>
                  <Trash2
                    className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-50 hover:!opacity-100 hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteConversation(conv.id);
                    }}
                  />
                </div>
              )}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      <div className="border-t border-white/10 px-2 py-2">
        <div className="flex items-center justify-between">
          {!isCollapsed && (
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              <Clock className="h-3 w-3" />
              <span>{conversations.length} conversas</span>
            </div>
          )}
          <button onClick={onOpenSettings} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100" title="Configurações">
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <motion.div
      animate={{ width: isCollapsed ? 48 : 260 }}
      transition={{ duration: 0.2 }}
      className="flex h-full flex-col overflow-hidden border-r border-white/10 bg-surface"
    >
      {content}
    </motion.div>
  );
}
