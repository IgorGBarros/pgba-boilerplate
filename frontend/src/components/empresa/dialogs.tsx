import { useState } from "react";
import { Github, Download, Plus } from "lucide-react";
import { toast } from "sonner";
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
import { sectors } from "@/lib/pgba-data";

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    toast.success(`Projeto "${name}" criado com repositório GitHub (protótipo)`);
    onOpenChange(false);
    setName("");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="size-5" />
            Novo projeto
          </DialogTitle>
          <DialogDescription>
            Cria uma pasta local e um repositório GitHub atomicamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="np-name">Nome do projeto</Label>
            <Input
              id="np-name"
              placeholder="meu-projeto"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="np-desc">Descrição (opcional)</Label>
            <Textarea
              id="np-desc"
              placeholder="Descreva o objetivo do projeto..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handle} disabled={!name.trim() || loading}>
            {loading ? "Criando..." : "Criar projeto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImportProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [repo, setRepo] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!repo.trim()) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    toast.success(`Repositório "${repo}" importado (protótipo)`);
    onOpenChange(false);
    setRepo("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="size-5" />
            Importar projeto
          </DialogTitle>
          <DialogDescription>
            Conecta um repositório GitHub existente ao motor principal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ip-repo">Repositório (org/nome)</Label>
            <Input
              id="ip-repo"
              placeholder="minha-org/meu-repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handle} disabled={!repo.trim() || loading}>
            {loading ? "Importando..." : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewTaskDialog({
  open,
  onOpenChange,
  sector: initialSector,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sector?: string;
}) {
  const [title, setTitle] = useState("");
  const [sector, setSector] = useState(initialSector ?? sectors[0]!.name);
  const [priority, setPriority] = useState<"alta" | "media" | "baixa">("media");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!title.trim()) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    setLoading(false);
    toast.success(`Tarefa criada para ${sector} (protótipo)`);
    onOpenChange(false);
    setTitle("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-5" />
            Nova tarefa
          </DialogTitle>
          <DialogDescription>
            Cria uma tarefa no helpdesk interno e a direciona a um setor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nt-title">Título</Label>
            <Input
              id="nt-title"
              placeholder="Descreva o que precisa ser feito..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Setor</Label>
              <Select value={sector} onValueChange={setSector}>
                <SelectTrigger>
                  <SelectValue />
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

            <div className="space-y-2">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="media">Média</SelectItem>
                  <SelectItem value="baixa">Baixa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handle} disabled={!title.trim() || loading}>
            {loading ? "Criando..." : "Criar tarefa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
