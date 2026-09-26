// frontend/src/components/empresa/ti/incidentes.tsx
//
// Incidentes do monitoramento: o que caiu, quando, por quanto tempo, a causa
// que a verificação viu e o diagnóstico do time de TI (fatos [F#] citados).
import { useCallback, useEffect, useState } from "react";
import { Eye, Loader2, Sparkles, Ticket as TicketIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ti, type Incidente } from "@/lib/api";
import { ComCitacoes, Fatos, GRUPOS, SAUDE, Tag, Vazio, dataHora, duracao, erroTexto, relativo } from "@/components/empresa/ti/shared";

const GRAVIDADE: Record<Incidente["gravidade"], "error" | "warn" | "info" | "muted"> = { critica: "error", alta: "warn", media: "info", baixa: "muted" };

export function IncidentesTab({ reloadKey, abrirChamado }: { reloadKey: number; abrirChamado: (id: number) => void }) {
  const [filtro, setFiltro] = useState<"" | "aberto" | "resolvido">("");
  const [lista, setLista] = useState<Incidente[] | null>(null);
  const [aberto, setAberto] = useState<number | null>(null);

  const carregar = useCallback(() => { ti.incidentes(filtro || undefined).then(setLista).catch(() => setLista([])); }, [filtro]);
  useEffect(carregar, [carregar, reloadKey]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg bg-secondary p-1 text-xs sm:w-fit">
        {([["", "Todos"], ["aberto", "Abertos"], ["resolvido", "Resolvidos"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setFiltro(v)}
            className={`rounded-md px-2.5 py-1 ${filtro === v ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>{l}</button>
        ))}
      </div>
      {lista === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando…</p>
      ) : lista.length === 0 ? (
        <Vazio>Nenhum incidente. Um componente precisa falhar 2 verificações seguidas pra virar incidente.</Vazio>
      ) : (
        <ol className="relative space-y-2 border-l border-border pl-4">
          {lista.map((i) => (
            <li key={i.id} className="relative">
              <span className={`absolute -left-[21px] top-3.5 size-2.5 rounded-full ring-4 ring-background ${i.status === "aberto" ? SAUDE.falha.dot : SAUDE.ok.dot}`} />
              <button type="button" onClick={() => setAberto(i.id)}
                className="w-full rounded-xl border border-border bg-surface p-3 text-left transition hover:bg-secondary/50">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{i.titulo}</span>
                  <Tag tone={GRAVIDADE[i.gravidade]}>{i.gravidade}</Tag>
                  <Tag tone={i.status === "aberto" ? "error" : "ok"}>{i.status === "aberto" ? "em andamento" : "resolvido"}</Tag>
                  {i.plataforma && <Tag>plataforma</Tag>}
                  {i.diagnostico?.causa_provavel && <Tag tone="violet"><Sparkles className="size-3" /> diagnosticado</Tag>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {GRUPOS[i.grupo] ?? i.grupo} · começou {dataHora(i.aberto_em)} · {i.status === "aberto" ? `há ${duracao(i.duracao_min)}` : `durou ${duracao(i.duracao_min)}`}
                  {i.reconhecido_por && <> · visto por {i.reconhecido_por}</>}
                </p>
                {i.causa && <p className="mt-1 text-sm">{i.causa}</p>}
              </button>
            </li>
          ))}
        </ol>
      )}
      {aberto && <IncidenteDetalhe id={aberto} onClose={() => setAberto(null)} onChanged={carregar} abrirChamado={abrirChamado} />}
    </div>
  );
}

export function Disponibilidade({ amostras }: { amostras: NonNullable<Incidente["amostras"]> }) {
  if (!amostras.length) return null;
  return (
    <div>
      <div className="flex h-6 gap-px overflow-hidden rounded-md">
        {amostras.map((a, k) => (
          <span key={k} title={`${dataHora(a.em)} · ${SAUDE[a.status].label}${a.ms != null ? ` · ${a.ms} ms` : ""}`}
            className={`min-w-[2px] flex-1 ${SAUDE[a.status].dot}`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{dataHora(amostras[0].em)}</span><span>{dataHora(amostras[amostras.length - 1].em)}</span>
      </div>
    </div>
  );
}

export function IncidenteDetalhe({ id, onClose, onChanged, abrirChamado }: {
  id: number; onClose: () => void; onChanged: () => void; abrirChamado: (id: number) => void;
}) {
  const [i, setI] = useState<Incidente | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const carregar = useCallback(() => { ti.incidente(id).then(setI).catch((e) => setErro(erroTexto(e))); }, [id]);
  useEffect(carregar, [carregar]);

  const rodar = async (nome: string, fn: () => Promise<unknown>) => {
    setOcupado(nome); setErro("");
    try { await fn(); carregar(); onChanged(); } catch (e) { setErro(erroTexto(e)); } finally { setOcupado(""); }
  };
  const d = i?.diagnostico;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {!i ? (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {erro || "Carregando…"}</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                {i.titulo}
                <Tag tone={GRAVIDADE[i.gravidade]}>{i.gravidade}</Tag>
                <Tag tone={i.status === "aberto" ? "error" : "ok"}>{i.status === "aberto" ? "em andamento" : "resolvido"}</Tag>
              </DialogTitle>
              <DialogDescription>
                Começou {dataHora(i.aberto_em)}{i.resolvido_em ? ` · voltou ${dataHora(i.resolvido_em)}` : ""} · {duracao(i.duracao_min)}
                {i.dados?.registrado_depois ? " · registrado quando o banco voltou (a queda não pôde ser gravada na hora)" : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              {i.dados?.registrado_depois ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  Sem amostras durante a queda: com o banco fora nada pôde ser gravado. O início veio da anotação feita no Redis na hora.
                </p>
              ) : i.amostras && <Disponibilidade amostras={i.amostras} />}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-surface p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Por que (verificação)</p>
                  <p className="mt-1">{i.causa || "A verificação não identificou a causa."}</p>
                  {i.detalhe && <p className="mt-1 break-words font-mono text-xs text-muted-foreground">{i.detalhe}</p>}
                </div>
                <div className="rounded-xl border border-border bg-surface p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">O que fazer</p>
                  <p className="mt-1">{i.acao || "—"}</p>
                </div>
              </div>

              <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                    <Sparkles className="size-3.5" /> Diagnóstico do time de TI
                    {d?.agente && <span className="font-normal text-muted-foreground">— {d.agente.nome}{d.gerado_em ? `, ${relativo(d.gerado_em)}` : ""}</span>}
                  </p>
                  <Button size="sm" variant="outline" disabled={!!ocupado} onClick={() => rodar("diag", () => ti.diagnosticar(id))}>
                    {ocupado === "diag" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                    {d?.causa_provavel ? "Diagnosticar de novo" : "Diagnosticar agora"}
                  </Button>
                </div>
                {d?.causa_provavel ? (
                  <div className="space-y-2">
                    <p><span className="font-medium">Causa provável: </span><ComCitacoes texto={d.causa_provavel} fatos={d.fatos} /></p>
                    {!!d.evidencias?.length && <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">{d.evidencias.map((e, k) => <li key={k}><ComCitacoes texto={e} fatos={d.fatos} /></li>)}</ul>}
                    {d.impacto && <p><span className="font-medium">Impacto: </span><ComCitacoes texto={d.impacto} fatos={d.fatos} /></p>}
                    {!!d.acoes?.length && <div><p className="font-medium">Passos (uma pessoa executa)</p><ol className="list-decimal space-y-0.5 pl-5">{d.acoes.map((a, k) => <li key={k}>{a}</li>)}</ol></div>}
                    {!!d.prevencao?.length && <div><p className="font-medium">Prevenção</p><ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">{d.prevencao.map((a, k) => <li key={k}>{a}</li>)}</ul></div>}
                    {!!d.citacoes_invalidas?.length && <p className="text-[11px] text-warning">Citação a fato inexistente removida: {d.citacoes_invalidas.join(", ")}</p>}
                    <Fatos fatos={d.fatos} />
                  </div>
                ) : d?.erro ? (
                  <p className="text-sm text-warning">O diagnóstico automático não saiu: {d.erro}</p>
                ) : (
                  <p className="text-muted-foreground">Ainda sem diagnóstico. O SRE/DBA/Integrações lê o estado dos componentes, erros e métricas e explica a causa com fatos.</p>
                )}
              </div>

              {erro && <p className="text-destructive">{erro}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                {!i.reconhecido_em && i.status === "aberto" && (
                  <Button size="sm" variant="outline" disabled={!!ocupado} onClick={() => rodar("rec", () => ti.reconhecer(id))}>
                    <Eye className="size-3.5" /> Estou olhando
                  </Button>
                )}
                {i.chamado_id && (
                  <Button size="sm" disabled={!!ocupado} onClick={() => rodar("chamado", async () => {
                    // Incidente da plataforma abre um chamado em cada empresa: pega o desta
                    const [c] = await ti.chamados({ incidente_id: String(i.id) });
                    if (!c) throw new Error("Esta empresa não tem chamado pra esse incidente.");
                    onClose();
                    abrirChamado(c.id);
                  })}>
                    <TicketIcon className="size-3.5" /> Abrir o chamado
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
