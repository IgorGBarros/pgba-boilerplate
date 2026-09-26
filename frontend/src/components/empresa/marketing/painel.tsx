// frontend/src/components/empresa/marketing/painel.tsx — visão geral + primeiros passos + time
import { useEffect, useState } from "react";
import { AlertTriangle, Bot, CalendarCheck, CheckCircle2, CircleDashed, Clapperboard, Loader2, Send, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { marketing, type PainelMarketing, type PerfilMarca, type ProntidaoMarketing, type TimeMarketing } from "@/lib/api";
import { Kpi, ORDEM_REDES, REDES, RedeIcon, STATUS, Tag, erroMsg, quando } from "@/components/empresa/marketing/shared";

export function TimeCard({ time, onMontar }: { time: TimeMarketing | null; onMontar: () => void }) {
  const [busy, setBusy] = useState(false);
  const montar = async () => {
    setBusy(true);
    try {
      const r = await marketing.montarTime();
      toast.success(r.criados.length ? `Time montado: ${r.criados.join(", ")}.` : "O time já estava completo.");
      onMontar();
    } catch (e) { toast.error(erroMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Users className="size-4" /> Time de marketing</p>
        {time && time.faltando.length > 0 && (
          <Button size="sm" onClick={() => void montar()} disabled={busy}>{busy && <Loader2 className="size-3.5 animate-spin" />} {time.agentes.length ? "Completar time" : "Montar time"}</Button>
        )}
      </div>
      {!time ? <p className="text-sm text-muted-foreground">Carregando…</p> : time.agentes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Head de Marketing, Estrategista, Copywriter, Designer, Editor de Vídeo, Social Media e Analista — todos com a IA do setor,
          todos escrevem rascunho e nenhum publica sem você aprovar.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {time.agentes.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <span className={`size-2 shrink-0 rounded-full ${a.work_status === "working" ? "animate-pulse bg-success" : a.work_status === "paused" ? "bg-warning" : "bg-muted-foreground/40"}`} />
              <span className="min-w-0 flex-1 truncate">{a.nome}{a.nivel === "sector_orchestrator" && <span className="ml-1 text-amber-500">★</span>}</span>
              {a.work_status === "working" ? <span className="max-w-[45%] truncate text-xs text-success">{a.tarefa}</span> : <span className="text-xs text-muted-foreground">{a.cargo}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Passo({ ok, titulo, texto, acao, onClick }: { ok: boolean; titulo: string; texto: string; acao: string; onClick: () => void }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      {ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${ok ? "text-muted-foreground line-through decoration-1" : ""}`}>{titulo}</p>
        <p className="text-xs text-muted-foreground">{texto}</p>
      </div>
      {!ok && <Button size="sm" variant="outline" onClick={onClick}>{acao}</Button>}
    </li>
  );
}

export function PainelTab({ reloadKey, onGo, time, recarregarTime, planejar, abrir }: {
  reloadKey: number;
  onGo: (tab: string) => void;
  time: TimeMarketing | null;
  recarregarTime: () => void;
  planejar: () => void;
  abrir: (id: number) => void;
}) {
  const [p, setP] = useState<PainelMarketing | null>(null);
  const [marca, setMarca] = useState<PerfilMarca | null>(null);
  const [pront, setPront] = useState<ProntidaoMarketing | null>(null);
  useEffect(() => {
    marketing.painel().then(setP).catch(() => setP(null));
    marketing.marca().then(setMarca).catch(() => undefined);
    marketing.prontidao().then(setPront).catch(() => undefined);
  }, [reloadKey]);
  if (!p) return <p className="py-10 text-center text-sm text-muted-foreground">Carregando painel…</p>;

  const marcaOk = !!(marca?.nome && marca?.descricao);
  const timeOk = !!time && time.faltando.length === 0;
  const contasOk = p.contas.total > 0;
  const planoOk = p.dias_com_post_14d >= 4;
  const passosFeitos = [marcaOk, timeOk, contasOk, planoOk].filter(Boolean).length;
  const maxRede = Math.max(1, ...Object.values(p.publicadas_30d_por_rede).map(Number));

  return (
    <div className="space-y-4">
      {passosFeitos < 4 && (
        <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-surface to-surface p-4">
          <div className="flex items-center justify-between">
            <p className="font-display text-base font-semibold">Publicar sempre, sem depender de você lembrar</p>
            <span className="text-xs text-muted-foreground">{passosFeitos}/4</span>
          </div>
          <ol className="mt-1 divide-y divide-border">
            <Passo ok={marcaOk} titulo="1. Conte quem é a marca" texto="Ramo, público, tom e pilares — o briefing que todo agente lê. Serve pra qualquer ramo." acao="Preencher" onClick={() => onGo("marca")} />
            <Passo ok={timeOk} titulo="2. Monte o time" texto="7 agentes especialistas no setor Marketing (idempotente)." acao="Montar" onClick={() => void marketing.montarTime().then(recarregarTime)} />
            <Passo ok={contasOk} titulo="3. Conecte as redes" texto="Instagram, TikTok, YouTube, Facebook, LinkedIn, X, Discord e Twitch." acao="Conectar" onClick={() => onGo("contas")} />
            <Passo ok={planoOk} titulo="4. Planeje as próximas semanas" texto="O Estrategista enche o calendário e o Copywriter escreve; você só aprova." acao="Planejar" onClick={planejar} />
          </ol>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Próximos 7 dias" value={p.semana} hint={`${p.dias_com_post_14d}/14 dias com post marcado`} icon={<CalendarCheck className="size-4" />} tone={p.semana ? "ok" : "warn"} />
        <Kpi label="Pra aprovar" value={p.aguardando_aprovacao} hint="rascunhos e revisões" icon={<Send className="size-4" />} tone={p.aguardando_aprovacao ? "warn" : undefined} />
        <Kpi label="Publicadas no mês" value={p.publicadas_mes} hint={`${p.agendadas} aprovada(s) esperando o horário`} icon={<Sparkles className="size-4" />} />
        <Kpi label="Com erro" value={p.com_erro} hint={p.contas.com_problema ? `${p.contas.com_problema} conta(s) com problema` : "contas ok"} icon={<AlertTriangle className="size-4" />} tone={p.com_erro || p.contas.com_problema ? "error" : undefined} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Próximas publicações</p>
            <Button size="sm" variant="ghost" onClick={() => onGo("calendario")}>Calendário</Button>
          </div>
          {p.proximas.length ? (
            <ul className="divide-y divide-border">
              {p.proximas.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => abrir(x.id)} className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-secondary/40">
                    <span className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">{quando(x.agendada_para)}</span>
                    <span className="min-w-0 flex-1 truncate">{x.titulo}</span>
                    <span className="flex shrink-0 gap-1">{[...new Set(x.destinos.map((d) => d.rede))].map((r) => <RedeIcon key={r} rede={r} className="size-3.5" />)}</span>
                    {x.escrita_por_ia && <Bot className="size-3.5 text-violet-500" />}
                    <Tag tone={STATUS[x.status].tone}>{STATUS[x.status].label}</Tag>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-6 text-center">
              <p className="text-sm text-muted-foreground">Calendário vazio.</p>
              <Button size="sm" className="mt-2" onClick={planejar}><Sparkles className="size-3.5" /> Planejar com IA</Button>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <TimeCard time={time} onMontar={recarregarTime} />
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="mb-2 text-sm font-semibold">Publicado nos últimos 30 dias</p>
            <ul className="space-y-1.5">
              {ORDEM_REDES.filter((r) => p.contas.redes.includes(r) || p.publicadas_30d_por_rede[r]).map((r) => {
                const n = Number(p.publicadas_30d_por_rede[r] ?? 0);
                return (
                  <li key={r} className="flex items-center gap-2 text-xs">
                    <RedeIcon rede={r} className="size-3.5" />
                    <span className="w-16 shrink-0">{REDES[r].nome}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"><span className="block h-full rounded-full" style={{ width: `${(n / maxRede) * 100}%`, backgroundColor: REDES[r].cor }} /></span>
                    <span className="w-5 text-right tabular-nums">{n}</span>
                  </li>
                );
              })}
              {!p.contas.redes.length && !Object.keys(p.publicadas_30d_por_rede).length && <li className="text-xs text-muted-foreground">Nenhuma rede conectada.</li>}
            </ul>
          </div>
          {p.jobs_ativos > 0 && (
            <button type="button" onClick={() => onGo("videos")} className="flex w-full items-center gap-2 rounded-2xl border border-violet-500/30 bg-violet-500/5 p-3 text-left text-sm">
              <Clapperboard className="size-4 text-violet-500" /> {p.jobs_ativos} vídeo(s) sendo processado(s)
            </button>
          )}
          {pront && !pront.api_publica && p.contas.redes.includes("instagram") && (
            <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs">Instagram precisa de <b>PUBLIC_API_URL</b> no servidor (a Meta busca a mídia por um link público).</p>
          )}
        </div>
      </div>
    </div>
  );
}
