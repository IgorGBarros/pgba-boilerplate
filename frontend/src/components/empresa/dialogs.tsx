import { useEffect, useState } from "react";
import { FolderOpen, Github, Download, Plus } from "lucide-react";
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
  createAgencyProject as createProject,
  importProject,
  createTask,
  listAgents,
  listAgencyProjects as listProjects,
  listSectors,
  type Agent,
  type Project,
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
  const [step, setStep] = useState<"form" | "workspace">("form");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createWorkspace, setCreateWorkspace] = useState(false);
  const [workspacePath, setWorkspacePath] = useState("");
  const [loading, setLoading] = useState(false);

  const resetAndClose = () => {
    setStep("form");
    setName("");
    setDescription("");
    setCreateWorkspace(false);
    setWorkspacePath("");
    onOpenChange(false);
  };

  const handleFormNext = () => {
    if (!name.trim()) return;
    setStep("workspace");
  };

  const handle = async () => {
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
        workspace: createWorkspace ? workspacePath.trim() : "",
      });
      toast.success(`Projeto "${name}" criado`);
      resetAndClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar projeto");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); }}>
      <DialogContent>
        {step === "form" ? (
          <>
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
              <Button variant="outline" onClick={resetAndClose}>
                Cancelar
              </Button>
              <Button onClick={handleFormNext} disabled={!name.trim()}>
                Próximo
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderOpen className="size-5" />
                Diretório de trabalho local
              </DialogTitle>
              <DialogDescription>
                Os agentes só trabalharão dentro deste diretório. Deixe em branco para
                não restringir.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-md border border-border p-4">
                <input
                  type="checkbox"
                  id="np-create-ws"
                  checked={createWorkspace}
                  onChange={(e) => setCreateWorkspace(e.target.checked)}
                  className="size-4"
                />
                <label htmlFor="np-create-ws" className="cursor-pointer text-sm">
                  Criar pasta local para este projeto
                </label>
              </div>

              {createWorkspace && (
                <div className="space-y-2">
                  <Label htmlFor="np-ws-path">Caminho do diretório</Label>
                  <Input
                    id="np-ws-path"
                    placeholder="/home/usuario/projetos/meu-projeto"
                    value={workspacePath}
                    onChange={(e) => setWorkspacePath(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Caminho absoluto no sistema de arquivos local. O backend registrará
                    este diretório como workspace do projeto.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("form")}>
                Voltar
              </Button>
              <Button
                onClick={handle}
                disabled={loading || (createWorkspace && !workspacePath.trim())}
              >
                {loading ? "Criando..." : "Criar projeto"}
              </Button>
            </DialogFooter>
          </>
        )}
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [sectorId, setSectorId] = useState<string>("");
  const [agentId, setAgentId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("none");
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
    listProjects()
      .then((p) => setProjects(p.filter((x) => x.status === "ready")))
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
      await createTask({
        agentId: Number(agentId),
        brief: brief.trim(),
        projectId: projectId !== "none" ? Number(projectId) : undefined,
      });
      toast.success("Tarefa criada");
      onOpenChange(false);
      setBrief("");
      setProjectId("none");
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

        {projects.length > 0 && (
          <div className="space-y-2">
            <Label>Projeto (opcional)</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Nenhum" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

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
