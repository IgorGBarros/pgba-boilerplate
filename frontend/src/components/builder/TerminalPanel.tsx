// frontend/src/components/builder/TerminalPanel.tsx
import { Terminal, AlertCircle, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import type { GenerateLogEvent } from "@/lib/devserver";

const STAGE_COLOR: Record<string, string> = {
  plan: "text-slate-300",
  write: "text-brand-500",
  validate: "text-amber-400",
  routes: "text-slate-300",
  done: "text-green-400",
  complete: "text-green-400",
  error: "text-red-400",
};

interface TerminalPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  logs: GenerateLogEvent[];
  onClearLogs: () => void;
}

export default function TerminalPanel({ isOpen, onToggle, logs, onClearLogs }: TerminalPanelProps) {
  const errorCount = logs.filter((l) => l.stage === "error").length;

  return (
    <div className="flex flex-col border-t border-white/10 bg-surface">
      <div className="flex items-center justify-between border-b border-white/10 px-2">
        <button onClick={onToggle} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-100">
          <Terminal className="h-3.5 w-3.5" />
          Terminal
          {errorCount > 0 && <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[9px] font-bold text-red-400">{errorCount}</span>}
          {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </button>
        <button onClick={onClearLogs} className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-slate-100" title="Limpar">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {isOpen && (
        <div className="h-40 overflow-y-auto bg-black/40 p-2 font-mono text-xs">
          {logs.length === 0 ? (
            <p className="p-2 text-slate-600">Nenhum log ainda — envie uma mensagem no chat.</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`flex items-start gap-1.5 py-0.5 ${STAGE_COLOR[log.stage] ?? "text-slate-300"}`}>
                {log.stage === "error" && <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />}
                <span className="text-slate-600">[{log.stage}]</span>
                <span className="whitespace-pre-wrap">{log.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
