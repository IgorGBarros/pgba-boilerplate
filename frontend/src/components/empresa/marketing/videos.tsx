// frontend/src/components/empresa/marketing/videos.tsx — cortes de vídeo longo + vídeo curto com IA (MoneyPrinterTurbo)
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clapperboard, Film, Loader2, Scissors, Send, Settings2, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CredentialCard } from "@/components/admin/shared";
import { listServiceCredentials, marketing, type JobVideo, type Midia, type ProntidaoMarketing, type ServiceCredentialInfo } from "@/lib/api";
import { Campo, MidiaPlayer, MidiaThumb, Tag, erroMsg, selectCls } from "@/components/empresa/marketing/shared";

const ATIVO = ["na_fila", "baixando", "transcrevendo", "analisando", "cortando", "gerando"];
const VOZES = [
  ["pt-BR-FranciscaNeural-Female", "Francisca (feminina)"],
  ["pt-BR-ThalitaMultilingualNeural-Female", "Thalita (feminina)"],
  ["pt-BR-AntonioNeural-Male", "Antônio (masculina)"],
];

function Corte({ m, usar }: { m: Midia; usar: () => void }) {
  const [ver, setVer] = useState(false);
  const d = m.dados as { inicio?: number; fim?: number; nota?: number; gancho?: string; motivo?: string };
  return (
    <div className="space-y-1.5 rounded-xl border border-border bg-background p-2">
      <MidiaThumb midia={m} className="aspect-[9/16]" onClick={() => setVer(true)} />
      <p className="line-clamp-2 text-xs font-medium">{m.titulo}</p>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="tabular-nums">{d.inicio != null ? `${Math.floor(d.inicio / 60)}:${String(Math.round(d.inicio % 60)).padStart(2, "0")}` : ""} · {Math.round(m.duracao)}s</span>
        {d.nota != null && <Tag tone={d.nota >= 8 ? "ok" : d.nota >= 5 ? "info" : "muted"}>nota {d.nota}</Tag>}
      </div>
      <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={usar}><Send className="size-3" /> Publicar</Button>
      {ver && (
        <Dialog open onOpenChange={(o) => !o && setVer(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{m.titulo}</DialogTitle>
              <DialogDescription>{d.motivo || "Corte vertical com legenda."}</DialogDescription>
            </DialogHeader>
            <MidiaPlayer midia={m} />
            {m.legenda_sugerida && <p className="whitespace-pre-wrap rounded-lg bg-secondary p-2 text-xs">{m.legenda_sugerida}</p>}
            <Button onClick={() => { setVer(false); usar(); }}><Send className="size-3.5" /> Criar publicação (Reels · TikTok · Shorts)</Button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function JobCard({ job, onRemover, usar }: { job: JobVideo; onRemover: () => void; usar: (m: Midia) => void }) {
  const ativo = ATIVO.includes(job.status);
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        {job.tipo === "cortes" ? <Scissors className="size-4 text-muted-foreground" /> : <Film className="size-4 text-muted-foreground" />}
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{job.titulo || job.origem_url || "Vídeo"}</p>
        <Tag tone={job.status === "concluido" ? "ok" : job.status === "erro" ? "error" : "violet"}>{job.status_nome}</Tag>
        {!ativo && <button onClick={onRemover} className="text-muted-foreground hover:text-destructive" title="Excluir"><Trash2 className="size-3.5" /></button>}
      </div>
      {ativo && (
        <div className="mt-2 space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${Math.max(job.progresso, 3)}%` }} /></div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> {job.etapa || "Na fila"} {job.agente_nome && `· ${job.agente_nome}`}</p>
        </div>
      )}
      {job.status === "erro" && <p className="mt-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{job.erro}</p>}
      {job.midias.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
          {job.midias.map((m) => <Corte key={m.id} m={m} usar={() => usar(m)} />)}
        </div>
      )}
    </div>
  );
}

function MoneyPrinterConfig({ onClose }: { onClose: () => void }) {
  const [cred, setCred] = useState<ServiceCredentialInfo | undefined>();
  const load = () => listServiceCredentials().then((l) => setCred(l.find((c) => c.provider === "moneyprinter"))).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>MoneyPrinterTurbo</DialogTitle>
          <DialogDescription>
            Gerador de vídeo curto aberto (MIT) que roda como serviço separado: <code>docker compose --profile marketing up -d moneyprinter</code>.
            O roteiro vai pronto daqui; ele monta com vídeos do Pexels (chave grátis no config.toml dele), narração e legenda.
          </DialogDescription>
        </DialogHeader>
        <CredentialCard provider="moneyprinter" current={cred} title="API do MoneyPrinterTurbo" accountLabel="URL da API"
          accountPlaceholder="http://moneyprinter:8080" tokenLabel="api_key (config.toml)" tokenOptional
          accountHelp="Na rede interna do Docker, libere o host em CONNECTORS_ALLOWED_PRIVATE_HOSTS=moneyprinter."
          tokenPlaceholder="a mesma do config.toml" onChanged={() => void load()} />
      </DialogContent>
    </Dialog>
  );
}

export function VideosTab({ reloadKey, usarEmPost }: { reloadKey: number; usarEmPost: (ids: number[], titulo: string, legenda?: string) => void }) {
  const [jobs, setJobs] = useState<JobVideo[]>([]);
  const [pront, setPront] = useState<ProntidaoMarketing | null>(null);
  // cortes
  const [fonte, setFonte] = useState<"url" | "arquivo">("url");
  const [url, setUrl] = useState("");
  const [arquivo, setArquivo] = useState<Midia | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [qtd, setQtd] = useState(5);
  const [minimo, setMinimo] = useState(20);
  const [maximo, setMaximo] = useState(60);
  const [estilo, setEstilo] = useState("desfocado");
  const [legenda, setLegenda] = useState(true);
  const [direitos, setDireitos] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // vídeo IA
  const [tema, setTema] = useState("");
  const [segundos, setSegundos] = useState(45);
  const [roteiro, setRoteiro] = useState("");
  const [termos, setTermos] = useState("");
  const [tituloV, setTituloV] = useState("");
  const [legendaPost, setLegendaPost] = useState("");
  const [voz, setVoz] = useState(VOZES[0][0]);
  const [proporcao, setProporcao] = useState("9:16");
  const [config, setConfig] = useState(false);

  const carregar = useCallback(() => marketing.jobs().then(setJobs).catch(() => undefined), []);
  useEffect(() => { void carregar(); marketing.prontidao().then(setPront).catch(() => undefined); }, [carregar, reloadKey, config]);
  const temAtivo = jobs.some((j) => ATIVO.includes(j.status));
  useEffect(() => {
    if (!temAtivo) return;
    const t = setInterval(() => void carregar(), 3000);
    return () => clearInterval(t);
  }, [temAtivo, carregar]);

  const cortar = async () => {
    setBusy("cortes");
    try {
      await marketing.cortes({ ...(fonte === "url" ? { url } : { midia: arquivo?.id }), direitos, quantidade: qtd, minimo, maximo, estilo, legenda, gancho: legenda });
      toast.success("O Editor de Vídeo começou — acompanhe abaixo.");
      setUrl(""); setArquivo(null); setDireitos(false);
      await carregar();
    } catch (e) { toast.error(erroMsg(e)); } finally { setBusy(null); }
  };
  const enviar = async (f: File | undefined) => {
    if (!f) return;
    setEnviando(true);
    try { setArquivo(await marketing.enviarMidia(f)); } catch (e) { toast.error(erroMsg(e)); } finally { setEnviando(false); }
  };
  const gerarRoteiro = async () => {
    setBusy("roteiro");
    try {
      const r = await marketing.roteiro(tema, segundos);
      setRoteiro(r.roteiro); setTermos(r.termos.join(", ")); setTituloV(r.titulo);
      setLegendaPost([r.legenda, (r.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n"));
    } catch (e) { toast.error(erroMsg(e)); } finally { setBusy(null); }
  };
  const gerarVideo = async () => {
    setBusy("video");
    try {
      await marketing.videoIA({ titulo: tituloV || tema, roteiro, termos: termos.split(",").map((x) => x.trim()).filter(Boolean), proporcao, voz, legenda: true, musica: true, legenda_post: legendaPost });
      toast.success("Enviado pro MoneyPrinterTurbo — leva alguns minutos.");
      await carregar();
    } catch (e) { toast.error(erroMsg(e)); } finally { setBusy(null); }
  };

  const usar = (m: Midia) => usarEmPost([m.id], m.titulo, m.legenda_sugerida);

  return (
    <div className="space-y-4">
      {pront && !pront.ffmpeg && (
        <p className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="size-4" /> ffmpeg não está instalado no servidor — cortes não funcionam (o Dockerfile do backend já instala).</p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Scissors className="size-4" /> Cortes de um vídeo longo</p>
          <p className="text-xs text-muted-foreground">Live, podcast, aula ou vídeo do seu canal → o Editor de Vídeo acha os melhores trechos e entrega verticais (9:16) com legenda, prontos pra Reels, TikTok e Shorts.</p>
          <div className="flex gap-1 rounded-lg bg-secondary p-1 text-xs">
            <button onClick={() => setFonte("url")} className={`flex-1 rounded-md py-1 ${fonte === "url" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>Link do YouTube / Twitch</button>
            <button onClick={() => setFonte("arquivo")} className={`flex-1 rounded-md py-1 ${fonte === "arquivo" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>Arquivo</button>
          </div>
          {fonte === "url" ? (
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
          ) : (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground hover:bg-secondary">
              {enviando ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {arquivo ? `${arquivo.titulo} · ${Math.round(arquivo.duracao / 60)} min` : "Escolher vídeo (até 500 MB)"}
              <input type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => void enviar(e.target.files?.[0])} />
            </label>
          )}
          <div className="grid grid-cols-3 gap-2">
            <Campo label="Cortes"><Input type="number" min={1} max={12} value={qtd} onChange={(e) => setQtd(Number(e.target.value))} /></Campo>
            <Campo label="Mín. (s)"><Input type="number" min={8} max={120} value={minimo} onChange={(e) => setMinimo(Number(e.target.value))} /></Campo>
            <Campo label="Máx. (s)"><Input type="number" min={15} max={180} value={maximo} onChange={(e) => setMaximo(Number(e.target.value))} /></Campo>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Campo label="Enquadramento">
              <select className={selectCls} value={estilo} onChange={(e) => setEstilo(e.target.value)}>
                <option value="desfocado">Vídeo inteiro + fundo desfocado</option>
                <option value="centro">Recortar o centro (tela cheia)</option>
              </select>
            </Campo>
            <label className="flex items-end gap-2 pb-2 text-xs"><input type="checkbox" checked={legenda} onChange={(e) => setLegenda(e.target.checked)} /> Legenda + gancho na tela</label>
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={direitos} onChange={(e) => setDireitos(e.target.checked)} />
            <span>O vídeo é da empresa (ou temos autorização do dono). Cortar conteúdo de terceiros sem autorização viola direito autoral e os termos do YouTube.</span>
          </label>
          {pront && !pront.transcricao && <p className="text-[11px] text-muted-foreground">Sem credencial da Groq/OpenAI, só dá pra cortar vídeo que já tem legenda (a do YouTube serve). Com uma delas, o áudio é transcrito (Whisper).</p>}
          <Button className="w-full" disabled={!!busy || !direitos || (fonte === "url" ? !url.trim() : !arquivo)} onClick={() => void cortar()}>
            {busy === "cortes" ? <Loader2 className="size-3.5 animate-spin" /> : <Scissors className="size-3.5" />} Fazer cortes
          </Button>
        </div>

        <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Clapperboard className="size-4" /> Vídeo curto com IA</p>
            <Button size="sm" variant="ghost" onClick={() => setConfig(true)}><Settings2 className="size-3.5" /> {pront?.moneyprinter ? "MoneyPrinterTurbo" : "Configurar"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">Tema → roteiro narrado (Editor de Vídeo) → MoneyPrinterTurbo monta com banco de vídeos, voz e legenda.</p>
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <Input value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Tema do vídeo" />
            <Input type="number" min={15} max={180} value={segundos} onChange={(e) => setSegundos(Number(e.target.value))} title="segundos" />
          </div>
          <Button size="sm" variant="outline" className="w-full" disabled={!!busy || !tema.trim()} onClick={() => void gerarRoteiro()}>
            {busy === "roteiro" ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} Escrever roteiro
          </Button>
          <Textarea rows={5} value={roteiro} onChange={(e) => setRoteiro(e.target.value)} placeholder="Roteiro narrado (gere com a IA ou escreva)" />
          <Input value={termos} onChange={(e) => setTermos(e.target.value)} placeholder="palavras-chave em inglês pro banco de vídeos: bakery, bread, …" />
          <div className="grid grid-cols-2 gap-2">
            <select className={selectCls} value={voz} onChange={(e) => setVoz(e.target.value)}>{VOZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <select className={selectCls} value={proporcao} onChange={(e) => setProporcao(e.target.value)}>
              <option value="9:16">9:16 — Reels, TikTok, Shorts</option><option value="1:1">1:1 — feed</option><option value="16:9">16:9 — YouTube</option>
            </select>
          </div>
          {!pront?.moneyprinter && <p className="text-[11px] text-warning">MoneyPrinterTurbo ainda não configurado — clique em Configurar.</p>}
          <Button className="w-full" disabled={!!busy || !roteiro.trim() || !termos.trim() || !pront?.moneyprinter} onClick={() => void gerarVideo()}>
            {busy === "video" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Gerar vídeo
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold">Trabalhos</p>
        {jobs.length === 0 ? <p className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">Nenhum vídeo processado ainda.</p>
          : jobs.map((j) => <JobCard key={j.id} job={j} usar={usar} onRemover={async () => { await marketing.removerJob(j.id); void carregar(); }} />)}
      </div>
      {config && <MoneyPrinterConfig onClose={() => setConfig(false)} />}
    </div>
  );
}
