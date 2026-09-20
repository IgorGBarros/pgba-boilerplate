import { useEffect, useRef, useState } from "react";
import { FileImage, FileSpreadsheet, FileText, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionHeader } from "@/components/empresa/shared";
import {
  listKnowledgeSources,
  listDocuments,
  uploadDocumentFile,
  syncKnowledgeSource,
  type KnowledgeSource,
  type KnowledgeDocument,
} from "@/lib/api";

function docIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) return FileImage;
  if (["xls", "xlsx", "csv"].includes(ext)) return FileSpreadsheet;
  return FileText;
}

export function Knowledge() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    listDocuments(Number(selectedSource))
      .then(setDocs)
      .catch(console.error);
  }, [selectedSource]);

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
      toast.success(`${ok} arquivo(s) enviado(s) para indexação`);
      listDocuments(Number(selectedSource)).then(setDocs).catch(console.error);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const [reindexing, setReindexing] = useState(false);

  const handleReindex = async () => {
    if (!selectedSource) return;
    setReindexing(true);
    try {
      await syncKnowledgeSource(Number(selectedSource));
      toast.success("Reindexação enfileirada pelo backend");
      setTimeout(() => {
        listDocuments(Number(selectedSource)).then(setDocs).catch(console.error);
      }, 2000);
    } catch (e: unknown) {
      toast.error(`Erro ao reindexar: ${e instanceof Error ? e.message : "falha"}`);
    } finally {
      setReindexing(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Conhecimento e RAG"
        description="Envie PDFs, imagens, documentos e planilhas para alimentar a base de cada setor."
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="panel space-y-4 p-5">
          <div>
            <p className="mb-2 text-sm font-medium">Fonte de conhecimento</p>
            {sources.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma fonte cadastrada.</p>
            ) : (
              <Select value={selectedSource} onValueChange={setSelectedSource}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha a fonte" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-elevated px-4 py-10 text-center transition-colors hover:border-primary">
            <UploadCloud className="size-6 text-primary" />
            <span className="text-sm font-medium">
              {uploading ? "Enviando..." : "Arraste arquivos ou clique"}
            </span>
            <span className="text-xs text-muted-foreground">PDF, PNG, DOCX, XLSX até 20 MB</span>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              disabled={!selectedSource || uploading}
              onChange={(e) => handleUpload(e.target.files)}
            />
          </label>

          <Button className="w-full" onClick={handleReindex} disabled={!selectedSource || reindexing}>
            {reindexing ? "Enfileirando…" : "Reindexar base da fonte"}
          </Button>
        </div>

        <div className="panel divide-y divide-border">
          {docs.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhum documento nesta fonte.
            </p>
          ) : (
            docs.map((doc) => {
              const Icon = docIcon(doc.metadata?.uploaded_filename ?? doc.title);
              return (
                <div key={doc.id} className="flex items-center gap-3 p-4">
                  <Icon className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{doc.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.source_name}
                      {doc.metadata?.uploaded_filename
                        ? ` · ${doc.metadata.uploaded_filename}`
                        : ""}
                    </p>
                  </div>
                  <Badge
                    variant={doc.status === "indexed" ? "default" : doc.status === "error" ? "destructive" : "secondary"}
                    className="text-[11px]"
                  >
                    {doc.status}
                  </Badge>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
