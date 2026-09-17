// frontend/src/components/builder/KnowledgePanel.tsx
import { useEffect, useState } from "react";
import { UploadCloud, FileText, FileWarning, Loader2, Boxes } from "lucide-react";
import { listSectors, listDocuments, uploadDocumentFile, type Sector, type KnowledgeDocument, ApiError } from "@/lib/api";

const STATUS_LABEL: Record<KnowledgeDocument["status"], string> = {
  pending: "Aguardando indexação",
  processing: "Processando",
  indexed: "Indexado",
  error: "Erro",
};

const STATUS_COLOR: Record<KnowledgeDocument["status"], string> = {
  pending: "bg-yellow-500/15 text-yellow-400",
  processing: "bg-blue-500/15 text-blue-400",
  indexed: "bg-green-500/15 text-green-400",
  error: "bg-red-500/15 text-red-400",
};

/**
 * Upload de PDF/.txt/.md pro RAG de um setor — PDF e .txt/.md têm
 * extração de texto real (pypdf); qualquer outro tipo (imagem, .docx,
 * planilha) é registrado mas SEM extração automática ainda — isso
 * aparece como aviso claro depois do upload, nunca finge ter lido o
 * conteúdo.
 */
export default function KnowledgePanel() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [selectedSectorId, setSelectedSectorId] = useState<number | "">("");
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loadingSectors, setLoadingSectors] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastWarning, setLastWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSectors()
      .then((data) => {
        setSectors(data);
        setSelectedSectorId((prev) => (prev === "" ? data[0]?.id ?? "" : prev));
      })
      .catch(() => setError("Falha ao carregar setores."))
      .finally(() => setLoadingSectors(false));
  }, []);

  const selectedSector = sectors.find((s) => s.id === selectedSectorId) ?? null;
  const sourceId = selectedSector?.knowledge_source ?? null;

  async function refreshDocuments(source: number) {
    setLoadingDocs(true);
    try {
      const docs = await listDocuments(source);
      setDocuments(docs);
      setError(null);
    } catch {
      setError("Falha ao carregar documentos.");
    } finally {
      setLoadingDocs(false);
    }
  }

  useEffect(() => {
    if (sourceId) refreshDocuments(sourceId);
    else setDocuments([]);
  }, [sourceId]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || !sourceId) return;
    setUploading(true);
    setError(null);
    setLastWarning(null);
    try {
      for (const file of Array.from(files)) {
        const result = await uploadDocumentFile(sourceId, file);
        if (result.extraction_warning) setLastWarning(result.extraction_warning);
      }
      await refreshDocuments(sourceId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao enviar arquivo.");
    } finally {
      setUploading(false);
    }
  }

  if (loadingSectors) {
    return (
      <div className="space-y-2 p-6">
        {[0, 1].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-card border border-white/10 bg-surface-raised" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid h-full gap-4 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-4">
        <div>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Boxes className="h-4 w-4 text-slate-400" />
            Conhecimento e RAG
          </h2>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Setor de destino</label>
          <select
            value={selectedSectorId}
            onChange={(e) => setSelectedSectorId(Number(e.target.value))}
            className="w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {!sourceId ? (
          <p className="rounded-card border border-dashed border-white/10 p-4 text-xs text-slate-500">
            Este setor ainda não tem fonte de conhecimento configurada — rode <code className="text-slate-400">pgbasync</code> ou vincule
            uma fonte pra habilitar upload.
          </p>
        ) : (
          <label
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed border-white/10 px-4 py-10 text-center transition hover:border-brand-500 ${
              uploading ? "pointer-events-none opacity-50" : ""
            }`}
          >
            {uploading ? <Loader2 className="h-6 w-6 animate-spin text-brand-500" /> : <UploadCloud className="h-6 w-6 text-brand-500" />}
            <span className="text-sm font-medium text-slate-200">{uploading ? "Enviando..." : "Arraste arquivos ou clique"}</span>
            <span className="text-[11px] text-slate-500">PDF, .txt, .md têm extração real · outros tipos ficam sem indexação por enquanto</span>
            <input type="file" className="hidden" multiple disabled={uploading} onChange={(e) => handleFiles(e.target.files)} />
          </label>
        )}

        {lastWarning && (
          <p className="flex items-start gap-1.5 rounded-card border border-yellow-500/20 bg-yellow-500/10 p-3 text-[11px] text-yellow-400">
            <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {lastWarning}
          </p>
        )}
        {error && <p className="rounded-card border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">{error}</p>}
      </div>

      <div className="overflow-hidden rounded-card border border-white/10 bg-surface-raised">
        <div className="border-b border-white/10 px-4 py-2.5">
          <p className="text-xs font-semibold text-slate-300">
            Documentos {selectedSector ? `— ${selectedSector.name}` : ""} <span className="text-slate-500">({documents.length})</span>
          </p>
        </div>
        <div className="divide-y divide-white/5">
          {loadingDocs ? (
            <p className="p-6 text-center text-xs text-slate-500">Carregando...</p>
          ) : documents.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">Nenhum documento enviado ainda.</p>
          ) : (
            documents.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
                <FileText className="h-4 w-4 shrink-0 text-slate-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-200">{doc.title}</p>
                  {doc.metadata.extraction_warning && <p className="text-[10px] text-yellow-500">{doc.metadata.extraction_warning}</p>}
                  {doc.status === "error" && doc.error_message && <p className="text-[10px] text-red-400">{doc.error_message}</p>}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLOR[doc.status]}`}>
                  {STATUS_LABEL[doc.status]}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
