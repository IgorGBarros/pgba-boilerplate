// frontend/src/components/builder/GitPanel.tsx
import { useEffect, useRef, useState } from "react";
import {
  GitBranch, RefreshCw, ChevronDown, ChevronUp, GitCommit, Loader2,
  Undo2, GitGraph, FileDiff,
} from "lucide-react";
import {
  fetchGitStatus, gitCommit, connectTerminalStream, fetchGitDiff, fetchGitLog,
  gitRevert, type GitFileStatus, type GitCommit as GitCommitType,
} from "@/lib/devserver";
import { toast } from "sonner";

type Tab = "stage" | "diff" | "log";

interface GitPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  workspace?: string;
  localPath?: string;
  initialMessage?: string;
}

export default function GitPanel({ isOpen, onToggle, workspace, localPath, initialMessage }: GitPanelProps) {
  const [tab, setTab] = useState<Tab>("stage");
  const [files, setFiles] = useState<GitFileStatus[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState(initialMessage ?? "");
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | undefined>();
  const [commits, setCommits] = useState<GitCommitType[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialMessage) setMessage(initialMessage);
  }, [initialMessage]);

  async function refresh() {
    setLoading(true);
    const result = await fetchGitStatus(workspace, localPath);
    setFiles(result);
    setSelected(new Set(result.map((f) => f.path)));
    setLoading(false);
  }

  async function loadDiff(file?: string) {
    setDiffLoading(true);
    setSelectedDiffFile(file);
    const d = await fetchGitDiff(file, workspace, localPath);
    setDiff(d);
    setDiffLoading(false);
  }

  async function loadLog() {
    setLogLoading(true);
    const log = await fetchGitLog(workspace, localPath);
    setCommits(log);
    setLogLoading(false);
  }

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, workspace, localPath]);

  useEffect(() => {
    if (isOpen && tab === "diff") loadDiff(selectedDiffFile);
    if (isOpen && tab === "log") loadLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isOpen]);

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output, isOpen]);

  function toggleFile(p: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === files.length) setSelected(new Set());
    else setSelected(new Set(files.map((f) => f.path)));
  }

  async function handleCommit() {
    if (!message.trim()) return;
    setCommitting(true);
    setOutput([]);
    const jobId = `git_${Date.now()}`;
    const stream = connectTerminalStream(jobId, (line) => {
      setOutput((prev) => [...prev, line]);
    });
    try {
      await gitCommit({ files: selected.size > 0 ? [...selected] : undefined, message: message.trim(), jobId, workspace, localPath });
    } catch (err) {
      setOutput((prev) => [...prev, err instanceof Error ? err.message : "Erro ao commitar"]);
    }
    setTimeout(async () => {
      setCommitting(false);
      stream.close();
      setMessage("");
      await refresh();
    }, 5000);
  }

  async function handleRevert(file: string) {
    const ok = confirm(`Descartar mudanças em "${file}"? Esta ação não pode ser desfeita.`);
    if (!ok) return;
    const result = await gitRevert(file, workspace, localPath);
    if (result.ok) {
      toast.success(`Mudanças em "${file}" descartadas`);
      await refresh();
      if (tab === "diff") loadDiff(selectedDiffFile);
    } else {
      toast.error(result.error ?? "Erro ao reverter arquivo");
    }
  }

  const statusLabel: Record<string, string> = { M: "modificado", A: "adicionado", D: "removido", R: "renomeado", "?": "novo", "??": "não rastreado" };
  const statusColor: Record<string, string> = { M: "text-amber-400", A: "text-green-400", D: "text-red-400", R: "text-blue-400", "?": "text-slate-400", "??": "text-slate-400" };

  function renderDiff(raw: string) {
    if (!raw) return <p className="p-3 text-center text-xs text-slate-500">Sem diferenças para mostrar.</p>;
    return (
      <div className="font-mono text-[11px]">
        {raw.split("\n").map((line, i) => {
          const cls = line.startsWith("+") && !line.startsWith("+++")
            ? "bg-green-900/30 text-green-300"
            : line.startsWith("-") && !line.startsWith("---")
            ? "bg-red-900/30 text-red-300"
            : line.startsWith("@@")
            ? "text-blue-400"
            : line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")
            ? "text-slate-500"
            : "text-slate-300";
          return <div key={i} className={`px-2 py-0 leading-5 ${cls}`}>{line || " "}</div>;
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col border-t border-white/10 bg-surface">
      <div className="flex items-center justify-between border-b border-white/10 px-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-100"
        >
          <GitBranch className="h-3.5 w-3.5" />
          Git
          {files.length > 0 && (
            <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-400">
              {files.length}
            </span>
          )}
          {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </button>
        {isOpen && (
          <div className="flex items-center gap-1">
            <button
              onClick={refresh}
              disabled={loading}
              className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-slate-100 disabled:opacity-40"
              title="Atualizar status"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        )}
      </div>

      {isOpen && (
        <div className="flex h-72 flex-col">
          {/* Tabs */}
          <div className="flex shrink-0 border-b border-white/10">
            {([
              { id: "stage", label: "Stage", icon: GitCommit },
              { id: "diff", label: "Diff", icon: FileDiff },
              { id: "log", label: "Log", icon: GitGraph },
            ] as { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1 px-3 py-1.5 text-[11px] transition ${
                  tab === id ? "border-b-2 border-brand-500 text-brand-400" : "text-slate-500 hover:text-slate-100"
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>

          {/* Stage tab */}
          {tab === "stage" && (
            <>
              <div className="flex-1 overflow-y-auto">
                {files.length === 0 && !loading ? (
                  <p className="p-3 text-center text-xs text-slate-500">Sem arquivos modificados no repositório.</p>
                ) : (
                  <>
                    {files.length > 0 && (
                      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
                        <input type="checkbox" checked={selected.size === files.length} onChange={toggleAll} className="h-3 w-3 accent-brand-500" />
                        <span className="text-[10px] text-slate-500">{selected.size} de {files.length} selecionado{files.length !== 1 ? "s" : ""}</span>
                      </div>
                    )}
                    {files.map((f) => {
                      const code = f.status.replace(/\s/g, "") || "M";
                      const colorClass = statusColor[code[0]] ?? "text-slate-400";
                      return (
                        <div key={f.path} className="group flex items-center gap-2 px-3 py-1 hover:bg-white/5">
                          <input type="checkbox" checked={selected.has(f.path)} onChange={() => toggleFile(f.path)} className="h-3 w-3 accent-brand-500" />
                          <span className={`w-16 shrink-0 font-mono text-[10px] ${colorClass}`}>{statusLabel[code] ?? code}</span>
                          <span
                            className="flex-1 truncate cursor-pointer font-mono text-[11px] text-slate-300 hover:text-white"
                            onClick={() => { setTab("diff"); loadDiff(f.path); }}
                            title="Ver diff"
                          >
                            {f.path}
                          </span>
                          <button
                            onClick={() => handleRevert(f.path)}
                            className="hidden group-hover:flex h-5 w-5 items-center justify-center rounded text-red-400 hover:bg-red-400/10"
                            title="Descartar mudanças"
                          >
                            <Undo2 className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {output.length > 0 && (
                <div className="max-h-20 overflow-y-auto border-t border-white/5 bg-black/40 px-3 py-1 font-mono text-[10px] text-slate-300">
                  {output.map((line, i) => <div key={i}>{line}</div>)}
                  <div ref={bottomRef} />
                </div>
              )}

              <div className="shrink-0 border-t border-white/10 bg-black/20 px-3 py-2">
                <div className="flex gap-2">
                  <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !committing) handleCommit(); }}
                    placeholder="Mensagem do commit…"
                    disabled={committing}
                    className="flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 outline-none focus:border-brand-500/50 disabled:opacity-50"
                  />
                  <button
                    onClick={handleCommit}
                    disabled={committing || !message.trim() || selected.size === 0}
                    className="flex shrink-0 items-center gap-1.5 rounded bg-brand-500/20 px-3 py-1 text-[11px] font-medium text-brand-400 hover:bg-brand-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {committing ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCommit className="h-3 w-3" />}
                    Commit & Push
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Diff tab */}
          {tab === "diff" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/5 px-2 py-1">
                <button
                  onClick={() => loadDiff(undefined)}
                  className={`shrink-0 rounded px-2 py-0.5 text-[10px] ${!selectedDiffFile ? "bg-brand-500/20 text-brand-400" : "text-slate-400 hover:bg-white/5"}`}
                >
                  todos
                </button>
                {files.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => loadDiff(f.path)}
                    className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] ${selectedDiffFile === f.path ? "bg-brand-500/20 text-brand-400" : "text-slate-400 hover:bg-white/5"}`}
                  >
                    {f.path.split("/").pop()}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-auto">
                {diffLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                  </div>
                ) : renderDiff(diff)}
              </div>
            </div>
          )}

          {/* Log tab */}
          {tab === "log" && (
            <div className="flex-1 overflow-y-auto">
              {logLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                </div>
              ) : commits.length === 0 ? (
                <p className="p-3 text-center text-xs text-slate-500">Nenhum commit encontrado.</p>
              ) : (
                commits.map((c) => (
                  <div key={c.hash} className="group flex items-start gap-2 border-b border-white/5 px-3 py-2 hover:bg-white/5">
                    <span className="shrink-0 font-mono text-[10px] text-slate-500">{c.short}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] text-slate-200">{c.subject}</p>
                      <p className="text-[10px] text-slate-500">{c.author} · {c.date.slice(0, 10)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
