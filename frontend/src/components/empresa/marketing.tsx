// frontend/src/components/empresa/marketing.tsx
//
// Setor Marketing — time de conteúdo pra qualquer ramo: calendário editorial,
// posts por rede escritos pela IA, criativos por formato, cortes de vídeo e
// vídeo curto (MoneyPrinterTurbo), publicação nas 8 redes com aprovação humana.
// Cada aba vive em components/empresa/marketing/.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Clapperboard, Gauge, Images, ListChecks, Megaphone, Palette, Share2, Sparkles, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { marketing, type ContaSocial, type PublicacaoInput, type TimeMarketing } from "@/lib/api";
import { PainelTab } from "@/components/empresa/marketing/painel";
import { CalendarioTab } from "@/components/empresa/marketing/calendario";
import { EditorPublicacao, FilaTab, NovoPostIA, PlanejarDialog } from "@/components/empresa/marketing/publicacoes";
import { BibliotecaTab, CriativosTab } from "@/components/empresa/marketing/criativos";
import { VideosTab } from "@/components/empresa/marketing/videos";
import { ContasTab } from "@/components/empresa/marketing/contas";
import { MarcaTab } from "@/components/empresa/marketing/marca";

const TABS = [
  { id: "painel", label: "Painel", icon: Gauge },
  { id: "calendario", label: "Calendário", icon: CalendarDays },
  { id: "fila", label: "Fila", icon: ListChecks },
  { id: "criativos", label: "Criativos", icon: Palette },
  { id: "videos", label: "Vídeos e cortes", icon: Clapperboard },
  { id: "biblioteca", label: "Biblioteca", icon: Images },
  { id: "contas", label: "Contas", icon: Share2 },
  { id: "marca", label: "Marca", icon: Store },
] as const;
type Tab = (typeof TABS)[number]["id"];
const TAB_KEY = "pgba_marketing_tab";

export function MarketingView({ onBack }: { onBack: () => void }) {
  const [tab, setTabState] = useState<Tab>(() => {
    try { return (sessionStorage.getItem(TAB_KEY) as Tab) || "painel"; } catch { return "painel"; }
  });
  const [reload, setReload] = useState(0);
  const [contas, setContas] = useState<ContaSocial[]>([]);
  const [time, setTime] = useState<TimeMarketing | null>(null);
  const [editor, setEditor] = useState<{ id?: number; inicial?: PublicacaoInput } | null>(null);
  const [novoIA, setNovoIA] = useState<{ agendada_para?: string | null; midias?: number[]; tema?: string; formato?: string } | null>(null);
  const [planejar, setPlanejar] = useState(false);

  const setTab = (t: string) => {
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* aba privada */ }
    setTabState(t as Tab);
  };
  const changed = useCallback(() => setReload((r) => r + 1), []);
  const carregarTime = useCallback(() => { marketing.time().then(setTime).catch(() => setTime(null)); }, []);
  useEffect(() => { marketing.contas().then(setContas).catch(() => setContas([])); }, [reload]);
  useEffect(() => { carregarTime(); }, [carregarTime, reload]);

  const usarEmPost = (ids: number[], titulo: string, legenda?: string) => {
    setEditor({ inicial: { titulo, texto: legenda ?? "", midias_ids: ids, formato: "post", contas: contas.filter((c) => c.status === "conectada").map((c) => c.id) } });
  };
  const trabalhando = time?.agentes.filter((a) => a.work_status === "working") ?? [];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-gradient-to-r from-secondary via-pink-500/10 to-transparent px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onBack} className="grid size-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-secondary" title="Voltar">
            <ArrowLeft className="size-4" />
          </button>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-pink-500/15 text-pink-600 dark:text-pink-400"><Megaphone className="size-5" /></span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold">Marketing</h2>
            <p className="text-xs text-muted-foreground">
              Calendário, textos por rede, criativos, cortes e publicação — a IA faz, você aprova
              {trabalhando.length > 0 && <span className="text-success"> · {trabalhando.map((a) => a.nome).join(", ")} trabalhando</span>}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPlanejar(true)}><CalendarDays className="size-3.5" /> Planejar semanas</Button>
            <Button size="sm" onClick={() => setNovoIA({})}><Sparkles className="size-3.5" /> Novo post com IA</Button>
          </div>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-secondary p-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${tab === t.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "painel" && <PainelTab reloadKey={reload} onGo={setTab} time={time} recarregarTime={() => { carregarTime(); changed(); }} planejar={() => setPlanejar(true)} abrir={(id) => setEditor({ id })} />}
      {tab === "calendario" && (
        <CalendarioTab reloadKey={reload} abrir={(id) => setEditor({ id })} planejar={() => setPlanejar(true)}
          novoNoDia={(dia) => setNovoIA({ agendada_para: new Date(`${dia}T12:00`).toISOString() })} />
      )}
      {tab === "fila" && <FilaTab reloadKey={reload} onChanged={changed} abrir={(id) => setEditor({ id })} novoIA={() => setNovoIA({})} />}
      {tab === "criativos" && <CriativosTab usarEmPost={usarEmPost} onChanged={changed} />}
      {tab === "videos" && <VideosTab reloadKey={reload} usarEmPost={(ids, titulo, legenda) => setEditor({ inicial: { titulo, texto: legenda ?? "", midias_ids: ids, formato: "reels", contas: contas.filter((c) => ["instagram", "tiktok", "youtube"].includes(c.rede) && c.status === "conectada").map((c) => c.id) } })} />}
      {tab === "biblioteca" && <BibliotecaTab reloadKey={reload} usarEmPost={usarEmPost} />}
      {tab === "contas" && <ContasTab onChanged={changed} />}
      {tab === "marca" && <MarcaTab onChanged={changed} />}

      {editor && <EditorPublicacao id={editor.id} inicial={editor.inicial} contas={contas} onClose={() => setEditor(null)} onChanged={changed} />}
      {novoIA && (
        <NovoPostIA contas={contas} inicial={novoIA} onClose={() => setNovoIA(null)}
          onCriado={(p) => { setNovoIA(null); changed(); setEditor({ id: p.id }); }} />
      )}
      {planejar && <PlanejarDialog contas={contas} onClose={() => setPlanejar(false)} onPronto={() => { changed(); setTab("calendario"); }} />}
    </div>
  );
}
