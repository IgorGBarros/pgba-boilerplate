// frontend/src/components/builder/CodeViewer.tsx
import { useEffect, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Loader2, Pencil, Save, X } from "lucide-react";
import { fetchFileContent, saveFileContent } from "@/lib/devserver";
import { toast } from "sonner";

const LANG_MAP: Record<string, string> = {
  tsx: "typescript",
  ts: "typescript",
  jsx: "javascript",
  js: "javascript",
  css: "css",
  json: "json",
  md: "markdown",
};

interface CodeViewerProps {
  filePath: string;
  workspace?: string;
  localPath?: string;
}

export default function CodeViewer({ filePath, workspace, localPath }: CodeViewerProps) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const ext = filePath.split(".").pop() ?? "";
  const language = LANG_MAP[ext] ?? "plaintext";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCode(null);
    setEditing(false);

    fetchFileContent(filePath, workspace, localPath).then((text) => {
      if (!cancelled) {
        setCode(text);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [filePath, workspace, localPath]);

  function startEdit() {
    setDraft(code ?? "");
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    const result = await saveFileContent(filePath, draft, workspace, localPath);
    if (result.ok) {
      setCode(draft);
      setEditing(false);
      toast.success("Arquivo salvo");
    } else {
      toast.error(result.error ?? "Falha ao salvar o arquivo");
    }
    setSaving(false);
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
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-white/10 px-2 py-1">
        {editing ? (
          <>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium text-green-400 hover:bg-white/10 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Salvar
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-slate-400 hover:bg-white/10"
            >
              <X className="h-3 w-3" />
              Cancelar
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-600">duplo clique para editar</span>
            <button
              onClick={startEdit}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-slate-100"
            >
              <Pencil className="h-3 w-3" />
              Editar
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <style>{`
            .dracula-editor::selection { background: #44475a; }
            .dracula-editor::-moz-selection { background: #44475a; }
            .dracula-editor::-webkit-scrollbar { width: 8px; height: 8px; }
            .dracula-editor::-webkit-scrollbar-track { background: #282a36; }
            .dracula-editor::-webkit-scrollbar-thumb { background: #44475a; border-radius: 4px; }
            .dracula-editor::-webkit-scrollbar-thumb:hover { background: #6272a4; }
          `}</style>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="dracula-editor h-full w-full resize-none p-4 font-mono text-[13px] outline-none"
            style={{
              tabSize: 2,
              background: "#282a36",
              color: "#f8f8f2",
              caretColor: "#bd93f9",
              lineHeight: "1.65",
            }}
          />
        </div>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-auto cursor-text"
          onDoubleClick={startEdit}
          title="Duplo clique para editar"
        >
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            showLineNumbers
            customStyle={{ margin: 0, padding: "12px", fontSize: "12px", lineHeight: "1.5", background: "transparent", minHeight: "100%" }}
            lineNumberStyle={{ color: "#636d83", fontSize: "11px", paddingRight: "16px" }}
          >
            {code || ""}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}
