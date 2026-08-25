// frontend/src/components/builder/ChatInput.tsx
import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
}

export default function ChatInput({ onSend, isLoading }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [value]);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="border-t border-white/10 bg-surface-raised p-3">
      <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-surface px-3 py-2 focus-within:border-brand-500/50">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Descreva o que você quer construir..."
          rows={1}
          className="max-h-40 flex-1 resize-none bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || isLoading}
          className="mb-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-white transition hover:bg-brand-700 disabled:opacity-30"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-slate-500">Enter para enviar · Shift+Enter para nova linha</p>
    </div>
  );
}
