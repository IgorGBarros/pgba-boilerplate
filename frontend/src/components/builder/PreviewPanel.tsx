// frontend/src/components/builder/PreviewPanel.tsx
import { useState, useCallback, useEffect, useRef } from "react";
import {
  GripVertical, RefreshCw, ExternalLink, PanelLeftClose, PanelLeftOpen,
  Lock, Search, SplitSquareHorizontal, LayoutPanelLeft,
} from "lucide-react";
import FileExplorer from "./FileExplorer";
import FileTabs from "./FileTabs";
import CodeViewer from "./CodeViewer";
import TerminalPanel from "./TerminalPanel";
import GitPanel from "./GitPanel";
import SearchPanel from "./SearchPanel";
import { listProjectFiles } from "@/lib/devserver";
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
  workspace?: string;
  localPath?: string;
  isTerminalOpen?: boolean;
  onToggleTerminal?: () => void;
  taskCommitMessage?: string;
}

// Heuristic: convert a file path to a preview route
function filePathToRoute(filePath: string): string | null {
  const match = filePath.match(/src\/pages\/(.+)\.(tsx?|jsx?)$/);
  if (!match) return null;
  const name = match[1]
    .replace(/\bindex$/i, "")
    .replace(/([A-Z])/g, (m) => `/${m.toLowerCase()}`)
    .replace(/^\//, "")
    .replace(/\/$/, "");
  if (!name) return "/";
  // PascalCase "GerarPage" → "/gerar"
  const clean = name.replace(/page$/i, "").replace(/\//g, "/");
  return "/" + clean;
}

export default function PreviewPanel({
  previewUrl,
  files: initialFiles,
  logs,
  onClearLogs,
  workspace,
  localPath,
  isTerminalOpen: isTerminalOpenProp,
  onToggleTerminal: onToggleTerminalProp,
  taskCommitMessage,
}: PreviewPanelProps) {
  const [showExplorer, setShowExplorer] = useState(true);
  const [explorerMode, setExplorerMode] = useState<"files" | "search">("files");
  const [showPreview, setShowPreview] = useState(true);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [isTerminalOpenInternal, setIsTerminalOpenInternal] = useState(true);
  const [isGitOpen, setIsGitOpen] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [splitView, setSplitView] = useState(false);
  const [activeFile2, setActiveFile2] = useState<string | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);
  const explorerDragging = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const [currentUrl, setCurrentUrl] = useState(previewUrl);
  const [editingUrl, setEditingUrl] = useState(false);
  const [draftUrl, setDraftUrl] = useState(previewUrl);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const isTerminalOpen = isTerminalOpenProp ?? isTerminalOpenInternal;
  const onToggleTerminal = onToggleTerminalProp ?? (() => setIsTerminalOpenInternal((v) => !v));

  useEffect(() => { setFiles(initialFiles); }, [initialFiles]);

  const refreshFiles = useCallback(async () => {
    const updated = await listProjectFiles(workspace, localPath);
    if (updated.length > 0) setFiles(updated);
  }, [workspace, localPath]);

  const handleSelectFile = useCallback((filePath: string) => {
    if (splitView && activeFile) {
      setActiveFile2(filePath);
    } else {
      setActiveFile(filePath);
    }
    setShowPreview(false);
    setOpenFiles((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
    // Navigate preview to the matching route
    const route = filePathToRoute(filePath);
    if (route && previewUrl) {
      try {
        const base = new URL(previewUrl);
        setCurrentUrl(`${base.origin}${route}`);
      } catch { /* ignore invalid URLs */ }
    }
  }, [splitView, activeFile, previewUrl]);

  const handleCloseFile = useCallback((filePath: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f !== filePath);
      if (activeFile === filePath) {
        if (next.length > 0) setActiveFile(next[next.length - 1]);
        else { setActiveFile(null); setShowPreview(true); }
      }
      if (activeFile2 === filePath) setActiveFile2(null);
      return next;
    });
  }, [activeFile, activeFile2]);

  useEffect(() => {
    if (logs.length > 0 && logs[logs.length - 1].stage === "done") {
      setIframeKey((k) => k + 1);
      refreshFiles();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs]);

  function handleRefresh() {
    setIsRefreshing(true);
    setIframeKey((k) => k + 1);
    setTimeout(() => setIsRefreshing(false), 500);
  }

  function startEditUrl() {
    setDraftUrl(currentUrl);
    setEditingUrl(true);
    setTimeout(() => urlInputRef.current?.select(), 0);
  }

  function commitUrl() {
    const trimmed = draftUrl.trim();
    if (trimmed) { setCurrentUrl(trimmed); setIframeKey((k) => k + 1); }
    setEditingUrl(false);
  }

  function startExplorerDrag() {
    explorerDragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!explorerDragging.current || !panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      setExplorerWidth(Math.max(120, Math.min(480, ev.clientX - rect.left)));
    };
    const onUp = () => {
      explorerDragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleUrlKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitUrl();
    else if (e.key === "Escape") setEditingUrl(false);
  }

  return (
    <div ref={panelRef} className="flex h-full flex-col border-l border-white/10 bg-surface">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-white/10 bg-surface-raised px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowExplorer(!showExplorer)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100"
            title={showExplorer ? "Fechar Explorer" : "Abrir Explorer"}
          >
            {showExplorer ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
          </button>
          {showExplorer && (
            <button
              onClick={() => setExplorerMode((m) => m === "search" ? "files" : "search")}
              className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/5 ${explorerMode === "search" ? "text-brand-400" : "text-slate-400 hover:text-slate-100"}`}
              title="Busca global"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => setSplitView((v) => !v)}
            className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/5 ${splitView ? "text-brand-400" : "text-slate-400 hover:text-slate-100"}`}
            title={splitView ? "Visão única" : "Split view"}
          >
            {splitView ? <LayoutPanelLeft className="h-3.5 w-3.5" /> : <SplitSquareHorizontal className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div
          className="mx-2 flex flex-1 cursor-text items-center gap-2 rounded-lg border border-white/10 bg-surface px-2 py-1"
          onClick={() => !editingUrl && startEditUrl()}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
          <Lock className="h-3 w-3 shrink-0 text-green-500" />
          {editingUrl ? (
            <input
              ref={urlInputRef}
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              onBlur={commitUrl}
              onKeyDown={handleUrlKey}
              className="flex-1 bg-transparent font-mono text-[11px] text-slate-200 outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="truncate font-mono text-[11px] text-slate-400">{currentUrl}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button onClick={handleRefresh} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100">
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
          <a href={currentUrl} target="_blank" rel="noopener noreferrer" className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Explorer / Search panel */}
        {showExplorer && (
          <>
            <div style={{ width: explorerWidth, minWidth: 120, maxWidth: 480 }} className="shrink-0 overflow-hidden">
              {explorerMode === "search" ? (
                <SearchPanel workspace={workspace} localPath={localPath} onSelectFile={handleSelectFile} />
              ) : (
                <FileExplorer
                  files={files}
                  activeFile={activeFile}
                  onSelectFile={handleSelectFile}
                  onRefreshFiles={refreshFiles}
                  workspace={workspace}
                  localPath={localPath}
                />
              )}
            </div>
            <div
              onMouseDown={startExplorerDrag}
              className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-white/5 hover:bg-white/15 group"
            >
              <GripVertical className="h-4 w-4 text-slate-700 group-hover:text-slate-500" />
            </div>
          </>
        )}

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <FileTabs
            openFiles={openFiles}
            activeFile={activeFile}
            onSelectFile={(path) => { setActiveFile(path); setShowPreview(false); }}
            onCloseFile={handleCloseFile}
            showPreview={showPreview}
            onSelectPreview={() => setShowPreview(true)}
          />

          <div className="relative flex flex-1 overflow-hidden">
            {showPreview ? (
              <iframe key={iframeKey} src={currentUrl} className="h-full w-full border-0 bg-white" title="Preview" />
            ) : splitView ? (
              <div className="flex flex-1 overflow-hidden">
                <div className="flex-1 overflow-hidden border-r border-white/10">
                  {activeFile ? (
                    <CodeViewer filePath={activeFile} workspace={workspace} localPath={localPath} />
                  ) : (
                    <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Selecione um arquivo</div>
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  {activeFile2 ? (
                    <CodeViewer filePath={activeFile2} workspace={workspace} localPath={localPath} />
                  ) : (
                    <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Clique em outro arquivo para split</div>
                  )}
                </div>
              </div>
            ) : activeFile ? (
              <CodeViewer filePath={activeFile} workspace={workspace} localPath={localPath} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
                Selecione um arquivo ou abra o Preview
              </div>
            )}
          </div>

          <TerminalPanel isOpen={isTerminalOpen} onToggle={onToggleTerminal} logs={logs} onClearLogs={onClearLogs} />
          <GitPanel
            isOpen={isGitOpen}
            onToggle={() => setIsGitOpen((v) => !v)}
            workspace={workspace}
            localPath={localPath}
            initialMessage={taskCommitMessage}
          />
        </div>
      </div>
    </div>
  );
}
