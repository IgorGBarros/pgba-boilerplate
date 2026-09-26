// frontend/src/components/empresa/ti/agentes.tsx
//
// Observabilidade de TODOS os agentes de todos os setores: chamadas de IA,
// custo, tarefas, falhas, tarefas paradas e aprovações esquecidas.
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ti, type AgenteObs, type SetorObs } from "@/lib/api";
import { Dot, Kpi, Tag, Vazio, relativo } from "@/components/empresa/ti/shared";

const usd = (v: number) => `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`;
const JANELAS = [1, 24, 24 * 7, 24 * 30];
const nomeJanela = (h: number) => (h === 1 ? "1 hora" : h === 24 ? "24 horas" : `${h / 24} dias`);

export function AgentesTab({ reloadKey }: { reloadKey: number }) {
  const [horas, setHoras] = useState(24);
  const [dados, setDados] = useState<{ agentes: AgenteObs[]; setores: SetorObs[] } | null>(null);
  const [busca, setBusca] = useState("");
  const [setor, setSetor] = useState<string>("");
  const [soProblema, setSoProblema] = useState(false);

  useEffect(() => { ti.agentes(horas).then(setDados).catch(() => setDados({ agentes: [], setores: [] })); }, [horas, reloadKey]);

  const lista = useMemo(() => (dados?.agentes ?? []).filter((a) =>
    (!setor || a.setor === setor) && (!soProblema || a.saude !== "ok") &&
    (!busca || `${a.nome} ${a.cargo} ${a.setor}`.toLowerCase().includes(busca.toLowerCase()))), [dados, setor, soProblema, busca]);

  if (!dados) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando…</p>;
  const tot = dados.setores.reduce((acc, s) => ({ chamadas: acc.chamadas + s.chamadas, custo: acc.custo + s.custo_usd, falhas: acc.falhas + s.falhas, alertas: acc.alertas + s.alertas, trabalhando: acc.trabalhando + s.trabalhando }),
    { chamadas: 0, custo: 0, falhas: 0, alertas: 0, trabalhando: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-secondary p-1 text-xs">
          {JANELAS.map((h) => (
            <button key={h} type="button" onClick={() => setHoras(h)}
              className={`rounded-md px-2.5 py-1 ${horas === h ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>{nomeJanela(h)}</button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Tarefas paradas, falhas e aprovações são sempre o estado atual.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Kpi label="Agentes" valor={dados.agentes.length} detalhe={`${tot.trabalhando} trabalhando agora`} />
        <Kpi label={`Chamadas de IA · ${nomeJanela(horas)}`} valor={tot.chamadas.toLocaleString("pt-BR")} />
        <Kpi label="Custo" valor={usd(tot.custo)} />
        <Kpi label="Tarefas que falharam" valor={tot.falhas} tone={tot.falhas ? "error" : undefined} />
        <Kpi label="Agentes com alerta" valor={tot.alertas} tone={tot.alertas ? "warn" : undefined} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {dados.setores.map((s) => (
          <button key={s.setor} type="button" onClick={() => setSetor(setor === s.setor ? "" : s.setor)}
            className={`rounded-xl border p-3 text-left transition ${setor === s.setor ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-secondary/50"}`}>
            <div className="flex items-center gap-2">
              <Dot status={s.falhas ? "falha" : s.alertas ? "alerta" : "ok"} />
              <span className="truncate font-medium">{s.setor}</span>
              <span className="ml-auto text-xs text-muted-foreground">{s.agentes} agente(s)</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {s.chamadas} chamada(s) · {usd(s.custo_usd)}{s.trabalhando ? ` · ${s.trabalhando} trabalhando` : ""}
            </p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar agente…" className="pl-8" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={soProblema} onChange={(e) => setSoProblema(e.target.checked)} /> Só com problema
        </label>
      </div>

      {lista.length === 0 ? <Vazio>Nenhum agente com esse filtro.</Vazio> : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-secondary/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Agente</th>
                <th className="px-3 py-2">IA</th>
                <th className="px-3 py-2 text-right">Chamadas</th>
                <th className="px-3 py-2 text-right">Custo</th>
                <th className="px-3 py-2">Tarefas</th>
                <th className="px-3 py-2">Última atividade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lista.map((a) => (
                <tr key={a.id} className="bg-surface">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Dot status={a.saude} />
                      <span className="font-medium">{a.nome}</span>
                      {a.work_status === "working" && <Tag tone="ok">trabalhando</Tag>}
                      {a.work_status === "paused" && <Tag>pausado</Tag>}
                    </div>
                    <p className="text-xs text-muted-foreground">{a.setor} · {a.cargo}</p>
                    {a.work_status === "working" && a.tarefa_atual && <p className="truncate text-xs text-success">{a.tarefa_atual}</p>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.provedor || "do tenant"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.chamadas}<p className="text-[11px] text-muted-foreground">{a.tokens.toLocaleString("pt-BR")} tokens</p></td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(a.custo_usd)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(a.tarefas).map(([st, n]) => <Tag key={st}>{n} {st.replace("_", " ")}</Tag>)}
                      {a.falhas > 0 && <Tag tone="error">{a.falhas} falharam</Tag>}
                      {a.presas > 0 && <Tag tone="warn">{a.presas} parada(s) &gt;30min</Tag>}
                      {a.aprovacoes_pendentes > 0 && <Tag tone="warn">{a.aprovacoes_pendentes} aprovação(ões)</Tag>}
                      {!Object.keys(a.tarefas).length && !a.falhas && !a.presas && !a.aprovacoes_pendentes && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{relativo(a.ultima_atividade)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
