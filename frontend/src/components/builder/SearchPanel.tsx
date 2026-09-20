// frontend/src/components/builder/SearchPanel.tsx
import { useState, useRef } from "react";
import { Search, X, Loader2, FileCode2 } from "lucide-react";
import { searchFiles, type SearchResult } from "@/lib/devserver";

interface SearchPanelProps {
  workspace?: string;
  localPath?: string;
  onSelectFile: (path: string) => void;
}

export default function SearchPanel({ workspace, localPath, onSelectFile }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const r = await searchFiles(value, workspace, localPath);
      setResults(r);
      setLoading(false);
    }, 400);
  }

  // Group results by file
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.file]) acc[r.file] = [];
    acc[r.file].push(r);
    return acc;
  }, {});

  return (
    <div className="flex h-full flex-col border-r border-white/10 bg-surface">
      <div className="border-b border-white/10 bg-white/5 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Busca</span>
      </div>
      <div className="shrink-0 px-2 py-2">
        <div className="flex items-center gap-1 rounded border border-white/10 bg-black/30 px-2">
          <Search className="h-3 w-3 shrink-0 text-slate-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Buscar no projeto…"
            className="flex-1 bg-transparent py-1 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 outline-none"
          />
          {query && (
            <button onClick={() => { setQuery(""); setResults([]); }} className="text-slate-500 hover:text-slate-100">
              <X className="h-3 w-3" />
            </button>
          )}
          {loading && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!query.trim() ? (
          <p className="p-4 text-center text-xs text-slate-600">Digite para buscar em arquivos .ts/.tsx/.css/.json</p>
        ) : results.length === 0 && !loading ? (
          <p className="p-4 text-center text-xs text-slate-500">Nenhum resultado para "{query}"</p>
        ) : (
          Object.entries(grouped).map(([file, fileResults]) => (
            <div key={file} className="border-b border-white/5">
              <button
                onClick={() => onSelectFile(file)}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-brand-400 hover:bg-white/5"
              >
                <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{file}</span>
                <span className="ml-auto shrink-0 text-[10px] text-slate-500">{fileResults.length}</span>
              </button>
              {fileResults.map((r, i) => (
                <button
                  key={i}
                  onClick={() => onSelectFile(r.file)}
                  className="flex w-full items-start gap-2 px-4 py-1 hover:bg-white/5"
                >
                  <span className="shrink-0 font-mono text-[10px] text-slate-500">{r.line}</span>
                  <span className="truncate text-left font-mono text-[10px] text-slate-400">{r.text}</span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
