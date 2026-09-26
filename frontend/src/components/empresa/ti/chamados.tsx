// frontend/src/components/empresa/ti/chamados.tsx
//
// Chamados atendidos pelo time de TI através de Tasks reais: a IA sugere a
// resposta (com fatos do monitoramento citados), uma pessoa responde e resolve
// — resolver aprova a Task do chamado.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Loader2, MessageSquare, Plus, RotateCcw, Search, Send, Sparkles, User, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ti, type InteracaoChamado, type PrioridadeChamado, type Ticket } from "@/lib/api";
import {
  CATEGORIAS, ComCitacoes, Fatos, PRIORIDADE, STATUS_CHAMADO, SlaInfo, TASK_STATUS, Tag, Vazio,
  categoriaLabel, dataHora, erroTexto, relativo, selectCls,
} from "@/components/empresa/ti/shared";

const FILTROS: { id: string; label: string; params: Record<string, string> }[] = [
  { id: "abertos", label: "Em aberto", params: { abertos: "1" } },
  { id: "monitoramento", label: "Do monitoramento", params: { abertos: "1", origem: "incidente" } },
  { id: "resolvidos", label: "Resolvidos", params: { status: "resolvido" } },
  { id: "todos", label: "Todos", params: {} },
];
const ORDEM_P: Record<string, number> = { critica: 0, alta: 1, media: 2, baixa: 3 };
const ORIGEM: Record<Ticket["origem"], string> = { manual: "pessoa", incidente: "monitoramento", agente: "agente de IA", email: "e-mail" };

export function ChamadosTab({ reloadKey, abrirId, onAberto, onChanged }: {
  reloadKey: number; abrirId?: number | null; onAberto?: () => void; onChanged: () => void;
}) {
  const [filtro, setFiltro] = useState("abertos");
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<Ticket[] | null>(null);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState<number | null>(null);
  const [novo, setNovo] = useState(false);

  const carregar = useCallback(() => {
    const f = FILTROS.find((x) => x.id === filtro)!;
    ti.chamados({ ...f.params, ...(busca.trim() ? { search: busca.trim() } : {}) })
      .then((l) => { setLista(l); setErro(""); })
      .catch((e) => setErro(erroTexto(e)));
  }, [filtro, busca]);
  useEffect(() => { const t = setTimeout(carregar, busca ? 300 : 0); return () => clearTimeout(t); }, [carregar, reloadKey, busca]);
  useEffect(() => { if (abrirId) { setAberto(abrirId); onAberto?.(); } }, [abrirId, onAberto]);

  const ordenada = useMemo(
    () => [...(lista ?? [])].sort((a, b) => {
      const fechado = (t: Ticket) => (t.status === "resolvido" || t.status === "fechado" ? 1 : 0);
      return fechado(a) - fechado(b) || ORDEM_P[a.prioridade] - ORDEM_P[b.prioridade] || (a.sla_restante_min ?? 1e9) - (b.sla_restante_min ?? 1e9);
    }),
    [lista],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-secondary p-1">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFiltro(f.id)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${filtro === f.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por título, solicitante, atendente…" className="pl-8" />
        </div>
        <Button size="sm" onClick={() => setNovo(true)}><Plus className="size-3.5" /> Abrir chamado</Button>
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {lista === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando…</p>
      ) : ordenada.length === 0 ? (
        <Vazio>Nenhum chamado aqui. {filtro === "abertos" && "Fila zerada 🎉"}</Vazio>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Chamado</th>
                <th className="hidden px-3 py-2 md:table-cell">Atendente</th>
                <th className="px-3 py-2">Status</th>
                <th className="hidden px-3 py-2 sm:table-cell">SLA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ordenada.map((t) => (
                <tr key={t.id} onClick={() => setAberto(t.id)} className="cursor-pointer bg-surface transition hover:bg-secondary/50">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Tag tone={PRIORIDADE[t.prioridade].tone}>{PRIORIDADE[t.prioridade].label}</Tag>
                      <span className="font-medium">#{t.id} {t.titulo}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {categoriaLabel(t.categoria)} · {t.solicitante} · aberto {relativo(t.created_at)}
                      {t.origem !== "manual" && <> · via {ORIGEM[t.origem]}</>}
                      {t.interacoes_count > 1 && <> · {t.interacoes_count} interações</>}
                    </p>
                  </td>
                  <td className="hidden px-3 py-2.5 md:table-cell">
                    {t.agente_nome ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className={`size-2 rounded-full ${t.agente_status === "working" ? "bg-success" : "bg-muted-foreground opacity-50"}`} />
                        {t.agente_nome}
                      </span>
                    ) : <span className="text-xs text-muted-foreground">sem agente</span>}
                    {t.task_status && <p className="text-[11px] text-muted-foreground">{TASK_STATUS[t.task_status] ?? t.task_status}</p>}
                  </td>
                  <td className="px-3 py-2.5"><Tag tone={STATUS_CHAMADO[t.status].tone}>{STATUS_CHAMADO[t.status].label}</Tag></td>
                  <td className="hidden px-3 py-2.5 sm:table-cell">
                    <SlaInfo minutos={t.sla_restante_min} estourado={t.sla_estourado} resolvido={!!t.resolvido_em} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aberto && <ChamadoDetalhe id={aberto} onClose={() => setAberto(null)} onChanged={() => { carregar(); onChanged(); }} />}
      {novo && <NovoChamado onClose={() => setNovo(false)} onCriado={(t) => { setNovo(false); carregar(); onChanged(); setAberto(t.id); }} />}
    </div>
  );
}

export function NovoChamado({ onClose, onCriado }: { onClose: () => void; onCriado: (t: Ticket) => void }) {
  const [form, setForm] = useState({ titulo: "", descricao: "", categoria: "sistema", prioridade: "media" as PrioridadeChamado });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const salvar = async () => {
    if (!form.titulo.trim()) return setErro("Dê um título ao chamado.");
    setSalvando(true);
    try { onCriado(await ti.abrir(form)); } catch (e) { setErro(erroTexto(e)); } finally { setSalvando(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Abrir chamado para o TI</DialogTitle>
          <DialogDescription>O chamado vira uma Task do agente de TI da categoria; o SLA conta a partir de agora.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input autoFocus value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="O que está acontecendo?" />
          <Textarea rows={4} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            placeholder="Desde quando, quem é afetado, mensagem de erro que aparece…" />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">Categoria
              <select className={selectCls} value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                {CATEGORIAS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">Prioridade
              <select className={selectCls} value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as PrioridadeChamado })}>
                {(Object.keys(PRIORIDADE) as PrioridadeChamado[]).map((p) => <option key={p} value={p}>{PRIORIDADE[p].label} — SLA {PRIORIDADE[p].sla}h</option>)}
              </select>
            </label>
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando}>{salvando && <Loader2 className="size-3.5 animate-spin" />} Abrir chamado</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const PAPEIS = [
  { value: "suporte", label: "Analista de Suporte" },
  { value: "sre", label: "SRE / Observabilidade" },
  { value: "dba", label: "DBA" },
  { value: "integracoes", label: "Analista de Integrações" },
  { value: "seguranca", label: "Segurança da Informação" },
  { value: "head", label: "Head de TI" },
];

function SugestaoCard({ i, usar }: { i: InteracaoChamado; usar: (texto: string) => void }) {
  const d = i.dados.diagnostico ?? null;
  const s = i.dados;
  const fatos = d?.fatos ?? s.fatos;
  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 text-sm">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
        <Sparkles className="size-3.5" /> {d ? "Diagnóstico" : "Sugestão"} de {i.autor} · {relativo(i.created_at)}
        <span className="font-normal text-muted-foreground">— rascunho, nada foi enviado</span>
      </p>
      {d ? (
        <div className="space-y-2">
          <p><span className="font-medium">Causa provável: </span><ComCitacoes texto={d.causa_provavel ?? ""} fatos={fatos} /></p>
          {!!d.evidencias?.length && (
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">{d.evidencias.map((e, k) => <li key={k}><ComCitacoes texto={e} fatos={fatos} /></li>)}</ul>
          )}
          {d.impacto && <p><span className="font-medium">Impacto: </span><ComCitacoes texto={d.impacto} fatos={fatos} /></p>}
          {!!d.acoes?.length && (
            <div><p className="font-medium">O que fazer</p><ol className="list-decimal space-y-0.5 pl-5">{d.acoes.map((a, k) => <li key={k}>{a}</li>)}</ol></div>
          )}
          {!!d.prevencao?.length && (
            <div><p className="font-medium">Pra não acontecer de novo</p><ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">{d.prevencao.map((a, k) => <li key={k}>{a}</li>)}</ul></div>
          )}
          {d.confianca && <Tag tone={d.confianca === "alta" ? "ok" : d.confianca === "media" ? "warn" : "muted"}>confiança {d.confianca}</Tag>}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap"><ComCitacoes texto={s.resposta ?? i.texto} fatos={fatos} /></p>
          {!!s.passos?.length && <ol className="list-decimal space-y-0.5 pl-5">{s.passos.map((p, k) => <li key={k}>{p}</li>)}</ol>}
          {!!s.perguntas?.length && (
            <div className="text-muted-foreground"><p className="text-xs font-medium">Perguntas pro solicitante</p><ul className="list-disc pl-5">{s.perguntas.map((p, k) => <li key={k}>{p}</li>)}</ul></div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {s.prioridade_sugerida && <Tag>prioridade sugerida: {s.prioridade_sugerida}</Tag>}
            {s.encaminhar_para && <Tag tone="info">encaminhar: {s.encaminhar_para}</Tag>}
          </div>
          <Button size="sm" variant="outline" onClick={() => usar(montarResposta(s.resposta ?? i.texto, s.passos, s.perguntas))}>
            Usar como resposta (revisar antes)
          </Button>
        </div>
      )}
      {!!(d?.citacoes_invalidas ?? s.citacoes_invalidas)?.length && (
        <p className="mt-2 text-[11px] text-warning">A IA citou fato inexistente ({(d?.citacoes_invalidas ?? s.citacoes_invalidas)!.join(", ")}) — removido.</p>
      )}
      <div className="mt-2"><Fatos fatos={fatos} /></div>
    </div>
  );
}

function montarResposta(resposta: string, passos?: string[], perguntas?: string[]) {
  const limpo = (t: string) => t.replace(/\s*\[F\d+\]/g, "");
  let txt = limpo(resposta);
  if (passos?.length) txt += "\n\n" + passos.map((p, k) => `${k + 1}. ${limpo(p)}`).join("\n");
  if (perguntas?.length) txt += "\n\nPra seguir, me conta:\n" + perguntas.map((p) => `- ${limpo(p)}`).join("\n");
  return txt;
}

export function ChamadoDetalhe({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const [t, setT] = useState<Ticket | null>(null);
  const [inter, setInter] = useState<InteracaoChamado[]>([]);
  const [texto, setTexto] = useState("");
  const [modo, setModo] = useState<"resposta" | "comentario">("resposta");
  const [aguardar, setAguardar] = useState(false);
  const [instrucoes, setInstrucoes] = useState("");
  const [solucao, setSolucao] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");

  const carregar = useCallback(() => {
    ti.chamado(id).then(setT).catch((e) => setErro(erroTexto(e)));
    ti.interacoes(id).then(setInter).catch(() => setInter([]));
  }, [id]);
  useEffect(carregar, [carregar]);

  const rodar = async (nome: string, fn: () => Promise<unknown>) => {
    setOcupado(nome); setErro("");
    try { await fn(); carregar(); onChanged(); return true; } catch (e) { setErro(erroTexto(e)); return false; } finally { setOcupado(""); }
  };
  const fechado = t?.status === "resolvido" || t?.status === "fechado";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        {!t ? (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {erro || "Carregando…"}</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                <span>#{t.id} {t.titulo}</span>
                <Tag tone={PRIORIDADE[t.prioridade].tone}>{PRIORIDADE[t.prioridade].label}</Tag>
                <Tag tone={STATUS_CHAMADO[t.status].tone}>{STATUS_CHAMADO[t.status].label}</Tag>
              </DialogTitle>
              <DialogDescription>
                {categoriaLabel(t.categoria)} · aberto por {t.solicitante} em {dataHora(t.created_at)} · via {ORIGEM[t.origem]}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 md:grid-cols-[1fr_260px]">
              <div className="min-w-0 space-y-3">
                {t.descricao && <p className="whitespace-pre-wrap rounded-xl border border-border bg-secondary/40 p-3 text-sm">{t.descricao}</p>}

                <ol className="space-y-2.5">
                  {inter.map((i) => i.tipo === "ia" ? (
                    <li key={i.id}><SugestaoCard i={i} usar={(txt) => { setModo("resposta"); setTexto(txt); }} /></li>
                  ) : i.tipo === "sistema" ? (
                    <li key={i.id} className="flex gap-2 px-1 text-xs text-muted-foreground">
                      <Wrench className="mt-0.5 size-3.5 shrink-0" />
                      <span>{i.texto} <span className="opacity-70">· {relativo(i.created_at)}</span></span>
                    </li>
                  ) : (
                    <li key={i.id} className={`rounded-xl border p-3 text-sm ${i.tipo === "resposta" ? "border-sky-500/30 bg-sky-500/5" : "border-border bg-surface"}`}>
                      <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {i.tipo === "resposta" ? <Send className="size-3.5" /> : <MessageSquare className="size-3.5" />}
                        <span className="font-medium text-foreground">{i.autor || "—"}</span> · {i.tipo === "resposta" ? "resposta ao solicitante" : "comentário interno"} · {relativo(i.created_at)}
                      </p>
                      <p className="whitespace-pre-wrap">{i.texto}</p>
                    </li>
                  ))}
                </ol>

                {!fechado && (
                  <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
                    <div className="flex gap-1 text-xs">
                      {(["resposta", "comentario"] as const).map((m) => (
                        <button key={m} type="button" onClick={() => setModo(m)}
                          className={`rounded-md px-2.5 py-1 ${modo === m ? "bg-secondary font-medium" : "text-muted-foreground"}`}>
                          {m === "resposta" ? "Responder ao solicitante" : "Comentário interno"}
                        </button>
                      ))}
                    </div>
                    <Textarea rows={4} value={texto} onChange={(e) => setTexto(e.target.value)}
                      placeholder={modo === "resposta" ? "Escreva (ou use a sugestão da IA e revise)…" : "Anotação pro time — o solicitante não vê."} />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {modo === "resposta" ? (
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input type="checkbox" checked={aguardar} onChange={(e) => setAguardar(e.target.checked)} /> Aguardar retorno do solicitante
                        </label>
                      ) : <span />}
                      <Button size="sm" disabled={!texto.trim() || !!ocupado}
                        onClick={() => rodar("enviar", () => (modo === "resposta" ? ti.responder(id, texto, aguardar) : ti.comentar(id, texto))).then((ok) => ok && setTexto(""))}>
                        {ocupado === "enviar" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                        {modo === "resposta" ? "Enviar resposta" : "Comentar"}
                      </Button>
                    </div>
                  </div>
                )}
                {t.solucao && (
                  <div className="rounded-xl border border-success/30 bg-success/5 p-3 text-sm">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-success"><CheckCircle2 className="size-3.5" /> Solução registrada</p>
                    <p className="whitespace-pre-wrap">{t.solucao}</p>
                  </div>
                )}
                {erro && <p className="text-sm text-destructive">{erro}</p>}
              </div>

              <aside className="space-y-3 text-sm">
                <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">SLA ({t.sla_horas}h)</p>
                  <SlaInfo minutos={t.sla_restante_min} estourado={t.sla_estourado} resolvido={!!t.resolvido_em} />
                  <p className="text-xs text-muted-foreground">Prazo: {dataHora(t.prazo_sla)}</p>
                  <p className="text-xs text-muted-foreground">1ª resposta: {t.primeira_resposta_em ? dataHora(t.primeira_resposta_em) : "ainda não"}</p>
                  {!fechado && (
                    <select className={selectCls} value={t.prioridade} aria-label="Prioridade"
                      onChange={(e) => rodar("prioridade", () => ti.prioridade(id, e.target.value))}>
                      {(Object.keys(PRIORIDADE) as PrioridadeChamado[]).map((p) => <option key={p} value={p}>Prioridade {PRIORIDADE[p].label} ({PRIORIDADE[p].sla}h)</option>)}
                    </select>
                  )}
                </div>

                <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Atendimento</p>
                  <p className="flex items-center gap-1.5">
                    <Bot className="size-4 text-muted-foreground" />
                    <span className="font-medium">{t.agente_nome || "sem agente"}</span>
                    {t.agente_status === "working" && <span className="text-xs text-success">trabalhando</span>}
                  </p>
                  {t.task && (
                    <div className="text-xs text-muted-foreground">
                      <p>Task #{t.task} · {TASK_STATUS[t.task_status] ?? t.task_status}</p>
                      {t.task_progresso != null && (
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(t.task_progresso * 100)}%` }} />
                        </div>
                      )}
                    </div>
                  )}
                  {!fechado && (
                    <select className={selectCls} value="" aria-label="Reatribuir"
                      onChange={(e) => e.target.value && rodar("atribuir", () => ti.atribuir(id, e.target.value))}>
                      <option value="">Passar para…</option>
                      {PAPEIS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  )}
                </div>

                {!fechado ? (
                  <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
                    <Input value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)} placeholder="Orientação pra IA (opcional)" className="h-8 text-xs" />
                    <Button className="w-full" size="sm" variant="outline" disabled={!!ocupado}
                      onClick={() => rodar("ia", () => ti.atenderIA(id, instrucoes)).then((ok) => ok && setInstrucoes(""))}>
                      {ocupado === "ia" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Atender com IA
                    </Button>
                    {solucao === null ? (
                      <Button className="w-full" size="sm" disabled={!!ocupado} onClick={() => setSolucao("")}>
                        <CheckCircle2 className="size-3.5" /> Resolver
                      </Button>
                    ) : (
                      <div className="space-y-1.5">
                        <Textarea rows={3} autoFocus value={solucao} onChange={(e) => setSolucao(e.target.value)} placeholder="Qual foi a causa e o que resolveu?" />
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => setSolucao(null)}><X className="size-3.5" /></Button>
                          <Button size="sm" className="flex-1" disabled={!solucao.trim() || !!ocupado}
                            onClick={() => rodar("resolver", () => ti.resolver(id, solucao)).then((ok) => ok && setSolucao(null))}>
                            Confirmar (aprova a Task)
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" disabled={!!ocupado} onClick={() => rodar("reabrir", () => ti.reabrir(id))}>
                      <RotateCcw className="size-3.5" /> Reabrir
                    </Button>
                    {t.status === "resolvido" && (
                      <Button size="sm" className="flex-1" disabled={!!ocupado} onClick={() => rodar("fechar", () => ti.fechar(id))}>Fechar</Button>
                    )}
                  </div>
                )}
                <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <User className="mt-0.5 size-3 shrink-0" /> A IA só sugere. Responder e resolver são sempre de uma pessoa.
                </p>
              </aside>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
