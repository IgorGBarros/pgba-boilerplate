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
import { aiModels, knowledgeDocs, type Agent, type Sector } from "@/lib/pgba-data";

export function SectorDialog({
  sector,
  onOpenChange,
}: {
  sector: Sector | null;
  onOpenChange: (v: boolean) => void;
}) {
  const docs = knowledgeDocs.filter((d) => d.sector === sector?.name);

  return (
    <Dialog open={!!sector} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{sector?.name}</DialogTitle>
          <DialogDescription>{sector?.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{sector?.agents.length ?? 0} agentes</Badge>
            <Badge variant={sector?.rag ? "default" : "secondary"}>
              {sector?.rag ? `RAG ativo · ${sector.docs} docs` : "sem RAG"}
            </Badge>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Documentos anexados</p>
            <div className="max-h-60 space-y-2 overflow-y-auto rounded-md border border-border p-2">
              {docs.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  Nenhum documento anexado a este setor.
                </p>
              ) : (
                docs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 rounded-md bg-elevated px-3 py-2"
                  >
                    <FileText className="size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{doc.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.type} · {doc.size}
                      </p>
                    </div>
                    <Badge variant={doc.indexed ? "default" : "secondary"} className="text-[11px]">
                      {doc.indexed ? "indexado" : "pendente"}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-elevated px-4 py-4 text-sm text-muted-foreground transition-colors hover:border-primary">
            <Plus className="size-4" />
            Anexar documento ao setor
            <input
              type="file"
              className="hidden"
              multiple
              onChange={() => toast.success("Documento anexado ao setor (protótipo)")}
            />
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
  const [model, setModel] = useState(agent?.model ?? aiModels[0]!);
  const [skills, setSkills] = useState(agent?.skills ?? "");
  const [role, setRole] = useState(agent?.role ?? "");

  useEffect(() => {
    if (agent) {
      setModel(agent.model);
      setSkills(agent.skills);
      setRole(agent.role);
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
              toast.success("Agente atualizado (protótipo)");
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
  name,
  path,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  path: string;
  onSave: (name: string, path: string) => void;
}) {
  const [nextName, setNextName] = useState(name);
  const [nextPath, setNextPath] = useState(path);

  useEffect(() => {
    setNextName(name);
    setNextPath(path);
  }, [name, path, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar item da árvore</DialogTitle>
          <DialogDescription>Renomeie a pasta ou o projeto e ajuste o caminho.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ed-name">Nome</Label>
            <Input id="ed-name" value={nextName} onChange={(e) => setNextName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ed-path">Caminho</Label>
            <Input
              id="ed-path"
              value={nextPath}
              onChange={(e) => setNextPath(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onSave(nextName, nextPath);
              onOpenChange(false);
              toast.success("Item atualizado");
            }}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
