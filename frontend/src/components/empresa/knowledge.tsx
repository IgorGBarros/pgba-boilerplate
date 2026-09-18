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
import { knowledgeDocs, sectors } from "@/lib/pgba-data";

const typeIcon = {
  PDF: FileText,
  Documento: FileText,
  Imagem: FileImage,
  Planilha: FileSpreadsheet,
} as const;

export function Knowledge() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Conhecimento e RAG"
        description="Envie PDFs, imagens, documentos e planilhas para alimentar a base de cada setor."
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="panel space-y-4 p-5">
          <div>
            <p className="mb-2 text-sm font-medium">Setor de destino</p>
            <Select defaultValue={sectors[0]!.name}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha o setor" />
              </SelectTrigger>
              <SelectContent>
                {sectors.map((s) => (
                  <SelectItem key={s.id} value={s.name}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-elevated px-4 py-10 text-center transition-colors hover:border-primary">
            <UploadCloud className="size-6 text-primary" />
            <span className="text-sm font-medium">Arraste arquivos ou clique</span>
            <span className="text-xs text-muted-foreground">PDF, PNG, DOCX, XLSX até 20 MB</span>
            <input
              type="file"
              className="hidden"
              multiple
              onChange={() => toast.success("Arquivo enviado para indexação (protótipo)")}
            />
          </label>

          <Button
            className="w-full"
            onClick={() => toast.info("Reindexação da base iniciada (protótipo)")}
          >
            Reindexar base do setor
          </Button>
        </div>

        <div className="panel divide-y divide-border">
          {knowledgeDocs.map((doc) => {
            const Icon = typeIcon[doc.type];
            return (
              <div key={doc.id} className="flex items-center gap-3 p-4">
                <Icon className="size-5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.sector} · {doc.size}
                  </p>
                </div>
                <Badge variant={doc.indexed ? "default" : "secondary"} className="text-[11px]">
                  {doc.indexed ? "indexado" : "pendente"}
                </Badge>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
