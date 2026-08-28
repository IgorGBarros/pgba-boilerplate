// frontend/src/components/builder/ChatBubble.tsx
import { forwardRef } from "react";
import { motion } from "framer-motion";
import { User, Bot, AlertTriangle, Hammer, ListTodo } from "lucide-react";
import type { ChatMessage } from "@/types/builder";

const iconMap = { user: User, assistant: Bot, error: AlertTriangle, fix: Hammer, plan: ListTodo };
const labelMap = { user: "Você", assistant: "Assistente", error: "Erro", fix: "Autocorreção", plan: "Plano" };

// `forwardRef` é obrigatório aqui: o `AnimatePresence` do ChatPanel usa
// `mode="popLayout"`, que precisa anexar um ref no filho direto (este
// componente) pra medir a saída durante a animação — sem isso o React
// avisa "Function components cannot be given refs" e a medição falha
// silenciosamente.
const ChatBubble = forwardRef<HTMLDivElement, { message: ChatMessage }>(function ChatBubble({ message }, ref) {
  const Icon = iconMap[message.type] ?? Bot;
  const isUser = message.type === "user";
  const isError = message.type === "error";
  const isFix = message.type === "fix";
  const isPlan = message.type === "plan";

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex gap-3 px-4 py-3 ${isUser ? "bg-white/5" : "bg-transparent"}`}
    >
      <div
        className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          isError
            ? "bg-red-500/15 text-red-400"
            : isFix
              ? "bg-amber-500/15 text-amber-400"
              : isPlan
                ? "bg-purple-500/15 text-purple-400"
                : isUser
                  ? "bg-white/10 text-slate-200"
                  : "bg-brand-500/15 text-brand-500"
        }`}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-semibold ${
              isError ? "text-red-400" : isFix ? "text-amber-400" : isPlan ? "text-purple-400" : isUser ? "text-slate-400" : "text-brand-500"
            }`}
          >
            {labelMap[message.type] ?? "Sistema"}
          </span>
          <span className="text-[10px] text-slate-500">
            {message.timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
          {message.fileName && (
            <span className="max-w-[180px] truncate rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              {message.fileName}
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{message.content}</p>
      </div>
    </motion.div>
  );
});

export default ChatBubble;