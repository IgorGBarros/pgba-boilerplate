// frontend/src/components/empresa/ti/visao.tsx
//
// Visão geral do TI: está tudo no ar? (componentes da plataforma e da empresa,
// agrupados), incidentes em andamento e a saúde da fila de chamados.
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ti, type Componente, type PainelObs, type PainelTI, type StatusSaude } from "@/lib/api";
import { Dot, GRUPOS, Kpi, SAUDE, Tag, duracao, erroTexto, relativo } from "@/components/empresa/ti/shared";

const ORDEM_GRUPOS = ["plataforma", "ia", "agentes", "conector", "mcp", "email", "social"];
const PIOR: StatusSaude[] = ["falha", "alerta", "desconhecido", "ok"];

function pior(cs: Componente[]): StatusSaude {
  return PIOR.find((s) => cs.some((c) => c.status === s)) ?? "desconhecido";
}

function ComponenteLinha({ c }: { c: Componente }) {
  const [aberto, setAberto] = useState(c.status === "falha");
  const temDetalhe = !!(c.causa || c.acao || c.detalhe);
  return (
    <li className="py-1.5">
      <button type="button" onClick={() => temDetalhe && setAberto(!aberto)} className="flex w-full items-center gap-2 text-left">
        <Dot status={c.status} pulse />
        <span className="min-w-0 flex-1 truncate text-sm" title={c.nome}>{c.nome}</span>
        {c.ms != null && c.status !== "falha" && <span className="text-[11px] tabular-nums text-muted-foreground">{c.ms} ms</span>}
        {c.disponibilidade_24h != null && (
          <span title="Disponibilidade nas últimas 24h"
            className={`text-[11px] tabular-nums ${c.disponibilidade_24h < 99 ? "text-warning" : "text-muted-foreground"}`}>{c.disponibilidade_24h}%</span>
        )}
        {temDetalhe && <ChevronRight className={`size-3.5 text-muted-foreground transition ${aberto ? "rotate-90" : ""}`} />}
      </button>
      {aberto && temDetalhe && (
        <div className="ml-[18px] mt-1 space-y-0.5 border-l border-border pl-3 text-xs">
          {c.detalhe && <p className="break-words text-muted-foreground">{c.detalhe}</p>}
          {c.causa && <p><span className="font-medium">Por quê: </span>{c.causa}</p>}
          {c.acao && <p><span className="font-medium">O que fazer: </span>{c.acao}</p>}
          <p className="text-muted-foreground">{SAUDE[c.status].label} desde {relativo(c.desde)} · verificado {relativo(c.verificado_em)}</p>
        </div>
      )}
    </li>
  );
}

export function VisaoTab({ obs, painel, carregando, recarregar, onGo, abrirIncidente }: {
  obs: PainelObs | null;
  painel: PainelTI | null;
  carregando: boolean;
  recarregar: () => void;
  onGo: (tab: string) => void;
  abrirIncidente: (id: number) => void;
}) {
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro] = useState("");
  const verificar = async () => {
    setVerificando(true); setErro("");
    try { await ti.verificar(); recarregar(); } catch (e) { setErro(erroTexto(e)); } finally { setVerificando(false); }
  };

  if (!obs || !painel) {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {carregando ? "Carregando…" : "Sem dados"}</p>;
  }
  const grupos = ORDEM_GRUPOS.concat([...new Set(obs.componentes.map((c) => c.grupo))].filter((g) => !ORDEM_GRUPOS.includes(g)))
    .map((g) => ({ g, cs: obs.componentes.filter((c) => c.grupo === g) }))
    .filter((x) => x.cs.length);
  const fora = obs.contagem.falha ?? 0;
  const atencao = obs.contagem.alerta ?? 0;
  const geral: StatusSaude = obs.componentes.length === 0 ? "desconhecido" : fora ? "falha" : atencao ? "alerta" : "ok";

  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-4 ${geral === "falha" ? "border-destructive/40 bg-destructive/5" : geral === "alerta" ? "border-warning/40 bg-warning/5" : "border-success/30 bg-success/5"}`}>
        {geral === "ok" ? <CheckCircle2 className="size-6 text-success" /> : <AlertTriangle className={`size-6 ${SAUDE[geral].text}`} />}
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold">
            {geral === "ok" ? "Tudo funcionando" : geral === "desconhecido" ? "Ainda sem verificação" :
              fora ? `${fora} componente(s) fora do ar` : `${atencao} componente(s) pedem atenção`}
          </p>
          <p className="text-xs text-muted-foreground">
            {obs.componentes.length} componentes monitorados · última verificação {relativo(obs.ultima_verificacao)} · verificação automática a cada minuto
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={verificar} disabled={verificando}>
          {verificando ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Verificar agora
        </Button>
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {obs.incidentes_abertos.length > 0 && (
        <div className="space-y-2">
          {obs.incidentes_abertos.map((i) => (
            <button key={i.id} type="button" onClick={() => abrirIncidente(i.id)}
              className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-destructive/30 bg-surface p-3 text-left transition hover:bg-destructive/5">
              <Dot status="falha" pulse />
              <span className="font-medium">{i.titulo}</span>
              <Tag tone="error">há {duracao(i.duracao_min)}</Tag>
              {i.diagnostico?.causa_provavel && <Tag tone="violet">diagnosticado</Tag>}
              <span className="ml-auto text-xs text-muted-foreground">{i.causa || "ver detalhes"}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Chamados abertos" valor={painel.abertos} detalhe={<button className="underline-offset-2 hover:underline" onClick={() => onGo("chamados")}>ver fila</button>} />
        <Kpi label="SLA estourado" valor={painel.sla_estourado} tone={painel.sla_estourado ? "error" : undefined} detalhe={`${painel.sla_vencendo} vencendo em 2h`} />
        <Kpi label="Sem resposta" valor={painel.sem_resposta} tone={painel.sem_resposta ? "warn" : undefined} />
        <Kpi label="1ª resposta (30d)" valor={duracao(painel.mes.primeira_resposta_min)} />
        <Kpi label="Resolução (30d)" valor={duracao(painel.mes.resolucao_min)} detalhe={`${painel.mes.resolvidos} de ${painel.mes.abertos} resolvidos`} />
        <Kpi label="No prazo (30d)" valor={painel.mes.no_prazo_pct == null ? "—" : `${painel.mes.no_prazo_pct}%`}
          tone={painel.mes.no_prazo_pct == null ? undefined : painel.mes.no_prazo_pct >= 90 ? "ok" : "warn"} />
      </div>

      {!painel.tem_time && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border p-4 text-sm">
          <Users className="size-5 text-muted-foreground" />
          <span className="flex-1">O setor TI ainda não tem time: sem ele, chamados ficam sem agente e incidentes sem diagnóstico.</span>
          <Button size="sm" onClick={() => onGo("time")}>Montar time de TI</Button>
        </div>
      )}

      {grupos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhuma verificação ainda. Clique em <b>Verificar agora</b> (o agendador do Celery roda sozinho a cada minuto).
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {grupos.map(({ g, cs }) => (
            <section key={g} className="rounded-xl border border-border bg-surface p-3">
              <header className="mb-1 flex items-center gap-2">
                <Dot status={pior(cs)} />
                <h3 className="text-sm font-semibold">{GRUPOS[g] ?? g}</h3>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {cs.filter((c) => c.status === "ok").length}/{cs.length} ok
                </span>
              </header>
              <ul className="divide-y divide-border">
                {cs.map((c) => <ComponenteLinha key={c.id} c={c} />)}
              </ul>
            </section>
          ))}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Kpi label="API · 24h" valor={obs.api_24h.total.toLocaleString("pt-BR")}
          detalhe={`${obs.api_24h.taxa_erro}% com erro 5xx · média ${obs.api_24h.ms_medio ?? "—"} ms`} tone={obs.api_24h.taxa_erro > 2 ? "warn" : undefined} />
        <Kpi label="Chamadas de IA · 24h" valor={obs.ia_24h.total.toLocaleString("pt-BR")}
          detalhe={`${obs.ia_24h.taxa_erro}% com erro · média ${obs.ia_24h.ms_medio ?? "—"} ms`} tone={obs.ia_24h.taxa_erro > 5 ? "warn" : undefined} />
      </div>
    </div>
  );
}
