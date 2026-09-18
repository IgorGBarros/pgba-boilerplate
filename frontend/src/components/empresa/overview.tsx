import { useState } from "react";
import {
  Activity,
  Brain,
  Building2,
  Code2,
  MessageSquare,
  PauseCircle,
  Receipt,
  ShoppingCart,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
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
import { Metric, StatusDot } from "@/components/empresa/shared";
import { AgentDialog, SectorDialog } from "@/components/empresa/detail-dialogs";
import { sectors, type Agent, type Sector } from "@/lib/pgba-data";
import { Database } from "lucide-react";

const sectorIcons = {
  commercial: Users,
  purchasing: ShoppingCart,
  finance: Receipt,
  dev: Code2,
  ops: Wrench,
} as const;

const orchestrator: Agent = {
  id: "orq",
  name: "Orquestrador-Geral",
  role: "CEO Virtual, AI Controller",
  status: "working",
  rag: true,
  model: "gpt-6-astra",
  skills:
    "# Orquestrador-Geral\n\n## Responsabilidades\n- Traduzir objetivos da empresa em tarefas por setor\n- Aprovar ou recusar solicitações conforme as políticas\n- Acompanhar custo e progresso de todos os projetos\n\n## Regras\n- Nunca publicar sem revisão humana.\n- Registrar toda decisão no painel de logs.\n",
};

export function Overview({ onNewTask }: { onNewTask: (sector?: string) => void }) {
  const [openSector, setOpenSector] = useState<Sector | null>(null);
  const [openAgent, setOpenAgent] = useState<Agent | null>(null);
  const [openCompany, setOpenCompany] = useState(false);

  const allAgents = sectors.flatMap((s) => s.agents);
  const working = allAgents.filter((a) => a.status === "working").length;
  const paused = allAgents.filter((a) => a.status === "paused").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2 text-xs text-success">
        <span className="size-2 rounded-full bg-success animate-pulse" />
        Tempo real conectado
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Agentes" value={String(allAgents.length)} icon={<Users className="size-4" />} />
        <Metric
          label="Trabalhando agora"
          value={String(working)}
          icon={<Activity className="size-4" />}
          tone="success"
        />
        <Metric
          label="Pausados"
          value={String(paused)}
          icon={<PauseCircle className="size-4" />}
          tone="warning"
        />
        <Metric label="Custo total" value="R$ 0,00" icon={<Wallet className="size-4" />} />
      </div>

      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={() => setOpenCompany(true)}
          className="panel w-full max-w-xl p-5 text-left transition-colors hover:border-primary"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-secondary text-muted-foreground">
              <Building2 className="size-5" />
            </span>
            <div>
              <p className="font-semibold">Empresa</p>
              <p className="text-sm text-muted-foreground">Visão estratégica</p>
            </div>
          </div>
        </button>

        <div className="h-6 w-px bg-border" />

        <button
          type="button"
          onClick={() => setOpenAgent(orchestrator)}
          className="panel glow-ring w-full max-w-xl p-5 text-left"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg gradient-primary text-primary-foreground">
              <Brain className="size-5" />
            </span>
            <div>
              <p className="font-semibold">Orquestrador-Geral</p>
              <p className="text-sm text-muted-foreground">CEO Virtual, AI Controller</p>
            </div>
          </div>
        </button>

        <div className="h-6 w-px bg-border" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sectors.map((sector) => {
          const Icon = sectorIcons[sector.icon];
          return (
            <div key={sector.id} className="panel flex flex-col">
              <button
                type="button"
                onClick={() => setOpenSector(sector)}
                className="flex items-center justify-between gap-2 border-b border-border p-4 text-left transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-2 font-semibold">
                  <Icon className="size-4 text-primary" />
                  {sector.name}
                </div>
                <Badge variant={sector.rag ? "default" : "secondary"} className="gap-1 text-[11px]">
                  <Database className="size-3" />
                  {sector.rag ? `${sector.docs} docs` : "sem RAG"}
                </Badge>
              </button>

              <div className="flex-1 space-y-2 p-4">
                {sector.agents.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum agente ainda.
                  </p>
                ) : (
                  sector.agents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setOpenAgent(agent)}
                      className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-elevated px-3 py-2 text-left transition-colors hover:border-primary"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <StatusDot status={agent.status} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{agent.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {agent.role} · {agent.model}
                          </p>
                        </div>
                      </div>
                      <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))
                )}
              </div>

              <div className="border-t border-border p-3">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => onNewTask(sector.name)}
                >
                  Criar tarefa para {sector.name}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <SectorDialog sector={openSector} onOpenChange={(v) => !v && setOpenSector(null)} />
      <AgentDialog agent={openAgent} onOpenChange={(v) => !v && setOpenAgent(null)} />

      <Dialog open={openCompany} onOpenChange={setOpenCompany}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Empresa</DialogTitle>
            <DialogDescription>
              Visão estratégica do motor principal e de todos os projetos derivados.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Setores</dt>
              <dd>{sectors.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Agentes</dt>
              <dd>{allAgents.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Motor principal</dt>
              <dd className="font-mono text-xs">pgba-core</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Template padrão</dt>
              <dd className="font-mono text-xs">workspace-template</dd>
            </div>
          </dl>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCompany(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
