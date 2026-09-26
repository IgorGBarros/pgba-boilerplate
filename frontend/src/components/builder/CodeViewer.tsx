// frontend/src/components/builder/CodeViewer.tsx
import { useEffect, useState, useRef, useCallback } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { Loader2, Save, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { fetchFileContent, saveFileContent, fetchFileHash } from "@/lib/devserver";
import { toast } from "sonner";
import { usePreferences } from "@/lib/ThemeContext";

function getExtensions(filePath: string) {
  const ext = filePath.split(".").pop() ?? "";
  if (ext === "tsx" || ext === "ts") return [javascript({ typescript: true, jsx: ext === "tsx" })];
  if (ext === "jsx" || ext === "js") return [javascript({ jsx: ext === "jsx" })];
  if (ext === "css") return [css()];
  if (ext === "json") return [json()];
  if (ext === "md") return [markdown()];
  return [];
}

interface CodeViewerProps {
  filePath: string;
  workspace?: string;
  localPath?: string;
  goToLine?: number;
  onDirtyChange?: (path: string, dirty: boolean) => void;
}

type SaveState = "idle" | "saving" | "saved" | "conflict";

export default function CodeViewer({ filePath, workspace, localPath, goToLine, onDirtyChange }: CodeViewerProps) {
  const [code, setCode] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isDirty, setIsDirty] = useState(false);
  const baseHashRef = useRef<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorViewRef = useRef<import("@codemirror/view").EditorView | null>(null);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const { prefs } = usePreferences();
  const extensions = prefs.wordWrap ? [...getExtensions(filePath), EditorView.lineWrapping] : getExtensions(filePath);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCode(null);
    setIsDirty(false);
    setSaveState("idle");

    Promise.all([
      fetchFileContent(filePath, workspace, localPath),
      fetchFileHash(filePath, workspace, localPath),
    ]).then(([text, hash]) => {
      if (cancelled) return;
      setCode(text);
      setDraft(text);
      baseHashRef.current = hash;
      setLoading(false);
    });

    return () => {
      cancelled = true;
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [filePath, workspace, localPath]);

  const doSave = useCallback(async (content: string) => {
    // Conflict check: compare current server hash with what we loaded
    const currentHash = await fetchFileHash(filePath, workspace, localPath);
    if (currentHash && baseHashRef.current && currentHash !== baseHashRef.current) {
      setSaveState("conflict");
      toast.error("Conflito: arquivo foi modificado externamente. Recarregue para ver as mudanças.");
      return;
    }
    setSaveState("saving");
    const result = await saveFileContent(filePath, content, workspace, localPath);
    if (result.ok) {
      setCode(content);
      setIsDirty(false);
      onDirtyChangeRef.current?.(filePath, false);
      setSaveState("saved");
      // Refresh hash after save
      fetchFileHash(filePath, workspace, localPath).then((h) => { baseHashRef.current = h; });
      toast.success("Arquivo salvo");
      setTimeout(() => setSaveState("idle"), 2000);
    } else {
      setSaveState("idle");
      toast.error(result.error ?? "Falha ao salvar o arquivo");
    }
  }, [filePath, workspace, localPath]);

  useEffect(() => {
    if (goToLine == null || !editorViewRef.current) return;
    const view = editorViewRef.current;
    const line = view.state.doc.line(Math.min(goToLine, view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
  }, [goToLine]);

  const handleChange = useCallback((value: string) => {
    const dirty = value !== code;
    setDraft(value);
    setIsDirty(dirty);
    onDirtyChangeRef.current?.(filePath, dirty);
    setSaveState("idle");
    // Autosave debounce: 1500ms after last keystroke
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      doSave(value);
    }, 1500);
  }, [code, doSave]);

  function handleManualSave() {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    doSave(draft);
  }

  function handleDiscard() {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setDraft(code ?? "");
    setIsDirty(false);
    setSaveState("idle");
  }

  if (loading) {
    return (
      <div className="flex flex-1 min-w-0 min-h-0 items-center justify-center bg-[#282c34]">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-w-0 min-h-0 bg-[#282c34]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-2 py-1">
        <span className="truncate font-mono text-[10px] text-slate-500">{filePath}</span>
        <div className="flex items-center gap-1 shrink-0">
          {saveState === "saving" && (
            <span className="flex items-center gap-1 text-[10px] text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" /> salvando…
            </span>
          )}
          {saveState === "saved" && (
            <span className="flex items-center gap-1 text-[10px] text-green-400">
              <CheckCircle2 className="h-3 w-3" /> salvo
            </span>
          )}
          {saveState === "conflict" && (
            <span className="flex items-center gap-1 text-[10px] text-red-400">
              <AlertTriangle className="h-3 w-3" /> conflito
            </span>
          )}
          {isDirty && saveState !== "saving" && saveState !== "conflict" && (
            <>
              <button
                onClick={handleManualSave}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium text-green-400 hover:bg-white/10"
              >
                <Save className="h-3 w-3" /> Salvar
              </button>
              <button
                onClick={handleDiscard}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-slate-400 hover:bg-white/10"
              >
                <X className="h-3 w-3" /> Descartar
              </button>
            </>
          )}
          {!isDirty && saveState === "idle" && (
            <span className="text-[10px] text-slate-600">autosave ativo</span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <CodeMirror
          value={draft}
          extensions={extensions}
          theme={oneDark}
          onChange={handleChange}
          onCreateEditor={(view) => { editorViewRef.current = view; }}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLineGutter: true,
            highlightActiveLine: true,
            autocompletion: true,
            bracketMatching: true,
            indentOnInput: true,
            tabSize: 2,
          }}
          style={{ fontSize: `${prefs.editorFontSize}px`, minHeight: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}
