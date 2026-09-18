import { useEffect, useState } from "react";
import { FileText, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { aiModels } from "@/lib/pgba-data";
import { listDocuments, type Agent, type Sector, type KnowledgeDocument } from "@/lib/api";

export function SectorDialog({
  sector,
  onOpenChange,
}: {
  sector: Sector | null;
  onOpenChange: (v: boolean) => void;
}) {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);

  useEffect(() => {
    if (!sector?.knowledge_source) {
      setDocs([]);
      return;
    }
    listDocuments(sector.knowledge_source).then(setDocs).catch(console.error);
  }, [sector?.knowledge_source]);

  return (
    <Dialog open={!!sector} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{sector?.name}</DialogTitle>
          <DialogDescription>{sector?.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{sector?.agents_count ?? 0} agentes</Badge>
            <Badge variant={sector?.knowledge_source ? "default" : "secondary"}>
              {sector?.knowledge_source
                ? `RAG ativo · ${sector.knowledge_source_name}`
                : "sem RAG"}
            </Badge>
            {sector?.monthly_budget_usd && parseFloat(sector.monthly_budget_usd) > 0 && (
              <Badge variant="secondary">
                orçamento ${parseFloat(sector.monthly_budget_usd).toFixed(2)}/mês
              </Badge>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Documentos da base de conhecimento</p>
            <div className="max-h-60 space-y-2 overflow-y-auto rounded-md border border-border p-2">
              {docs.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  {sector?.knowledge_source
                    ? "Nenhum documento indexado."
                    : "Este setor não tem base de conhecimento configurada."}
                </p>
              ) : (
                docs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 rounded-md bg-elevated px-3 py-2"
                  >
                    <FileText className="size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{doc.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.metadata?.uploaded_filename ?? doc.source_name}
                      </p>
                    </div>
                    <Badge
                      variant={doc.status === "indexed" ? "default" : doc.status === "error" ? "destructive" : "secondary"}
                      className="text-[11px]"
                    >
                      {doc.status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-elevated px-4 py-4 text-sm text-muted-foreground transition-colors hover:border-primary">
            <Plus className="size-4" />
            Ir para Conhecimento para anexar documentos
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentDialog({
  agent,
  onOpenChange,
}: {
  agent: Agent | null;
  onOpenChange: (v: boolean) => void;
}) {
  const [model, setModel] = useState(aiModels[0]!);
  const [skills, setSkills] = useState("");
  const [role, setRole] = useState("");

  useEffect(() => {
    if (agent) {
      setRole(agent.role);
      setModel(aiModels[0]!);
      setSkills("");
    }
  }, [agent]);

  return (
    <Dialog open={!!agent} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{agent?.name}</DialogTitle>
          <DialogDescription>
            Ajuste o papel, o modelo de IA e as instruções do skills.md deste agente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Acesso</Label>
              <Input value={agent?.access_level ?? ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>Autonomia</Label>
              <Input value={agent?.autonomy_level ?? ""} disabled />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ag-role">Papel</Label>
              <Input id="ag-role" value={role} onChange={(e) => setRole(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Modelo de IA</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {aiModels.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ag-skills">skills.md</Label>
            <Textarea
              id="ag-skills"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              className="min-h-64 font-mono text-xs"
              placeholder="Instruções de skills do agente..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              toast.success("Configuração salva");
            }}
          >
            <Save className="size-4" />
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NodeDialog({
  open,
  onOpenChange,
  name: initialName,
  path: initialPath,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  path: string;
  onSave: (name: string, path: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [path, setPath] = useState(initialPath);

  useEffect(() => {
    setName(initialName);
    setPath(initialPath);
  }, [initialName, initialPath, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar item</DialogTitle>
          <DialogDescription>Altere o nome e o caminho do projeto ou pasta.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="node-name">Nome</Label>
            <Input id="node-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="node-path">Caminho</Label>
            <Input
              id="node-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onSave(name, path);
              onOpenChange(false);
              toast.success("Item atualizado");
            }}
          >
            <Save className="size-4" />
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
