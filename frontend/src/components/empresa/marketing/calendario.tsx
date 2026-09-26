// frontend/src/components/empresa/marketing/calendario.tsx — calendário editorial do mês
import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { marketing, type Publicacao } from "@/lib/api";
import { RedeIcon, STATUS } from "@/components/empresa/marketing/shared";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function CalendarioTab({ reloadKey, abrir, novoNoDia, planejar }: {
  reloadKey: number;
  abrir: (id: number) => void;
  novoNoDia: (dia: string) => void;
  planejar: () => void;
}) {
  const [mes, setMes] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [pubs, setPubs] = useState<Publicacao[]>([]);
  const grade = useMemo(() => {
    const ini = new Date(mes);
    ini.setDate(1 - ini.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(ini); d.setDate(ini.getDate() + i); return d; });
  }, [mes]);
  useEffect(() => {
    marketing.publicacoes(`&de=${iso(grade[0])}&ate=${iso(grade[41])}`).then(setPubs).catch(() => setPubs([]));
  }, [grade, reloadKey]);
  const porDia = useMemo(() => {
    const m: Record<string, Publicacao[]> = {};
    for (const p of pubs) {
      if (!p.agendada_para || p.status === "cancelada") continue;
      const k = iso(new Date(p.agendada_para));
      (m[k] ??= []).push(p);
    }
    Object.values(m).forEach((l) => l.sort((a, b) => (a.agendada_para ?? "").localeCompare(b.agendada_para ?? "")));
    return m;
  }, [pubs]);
  const hoje = iso(new Date());
  const semanasVazias = useMemo(() => {
    let n = 0;
    for (let s = 0; s < 6; s++) {
      const dias = grade.slice(s * 7, s * 7 + 7);
      if (dias.every((d) => d.getMonth() !== mes.getMonth())) continue;
      // só conta semana que ainda tem pelo menos 3 dias pela frente
      if (dias.filter((d) => iso(d) >= hoje).length >= 3 && !dias.some((d) => porDia[iso(d)]?.length)) n++;
    }
    return n;
  }, [grade, porDia, mes, hoje]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="ghost" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}><ChevronLeft className="size-4" /></Button>
        <h3 className="min-w-40 text-center font-display text-lg font-semibold">{(() => { const t = mes.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); return t.charAt(0).toUpperCase() + t.slice(1); })()}</h3>
        <Button size="icon" variant="ghost" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}><ChevronRight className="size-4" /></Button>
        <Button size="sm" variant="ghost" onClick={() => { const d = new Date(); setMes(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Hoje</Button>
        {semanasVazias > 0 && <span className="text-xs text-warning">{semanasVazias} semana(s) sem nada marcado</span>}
        <div className="ml-auto flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          {(["rascunho", "revisao", "agendada", "publicada", "erro"] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1"><span className={`size-2 rounded-full ${STATUS[s].dot}`} />{STATUS[s].label}</span>
          ))}
        </div>
        <Button size="sm" onClick={planejar}><CalendarPlus className="size-3.5" /> Planejar com IA</Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="grid grid-cols-7 border-b border-border bg-secondary/60 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {DIAS.map((d) => <div key={d} className="py-1.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {grade.map((d) => {
            const k = iso(d);
            const fora = d.getMonth() !== mes.getMonth();
            const itens = porDia[k] ?? [];
            const passado = k < hoje;
            return (
              <div key={k} className={`group min-h-28 border-b border-r border-border p-1.5 ${fora ? "bg-secondary/30" : ""}`}>
                <div className="mb-1 flex items-center justify-between">
                  <span className={`grid size-6 place-items-center rounded-full text-xs ${k === hoje ? "bg-primary font-semibold text-primary-foreground" : fora ? "text-muted-foreground/60" : "text-muted-foreground"}`}>{d.getDate()}</span>
                  {!passado && (
                    <button type="button" onClick={() => novoNoDia(k)} title="Novo post nesse dia"
                      className="grid size-5 place-items-center rounded text-muted-foreground opacity-0 transition hover:bg-secondary group-hover:opacity-100"><Plus className="size-3.5" /></button>
                  )}
                </div>
                <div className="space-y-1">
                  {itens.slice(0, 4).map((p) => (
                    <button key={p.id} type="button" onClick={() => abrir(p.id)} title={`${STATUS[p.status].label} · ${p.titulo}`}
                      className="flex w-full items-center gap-1 rounded-md border border-border bg-background px-1.5 py-1 text-left text-[11px] leading-tight hover:border-primary/50">
                      <span className={`size-1.5 shrink-0 rounded-full ${STATUS[p.status].dot}`} />
                      <span className="shrink-0 tabular-nums text-muted-foreground">{new Date(p.agendada_para!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="min-w-0 flex-1 truncate">{p.titulo}</span>
                      <span className="flex shrink-0 gap-0.5">{[...new Set(p.destinos.map((x) => x.rede))].slice(0, 3).map((r) => <RedeIcon key={r} rede={r} className="size-2.5" />)}</span>
                    </button>
                  ))}
                  {itens.length > 4 && <p className="px-1 text-[10px] text-muted-foreground">+{itens.length - 4}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
