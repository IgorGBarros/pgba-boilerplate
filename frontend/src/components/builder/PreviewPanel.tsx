// frontend/src/components/builder/PreviewPanel.tsx
import { useState, useCallback, useEffect } from "react";
import { RefreshCw, ExternalLink, PanelLeftClose, PanelLeftOpen, Lock } from "lucide-react";
import FileExplorer from "./FileExplorer";
import FileTabs from "./FileTabs";
import CodeViewer from "./CodeViewer";
import TerminalPanel from "./TerminalPanel";
import type { GenerateLogEvent } from "@/lib/devserver";

interface ProjectFile {
  name: string;
  path: string;
  type: string;
}

interface PreviewPanelProps {
  previewUrl: string;
  files: ProjectFile[];
  logs: GenerateLogEvent[];
  onClearLogs: () => void;
}

export default function PreviewPanel({ previewUrl, files, logs, onClearLogs }: PreviewPanelProps) {
  const [showExplorer, setShowExplorer] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);

  const handleSelectFile = useCallback((path: string) => {
    setActiveFile(path);
    setShowPreview(false);
    setOpenFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }, []);

  const handleCloseFile = useCallback(
    (path: string) => {
      setOpenFiles((prev) => {
        const next = prev.filter((f) => f !== path);
        if (activeFile === path) {
          if (next.length > 0) {
            setActiveFile(next[next.length - 1]);
          } else {
            setActiveFile(null);
            setShowPreview(true);
          }
        }
        return next;
      });
    },
    [activeFile],
  );

  useEffect(() => {
    if (logs.length > 0 && logs[logs.length - 1].stage === "done") {
      setIframeKey((k) => k + 1);
    }
  }, [logs]);

  function handleRefresh() {
    setIsRefreshing(true);
    setIframeKey((k) => k + 1);
    setTimeout(() => setIsRefreshing(false), 500);
  }

  return (
    <div className="flex h-full flex-col border-l border-white/10 bg-surface">
      <div className="flex items-center justify-between border-b border-white/10 bg-surface-raised px-3 py-2">
        <button
          onClick={() => setShowExplorer(!showExplorer)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100"
          title={showExplorer ? "Fechar Explorer" : "Abrir Explorer"}
        >
          {showExplorer ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
        </button>

        <div className="mx-3 flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-surface px-2 py-1">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <Lock className="h-3 w-3 shrink-0 text-green-500" />
          <span className="truncate font-mono text-[11px] text-slate-400">{previewUrl}</span>
        </div>

        <button onClick={handleRefresh} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100">
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
        </button>
        <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {showExplorer && <FileExplorer files={files} activeFile={activeFile} onSelectFile={handleSelectFile} />}

        <div className="flex flex-1 flex-col overflow-hidden">
          <FileTabs
            openFiles={openFiles}
            activeFile={activeFile}
            onSelectFile={(path) => {
              setActiveFile(path);
              setShowPreview(false);
            }}
            onCloseFile={handleCloseFile}
            showPreview={showPreview}
            onSelectPreview={() => setShowPreview(true)}
          />

          <div className="relative flex flex-1 overflow-hidden">
            {showPreview ? (
              <iframe key={iframeKey} src={previewUrl} className="h-full w-full border-0 bg-white" title="Preview" />
            ) : activeFile ? (
              <CodeViewer filePath={activeFile} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Selecione um arquivo ou abra o Preview</div>
            )}
          </div>

          <TerminalPanel isOpen={isTerminalOpen} onToggle={() => setIsTerminalOpen(!isTerminalOpen)} logs={logs} onClearLogs={onClearLogs} />
        </div>
      </div>
    </div>
  );
}
