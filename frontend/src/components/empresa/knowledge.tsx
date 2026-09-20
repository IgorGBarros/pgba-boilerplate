import { useEffect, useRef, useState } from "react";
import {
  Book,
  Bot,
  ChevronLeft,
  ChevronRight,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  UploadCloud,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listKnowledgeSources,
  listDocuments,
  uploadDocumentFile,
  syncKnowledgeSource,
  queryKnowledge,
  type KnowledgeSource,
  type KnowledgeDocument,
  type RagQueryResult,
} from "@/lib/api";

// ─── helpers ──────────────────────────────────────────────────────────────────

function docIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) return FileImage;
  if (["xls", "xlsx", "csv"].includes(ext)) return FileSpreadsheet;
  if (["md", "mdx"].includes(ext)) return FileCode2;
  return FileText;
}

function docStatusColor(status: string): string {
  if (status === "indexed") return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
  if (status === "error") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
}

// ─── types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: { document: string; source: string; excerpt?: string }[];
  loading?: boolean;
}

// ─── Sidebar: biblioteca de documentos ────────────────────────────────────────

function LibrarySidebar({
  sources,
  docs,
  selectedSource,
  onSelectSource,
  uploading,
  reindexing,
  onUpload,
  onReindex,
  fileInputRef,
}: {
  sources: KnowledgeSource[];
  docs: KnowledgeDocument[];
  selectedSource: string;
  onSelectSource: (v: string) => void;
  uploading: boolean;
  reindexing: boolean;
  onUpload: (files: FileList | null) => void;
  onReindex: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <aside className="flex h-full flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Book className="size-4 text-primary" />
        <span className="text-sm font-semibold">Biblioteca</span>
      </div>

      {/* Source selector */}
      <div className="border-b border-border px-3 py-3 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Fonte de conhecimento
        </p>
        {sources.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma fonte cadastrada.</p>
        ) : (
          <Select value={selectedSource} onValueChange={onSelectSource}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Escolha a fonte" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.id} value={String(s.id)} className="text-xs">
                  {s.name}
                  {s.source_type === "obsidian" && (
                    <span className="ml-1 text-[10px] text-violet-500">(Obsidian)</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Document list */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/60">
        {docs.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            Nenhum documento nesta fonte.
          </p>
        ) : (
          docs.map((doc) => {
            const filename = doc.metadata?.uploaded_filename ?? doc.title;
            const Icon = docIcon(filename);
            return (
              <div key={doc.id} className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-accent/40 transition-colors">
                <Icon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium leading-tight">{doc.title}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{doc.source_name}</p>
                </div>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${docStatusColor(doc.status)}`}>
                  {doc.status === "indexed" ? "✓" : doc.status === "error" ? "!" : "…"}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Upload + Reindex */}
      <div className="border-t border-border p-3 space-y-2">
        <label
          className={`flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs transition-colors hover:border-primary hover:bg-accent/30 ${
            !selectedSource || uploading ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <UploadCloud className="size-4 text-primary" />
          <span className="font-medium">
            {uploading ? "Enviando…" : "Adicionar arquivo"}
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground">PDF · MD · DOCX</span>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.md,.mdx,.docx,.txt,.png,.jpg,.xlsx,.csv"
            disabled={!selectedSource || uploading}
            onChange={(e) => onUpload(e.target.files)}
          />
        </label>

        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-xs gap-1.5"
          onClick={onReindex}
          disabled={!selectedSource || reindexing}
        >
          {reindexing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          {reindexing ? "Reindexando…" : "Reindexar fonte"}
        </Button>
      </div>
    </aside>
  );
}

// ─── Chat message bubble ───────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div
        className={`grid size-8 shrink-0 place-items-center rounded-full ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
        }`}
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>

      <div className={`flex-1 max-w-[80%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1.5`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-card border border-border rounded-tl-sm"
          }`}
        >
          {msg.loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>Consultando a base de conhecimento…</span>
            </div>
          ) : (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          )}
        </div>

        {/* Sources */}
        {!msg.loading && msg.sources && msg.sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {msg.sources.map((src, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground"
                title={src.source}
              >
                <FileText className="size-2.5" />
                {src.document.length > 30 ? src.document.slice(0, 30) + "…" : src.document}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Knowledge ────────────────────────────────────────────────────────────────

export function Knowledge() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null!);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Olá! Sou o assistente de conhecimento. Faça perguntas sobre os documentos indexados nesta base — PDF, Markdown, Obsidian, planilhas. Posso buscar e citar as fontes relevantes na resposta.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listKnowledgeSources()
      .then((s) => {
        setSources(s);
        if (s.length > 0) setSelectedSource(String(s[0]!.id));
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedSource) return;
    listDocuments(Number(selectedSource)).then(setDocs).catch(console.error);
  }, [selectedSource]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !selectedSource) return;
    setUploading(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      try {
        await uploadDocumentFile(Number(selectedSource), file);
        ok++;
      } catch (e: unknown) {
        toast.error(`Erro ao enviar ${file.name}: ${e instanceof Error ? e.message : "falha"}`);
      }
    }
    if (ok > 0) {
      toast.success(`${ok} arquivo(s) adicionado(s) à base`);
      listDocuments(Number(selectedSource)).then(setDocs).catch(console.error);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleReindex = async () => {
    if (!selectedSource) return;
    setReindexing(true);
    try {
      await syncKnowledgeSource(Number(selectedSource));
      toast.success("Reindexação enfileirada");
      setTimeout(() => {
        listDocuments(Number(selectedSource)).then(setDocs).catch(console.error);
      }, 2000);
    } catch (e: unknown) {
      toast.error(`Erro: ${e instanceof Error ? e.message : "falha"}`);
    } finally {
      setReindexing(false);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");

    const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", content: text };
    const loadingId = (Date.now() + 1).toString();
    const loadingMsg: ChatMessage = { id: loadingId, role: "assistant", content: "", loading: true };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setThinking(true);

    try {
      const result: RagQueryResult = await queryKnowledge(text, {
        topK: 5,
        generateAnswer: true,
      });

      const sources = result.sources.map((s) => ({
        document: s.document_title,
        source: s.source_name,
      }));

      const content =
        result.answer && !result.answer_error
          ? result.answer
          : result.sources.length > 0
          ? `Encontrei ${result.sources.length} trecho(s) relevante(s):\n\n${result.sources
              .slice(0, 3)
              .map((s, i) => `**[${i + 1}] ${s.document_title}**\n${s.content.slice(0, 300)}…`)
              .join("\n\n")}`
          : "Não encontrei informações sobre isso na base de conhecimento atual.";

      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? { id: loadingId, role: "assistant", content, sources }
            : m,
        ),
      );
    } catch (e: unknown) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? {
                id: loadingId,
                role: "assistant",
                content: `Erro ao consultar: ${e instanceof Error ? e.message : "falha"}`,
              }
            : m,
        ),
      );
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      {/* Sidebar */}
      <div
        className={`transition-all duration-200 ${
          sidebarOpen ? "w-72 min-w-[18rem]" : "w-0 overflow-hidden"
        }`}
      >
        {sidebarOpen && (
          <LibrarySidebar
            sources={sources}
            docs={docs}
            selectedSource={selectedSource}
            onSelectSource={setSelectedSource}
            uploading={uploading}
            reindexing={reindexing}
            onUpload={handleUpload}
            onReindex={handleReindex}
            fileInputRef={fileInputRef}
          />
        )}
      </div>

      {/* Toggle sidebar button */}
      <button
        onClick={() => setSidebarOpen((v) => !v)}
        className="relative z-10 flex w-5 shrink-0 items-center justify-center border-r border-border bg-card hover:bg-accent/50 transition-colors"
        title={sidebarOpen ? "Ocultar biblioteca" : "Mostrar biblioteca"}
      >
        {sidebarOpen ? (
          <ChevronLeft className="size-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 text-muted-foreground" />
        )}
      </button>

      {/* Chat area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-card/80 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-full bg-violet-100 dark:bg-violet-900/30">
              <Bot className="size-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-semibold">Chat de Conhecimento</p>
              <p className="text-[10px] text-muted-foreground">
                {docs.length} documento(s) indexado(s)
                {selectedSource && sources.find((s) => String(s.id) === selectedSource)
                  ? ` · ${sources.find((s) => String(s.id) === selectedSource)!.name}`
                  : ""}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => {
              setMessages([
                {
                  id: "welcome-" + Date.now(),
                  role: "assistant",
                  content: "Conversa reiniciada. Como posso ajudar?",
                },
              ]);
            }}
          >
            <Plus className="size-3" />
            Nova conversa
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-5 px-5 py-5">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border bg-card/80 px-4 py-3 backdrop-blur">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30 transition-all">
            <textarea
              className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground min-h-[2.5rem] max-h-[8rem]"
              placeholder="Pergunte algo sobre os documentos…"
              rows={1}
              value={input}
              disabled={thinking}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || thinking}
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40 hover:opacity-90"
            >
              {thinking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
            Enter para enviar · Shift+Enter para nova linha · respostas baseadas nos documentos indexados
          </p>
        </div>
      </div>
    </div>
  );
}
