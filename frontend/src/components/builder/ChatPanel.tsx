// frontend/src/components/builder/ChatPanel.tsx
import { useRef, useEffect, useCallback } from "react";
import { Sparkles, Loader2, RotateCcw } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import ChatBubble from "./ChatBubble";
import ChatInput from "./ChatInput";
import type { ChatMessage } from "@/types/builder";

interface ChatPanelProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onSend: (content: string) => void;
  onReset: () => void;
}

export default function ChatPanel({ messages, isLoading, onSend, onReset }: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  return (
    <div className="flex h-full flex-col bg-surface-raised">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/15">
            <Sparkles className="h-4 w-4 text-brand-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Estúdio PGBA</h2>
            <p className="text-[10px] text-slate-500">Descreva e gere em tempo real</p>
          </div>
        </div>
        <button
          onClick={onReset}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
        >
          <RotateCcw className="h-3 w-3" />
          Limpar
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/10">
              <Sparkles className="h-7 w-7 text-brand-500" />
            </div>
            <h3 className="text-base font-semibold text-slate-100">O que vamos construir?</h3>
            <p className="max-w-[280px] text-xs text-slate-500">
              Descreva a página que você quer. Erros de tipo são detectados e corrigidos automaticamente antes de aparecer aqui.
            </p>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} />
          ))}
        </AnimatePresence>

        {isLoading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 px-4 py-3">
            <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
            <span className="text-xs text-slate-500">Gerando...</span>
          </motion.div>
        )}
      </div>

      <ChatInput onSend={onSend} isLoading={isLoading} />
    </div>
  );
}
