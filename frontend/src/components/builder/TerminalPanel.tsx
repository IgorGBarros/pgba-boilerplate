// frontend/src/components/builder/TerminalPanel.tsx
import { useEffect, useRef, useState } from "react";
import { Terminal, AlertCircle, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import type { GenerateLogEvent } from "@/lib/devserver";
import { connectTerminalStream, runTerminalCommand } from "@/lib/devserver";

const STAGE_COLOR: Record<string, string> = {
  plan: "text-slate-300",
  write: "text-brand-500",
  validate: "text-amber-400",
  routes: "text-slate-300",
  done: "text-green-400",
  complete: "text-green-400",
  error: "text-red-400",
};

interface TerminalEntry {
  id: string;
  text: string;
  isCmd?: boolean;
  isError?: boolean;
}

interface TerminalPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  logs: GenerateLogEvent[];
  onClearLogs: () => void;
}

export default function TerminalPanel({ isOpen, onToggle, logs, onClearLogs }: TerminalPanelProps) {
  const errorCount = logs.filter((l) => l.stage === "error").length;
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<TerminalEntry[]>([]);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdIdx, setCmdIdx] = useState(-1);
  const [running, setRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, logs, isOpen]);

  function addEntry(text: string, isCmd = false, isError = false) {
    setHistory((prev) => [...prev, { id: crypto.randomUUID(), text, isCmd, isError }]);
  }

  async function runCmd(cmd: string) {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    addEntry(`$ ${trimmed}`, true);
    setCmdHistory((prev) => [trimmed, ...prev]);
    setCmdIdx(-1);
    setInput("");
    setRunning(true);
    const jobId = `term_${Date.now()}`;
    const stream = connectTerminalStream(jobId, (line, isError) => {
      addEntry(line, false, isError);
    });
    stream.addEventListener("message", () => {});
    try {
      await runTerminalCommand(trimmed, jobId);
    } catch (err) {
      addEntry(err instanceof Error ? err.message : "Erro ao executar comando", false, true);
    }
    setTimeout(() => {
      setRunning(false);
      stream.close();
    }, 5000);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      runCmd(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(cmdIdx + 1, cmdHistory.length - 1);
      setCmdIdx(next);
      setInput(cmdHistory[next] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(cmdIdx - 1, -1);
      setCmdIdx(next);
      setInput(next === -1 ? "" : (cmdHistory[next] ?? ""));
    }
  }

  function handleClear() {
    onClearLogs();
    setHistory([]);
  }

  return (
    <div className="flex flex-col border-t border-white/10 bg-surface">
      <div className="flex items-center justify-between border-b border-white/10 px-2">
        <button onClick={onToggle} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-100">
          <Terminal className="h-3.5 w-3.5" />
          Terminal
          {errorCount > 0 && <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[9px] font-bold text-red-400">{errorCount}</span>}
          {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </button>
        <button onClick={handleClear} className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-slate-100" title="Limpar">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {isOpen && (
        <div className="flex h-48 flex-col">
          <div className="flex-1 overflow-y-auto bg-black/40 p-2 font-mono text-xs">
            {/* Generate logs */}
            {logs.map((log, i) => (
              <div key={`log-${i}`} className={`flex items-start gap-1.5 py-0.5 ${STAGE_COLOR[log.stage] ?? "text-slate-300"}`}>
                {log.stage === "error" && <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />}
                <span className="text-slate-600">[{log.stage}]</span>
                <span className="whitespace-pre-wrap">{log.message}</span>
              </div>
            ))}
            {/* Interactive history */}
            {history.map((entry) => (
              <div
                key={entry.id}
                className={`py-0.5 whitespace-pre-wrap ${
                  entry.isCmd ? "text-cyan-400" : entry.isError ? "text-red-400" : "text-slate-300"
                }`}
              >
                {entry.text}
              </div>
            ))}
            {logs.length === 0 && history.length === 0 && (
              <p className="p-2 text-slate-600">Terminal pronto — digite um comando abaixo.</p>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input line */}
          <div
            className="flex items-center gap-1.5 border-t border-white/10 bg-black/60 px-2 py-1"
            onClick={() => inputRef.current?.focus()}
          >
            <span className="shrink-0 font-mono text-[11px] text-cyan-400">{running ? "…" : "$"}</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={running}
              spellCheck={false}
              className="flex-1 bg-transparent font-mono text-[11px] text-slate-200 outline-none disabled:opacity-50"
              placeholder={running ? "aguardando..." : "comando PowerShell / bash"}
            />
          </div>
        </div>
      )}
    </div>
  );
}
