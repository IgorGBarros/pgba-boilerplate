import { useEffect, useState } from "react";
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
import {
  createProject,
  importProject,
  createTask,
  listAgents,
  listSectors,
  type Agent,
  type Sector,
} from "@/lib/api";

/** Returns the first CEO/general-orchestrator agent, or null. */
async function findOrchestratorAgent(): Promise<Agent | null> {
  const agents = await listAgents();
  return (
    agents.find(
      (a) => a.access_level === "ceo" || a.access_level === "general_orchestrator",
    ) ?? null
  );
}

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
    try {
      const agent = await findOrchestratorAgent();
      if (!agent) {
        toast.error("Nenhum agente CEO ou Orquestrador-Geral encontrado");
        return;
      }
      await createProject({
        requestingAgentId: agent.id,
        name: name.trim(),
        description: description.trim(),
      });
      toast.success(`Projeto "${name}" criado`);
      onOpenChange(false);
      setName("");
      setDescription("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar projeto");
    } finally {
      setLoading(false);
    }
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
            Cria um repositório GitHub via o agente Orquestrador-Geral.
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
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!repo.trim()) return;
    setLoading(true);
    try {
      const agent = await findOrchestratorAgent();
      if (!agent) {
        toast.error("Nenhum agente CEO ou Orquestrador-Geral encontrado");
        return;
      }
      const nameFallback = projectName.trim() || repo.trim().split("/").pop() || repo.trim();
      await importProject({
        requestingAgentId: agent.id,
        name: nameFallback,
        githubFullName: repo.trim(),
      });
      toast.success(`Repositório "${repo}" importado`);
      onOpenChange(false);
      setRepo("");
      setProjectName("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao importar repositório");
    } finally {
      setLoading(false);
    }
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
          <div className="space-y-2">
            <Label htmlFor="ip-name">Nome exibido (opcional)</Label>
            <Input
              id="ip-name"
              placeholder="Deixe em branco para usar o nome do repositório"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
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
  sector: initialSectorName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sector?: string;
}) {
  const [brief, setBrief] = useState("");
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sectorId, setSectorId] = useState<string>("");
  const [agentId, setAgentId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    listSectors()
      .then((s) => {
        setSectors(s);
        if (s.length > 0) {
          const match = initialSectorName
            ? s.find((x) => x.name === initialSectorName)
            : undefined;
          setSectorId(String(match?.id ?? s[0]!.id));
        }
      })
      .catch(console.error);
  }, [open, initialSectorName]);

  useEffect(() => {
    if (!sectorId) return;
    listAgents(Number(sectorId))
      .then((a) => {
        setAgents(a);
        if (a.length > 0) setAgentId(String(a[0]!.id));
        else setAgentId("");
      })
      .catch(console.error);
  }, [sectorId]);

  const handle = async () => {
    if (!brief.trim() || !agentId) return;
    setLoading(true);
    try {
      await createTask({ agentId: Number(agentId), brief: brief.trim() });
      toast.success("Tarefa criada");
      onOpenChange(false);
      setBrief("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar tarefa");
    } finally {
      setLoading(false);
    }
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
            Cria uma tarefa no helpdesk interno e a direciona a um agente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nt-brief">Descrição</Label>
            <Input
              id="nt-brief"
              placeholder="Descreva o que precisa ser feito..."
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Setor</Label>
              <Select value={sectorId} onValueChange={setSectorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o setor" />
                </SelectTrigger>
                <SelectContent>
                  {sectors.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Agente</Label>
              <Select value={agentId} onValueChange={setAgentId} disabled={agents.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={agents.length === 0 ? "Sem agentes" : "Escolha"} />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handle} disabled={!brief.trim() || !agentId || loading}>
            {loading ? "Criando..." : "Criar tarefa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
