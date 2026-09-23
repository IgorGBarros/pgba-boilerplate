import { useState, useEffect } from "react";
import { ArrowLeft, Code2, GitPullRequest, CheckCircle2, Clock, AlertCircle, Play, XCircle, GitBranch, Package, Zap, BarChart3, Users, Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type Sprint,
  type SprintTask,
  type PullRequestDev,
  type Pipeline,
  listSprints,
  listSprintTasks,
  listPullRequests,
  listPipelines,
} from "@/lib/api";

interface DesenvolvimentoViewProps {
  onBack: () => void;
}

type TaskStatus = SprintTask["status"];

function TipoBadge({ tipo }: { tipo: SprintTask["tipo"] }) {
  if (tipo === "bug") return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">bug</Badge>;
  if (tipo === "feature") return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">feat</Badge>;
  return <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-[10px]">chore</Badge>;
}

function PrioridadeDot({ p }: { p: SprintTask["prioridade"] }) {
  const colors: Record<SprintTask["prioridade"], string> = { alta: "bg-red-500", media: "bg-yellow-400", baixa: "bg-green-500" };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[p]} mr-1.5`} />;
}

function PipelineIcon({ status }: { status: Pipeline["status"] }) {
  if (status === "success") return <CheckCircle2 className="w-4 h-4 text-green-400" />;
  if (status === "running") return <Play className="w-4 h-4 text-blue-400 animate-pulse" />;
  if (status === "failed") return <XCircle className="w-4 h-4 text-red-400" />;
  return <Clock className="w-4 h-4 text-zinc-400" />;
}

function PRStatusBadge({ status }: { status: PullRequestDev["status"] }) {
  if (status === "merged") return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">merged</Badge>;
  if (status === "review") return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">em revisão</Badge>;
  if (status === "open") return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">aberto</Badge>;
  return <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30">{status}</Badge>;
}

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "em_dev", label: "Em Dev" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

function TabSprint({ sprints, tarefas }: { sprints: Sprint[]; tarefas: SprintTask[] }) {
  const sprint = sprints[0];

  if (!sprint) {
    return <div className="text-center py-12 text-zinc-500">Nenhuma sprint cadastrada</div>;
  }

  const pct = sprint.pontos_totais > 0
    ? Math.round((sprint.pontos_concluidos / sprint.pontos_totais) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Sprint header */}
      <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10">
        <div>
          <p className="font-semibold text-white">
            {sprint.nome} · {sprint.status === "ativo" ? <span className="text-green-400">Ativo</span> : sprint.status}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">{sprint.data_inicio} → {sprint.data_fim}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-zinc-300">{sprint.pontos_concluidos} / {sprint.pontos_totais} pts</p>
          <div className="mt-1 w-40 h-2 rounded-full bg-white/10">
            <div className="h-2 rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">{pct}% concluído</p>
        </div>
      </div>

      {/* Kanban */}
      <div className="grid grid-cols-4 gap-3">
        {COLUMNS.map(col => {
          const items = tarefas.filter(t => t.status === col.key);
          return (
            <div key={col.key} className="rounded-lg bg-white/5 border border-white/10 p-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">{col.label}</span>
                <Badge className="bg-white/10 text-zinc-300 text-[10px]">{items.length}</Badge>
              </div>
              <div className="space-y-2">
                {items.map(t => (
                  <div key={t.id} className="p-2 rounded bg-white/5 border border-white/10 hover:border-white/20 cursor-pointer transition-colors">
                    <div className="flex items-start justify-between gap-1 mb-1.5">
                      <TipoBadge tipo={t.tipo} />
                      <span className="text-[10px] text-zinc-500">#{t.id}</span>
                    </div>
                    <p className="text-xs text-zinc-200 leading-tight">{t.titulo}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-zinc-500 flex items-center">
                        <PrioridadeDot p={t.prioridade} />{t.responsavel}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">{t.pontos}pt</span>
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="text-center py-4 text-zinc-600 text-xs">Vazio</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TabPullRequests({ pullRequests }: { pullRequests: PullRequestDev[] }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-4 mb-2">
        {[
          { label: "Abertos", value: pullRequests.filter(p => p.status === "open").length, icon: <GitPullRequest className="w-4 h-4 text-green-400" /> },
          { label: "Em Revisão", value: pullRequests.filter(p => p.status === "review").length, icon: <Clock className="w-4 h-4 text-yellow-400" /> },
          { label: "Merged", value: pullRequests.filter(p => p.status === "merged").length, icon: <CheckCircle2 className="w-4 h-4 text-purple-400" /> },
        ].map(m => (
          <div key={m.label} className="p-4 rounded-lg bg-white/5 border border-white/10 flex items-center gap-3">
            {m.icon}
            <div>
              <p className="text-xl font-bold text-white">{m.value}</p>
              <p className="text-xs text-zinc-400">{m.label}</p>
            </div>
          </div>
        ))}
      </div>

      {pullRequests.length === 0 && (
        <div className="text-center py-12 text-zinc-500">Nenhum pull request cadastrado</div>
      )}

      {pullRequests.map(pr => (
        <div key={pr.id} className="flex items-start justify-between p-4 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 transition-colors">
          <div className="flex items-start gap-3">
            <GitPullRequest className={`w-4 h-4 mt-0.5 shrink-0 ${pr.status === "merged" ? "text-purple-400" : pr.status === "review" ? "text-yellow-400" : "text-green-400"}`} />
            <div>
              <p className="text-sm font-medium text-zinc-200">{pr.titulo}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-zinc-500">#{pr.numero}</span>
                <span className="text-xs text-zinc-500">·</span>
                <GitBranch className="w-3 h-3 text-zinc-500" />
                <span className="text-xs text-zinc-500 font-mono">{pr.branch}</span>
                <span className="text-xs text-zinc-500">· {pr.autor}</span>
              </div>
              {pr.conflitos && (
                <div className="flex items-center gap-1 mt-1">
                  <AlertCircle className="w-3 h-3 text-red-400" />
                  <span className="text-xs text-red-400">Conflitos de merge</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {pr.revisoes > 0 && (
              <span className="text-xs text-zinc-400">{pr.revisoes} revisão{pr.revisoes !== 1 ? "ões" : ""}</span>
            )}
            <PRStatusBadge status={pr.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TabCICD({ pipelines }: { pipelines: Pipeline[] }) {
  const successCount = pipelines.filter(p => p.status === "success").length;
  const taxa = pipelines.length > 0 ? Math.round((successCount / pipelines.length) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-4 mb-2">
        {[
          { label: "Sucesso", value: successCount, color: "text-green-400" },
          { label: "Executando", value: pipelines.filter(p => p.status === "running").length, color: "text-blue-400" },
          { label: "Falhou", value: pipelines.filter(p => p.status === "failed").length, color: "text-red-400" },
          { label: "Taxa de sucesso", value: `${taxa}%`, color: "text-zinc-200" },
        ].map(m => (
          <div key={m.label} className="p-4 rounded-lg bg-white/5 border border-white/10">
            <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{m.label}</p>
          </div>
        ))}
      </div>

      {pipelines.length === 0 && (
        <div className="text-center py-12 text-zinc-500">Nenhum pipeline cadastrado</div>
      )}

      {pipelines.map(p => (
        <div key={p.id} className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10">
          <div className="flex items-center gap-3">
            <PipelineIcon status={p.status} />
            <div>
              <p className="text-sm font-medium text-zinc-200">{p.nome}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <GitBranch className="w-3 h-3 text-zinc-500" />
                <span className="text-xs text-zinc-500 font-mono">{p.branch}</span>
                <span className="text-xs text-zinc-500">· commit {p.commit_sha.slice(0, 7)}</span>
                <span className="text-xs text-zinc-500">· {p.autor}</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-300">{p.duracao}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{p.executado_em.slice(0, 16).replace("T", " ")}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DesenvolvimentoView({ onBack }: DesenvolvimentoViewProps) {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [tarefas, setTarefas] = useState<SprintTask[]>([]);
  const [pullRequests, setPullRequests] = useState<PullRequestDev[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);

  useEffect(() => {
    listSprints().then(setSprints).catch(() => {});
    listSprintTasks().then(setTarefas).catch(() => {});
    listPullRequests().then(setPullRequests).catch(() => {});
    listPipelines().then(setPipelines).catch(() => {});
  }, []);

  const donePts = tarefas.filter(t => t.status === "done").reduce((s, t) => s + t.pontos, 0);
  const totalPts = sprints[0]?.pontos_totais ?? tarefas.reduce((s, t) => s + t.pontos, 0);
  const bugs = tarefas.filter(t => t.tipo === "bug").length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="relative overflow-hidden rounded-xl p-6 mb-6 bg-gradient-to-r from-blue-600/20 via-cyan-600/10 to-transparent border border-white/10">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-cyan-500/5" />
        <div className="relative flex items-start justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack} className="text-zinc-400 hover:text-white p-1 h-auto">
              <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
            </Button>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-blue-500/20 border border-blue-500/30">
                <Code2 className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Desenvolvimento</h1>
                <p className="text-sm text-zinc-400">Sprint · Pull Requests · CI/CD</p>
              </div>
            </div>
          </div>
          <div className="flex gap-6 text-center">
            {[
              { label: "Pontos concluídos", value: donePts, icon: <CheckCircle2 className="w-4 h-4 text-green-400 mx-auto mb-1" /> },
              { label: "Total no Sprint", value: totalPts, icon: <BarChart3 className="w-4 h-4 text-blue-400 mx-auto mb-1" /> },
              { label: "Bugs ativos", value: bugs, icon: <Bug className="w-4 h-4 text-red-400 mx-auto mb-1" /> },
              { label: "PRs abertos", value: pullRequests.filter(p => p.status !== "merged").length, icon: <GitPullRequest className="w-4 h-4 text-cyan-400 mx-auto mb-1" /> },
            ].map(m => (
              <div key={m.label} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 min-w-[90px]">
                {m.icon}
                <p className="text-xl font-bold text-white">{m.value}</p>
                <p className="text-xs text-zinc-400">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="sprint" className="flex-1">
        <TabsList className="bg-white/5 border border-white/10 mb-6">
          <TabsTrigger value="sprint" className="data-[state=active]:bg-white/10">
            <Zap className="w-4 h-4 mr-1.5" /> Sprint
          </TabsTrigger>
          <TabsTrigger value="prs" className="data-[state=active]:bg-white/10">
            <GitPullRequest className="w-4 h-4 mr-1.5" /> Pull Requests
          </TabsTrigger>
          <TabsTrigger value="cicd" className="data-[state=active]:bg-white/10">
            <Package className="w-4 h-4 mr-1.5" /> CI/CD
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sprint"><TabSprint sprints={sprints} tarefas={tarefas} /></TabsContent>
        <TabsContent value="prs"><TabPullRequests pullRequests={pullRequests} /></TabsContent>
        <TabsContent value="cicd"><TabCICD pipelines={pipelines} /></TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-zinc-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> AI Backend · AI Frontend</span>
          <span className="flex items-center gap-1.5"><GitBranch className="w-3.5 h-3.5" /> pgba-boilerplate</span>
        </div>
        <span>Setor Desenvolvimento</span>
      </div>
    </div>
  );
}
