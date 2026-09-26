// frontend/src/components/empresa/marketing/criativos.tsx — criativos por formato + biblioteca
import { useEffect, useState } from "react";
import { Download, ImagePlus, Loader2, Palette, Send, Trash2, Upload, Wand2, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { marketing, type Midia, type OpcoesCriativo, type TextosCriativo } from "@/lib/api";
import { EscolherMidia } from "@/components/empresa/marketing/publicacoes";
import { Campo, MidiaPlayer, MidiaThumb, Tag, baixarMidia, erroMsg } from "@/components/empresa/marketing/shared";

const DESCR: Record<string, string> = {
  destaque: "Título grande, subtítulo e chamada",
  citacao: "Frase em evidência com autor",
  lista: "Carrossel: capa, um ponto por lâmina, CTA",
  oferta: "Número/benefício em destaque",
};

export function CriativosTab({ usarEmPost, onChanged }: { usarEmPost: (ids: number[], titulo: string) => void; onChanged: () => void }) {
  const [op, setOp] = useState<OpcoesCriativo | null>(null);
  const [modelo, setModelo] = useState("destaque");
  const [formatos, setFormatos] = useState<string[]>(["quadrado", "vertical"]);
  const [tema, setTema] = useState("");
  const [t, setT] = useState<TextosCriativo>({});
  const [laminas, setLaminas] = useState(4);
  const [fundo, setFundo] = useState<number | null>(null);
  const [escolherFundo, setEscolherFundo] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [gerados, setGerados] = useState<Midia[]>([]);
  useEffect(() => { marketing.opcoesCriativo().then(setOp).catch(() => undefined); }, []);

  const gerar = async (ia: boolean) => {
    setBusy(ia ? "ia" : "gerar");
    try {
      const r = await marketing.criarCriativo({ modelo, formatos, textos: ia ? {} : t, usar_ia: ia, tema, laminas, fundo });
      setT(r.textos);
      setGerados(r.midias);
      onChanged();
      toast.success(`${r.midias.length} imagem(ns) prontas.`);
    } catch (e) { toast.error(erroMsg(e)); } finally { setBusy(null); }
  };
  const setCampo = (k: keyof TextosCriativo, v: string) => setT((s) => ({ ...s, [k]: v }));

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Palette className="size-4" /> Criativo</p>
        <div className="grid grid-cols-2 gap-2">
          {(op?.modelos ?? []).map((m) => (
            <button key={m.chave} type="button" onClick={() => setModelo(m.chave)}
              className={`rounded-lg border p-2 text-left text-xs transition ${modelo === m.chave ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"}`}>
              <span className="block font-medium capitalize">{m.chave === "lista" ? "Carrossel" : m.chave === "citacao" ? "Citação" : m.chave}</span>
              <span className="text-muted-foreground">{DESCR[m.chave]}</span>
            </button>
          ))}
        </div>
        <Campo label="Formatos (um arquivo por formato)">
          <div className="space-y-1">
            {(op?.formatos ?? []).map((f) => (
              <label key={f.chave} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={formatos.includes(f.chave)} onChange={(e) => setFormatos(e.target.checked ? [...formatos, f.chave] : formatos.filter((x) => x !== f.chave))} />
                <span className="w-20 tabular-nums text-muted-foreground">{f.largura}×{f.altura}</span> {f.nome.split(" — ")[1] ?? f.nome}
              </label>
            ))}
          </div>
        </Campo>
        <div className="space-y-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
          <Campo label="Tema (o Designer escreve o texto)">
            <Input value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Ex.: por que usar fermentação natural" />
          </Campo>
          {modelo === "lista" && (
            <Campo label="Lâminas de conteúdo"><Input type="number" min={1} max={10} value={laminas} onChange={(e) => setLaminas(Number(e.target.value))} /></Campo>
          )}
          <Button size="sm" className="w-full" disabled={!!busy || !tema.trim() || !formatos.length} onClick={() => void gerar(true)}>
            {busy === "ia" ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} Criar com IA
          </Button>
        </div>
        <details className="rounded-xl border border-border p-3" open={!!t.titulo}>
          <summary className="cursor-pointer text-xs font-medium">Escrever/ajustar o texto à mão</summary>
          <div className="mt-2 space-y-2">
            <Input value={t.kicker ?? ""} onChange={(e) => setCampo("kicker", e.target.value)} placeholder="Rótulo (ex.: DICA DA SEMANA)" />
            <Input value={t.titulo ?? ""} onChange={(e) => setCampo("titulo", e.target.value)} placeholder="Título *" />
            <Input value={t.subtitulo ?? ""} onChange={(e) => setCampo("subtitulo", e.target.value)} placeholder="Subtítulo" />
            {modelo === "oferta" && <Input value={t.destaque ?? ""} onChange={(e) => setCampo("destaque", e.target.value)} placeholder="Destaque (ex.: -30%)" />}
            {modelo === "citacao" && <Input value={t.autor ?? ""} onChange={(e) => setCampo("autor", e.target.value)} placeholder="Autor da frase" />}
            <Input value={t.cta ?? ""} onChange={(e) => setCampo("cta", e.target.value)} placeholder="Chamada (ex.: Peça pelo WhatsApp)" />
            {modelo === "lista" && (
              <Textarea rows={4} value={(t.laminas ?? []).map((l) => `${l.titulo} | ${l.texto}`).join("\n")}
                onChange={(e) => setT((s) => ({ ...s, laminas: e.target.value.split("\n").filter(Boolean).map((ln) => { const [a, ...b] = ln.split("|"); return { titulo: a.trim(), texto: b.join("|").trim() }; }) }))}
                placeholder={"Uma lâmina por linha: título | texto"} />
            )}
            <div className="flex items-center gap-2">
              {fundo ? (
                <div className="relative w-14"><MidiaThumb midia={{ id: fundo, tipo: "imagem", titulo: "fundo" }} />
                  <button type="button" onClick={() => setFundo(null)} className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-destructive text-white"><XIcon className="size-3" /></button></div>
              ) : <Button type="button" size="sm" variant="outline" onClick={() => setEscolherFundo(true)}><ImagePlus className="size-3.5" /> Foto de fundo</Button>}
              <span className="text-[11px] text-muted-foreground">Cores e logo vêm do perfil da marca.</span>
            </div>
            <Button size="sm" variant="outline" className="w-full" disabled={!!busy || !t.titulo?.trim() || !formatos.length} onClick={() => void gerar(false)}>
              {busy === "gerar" && <Loader2 className="size-3.5 animate-spin" />} Gerar com este texto
            </Button>
          </div>
        </details>
      </div>
      <div className="space-y-3">
        {gerados.length ? (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Gerados agora</p>
              <Button size="sm" onClick={() => usarEmPost(gerados.map((g) => g.id), t.titulo ?? "Criativo")}><Send className="size-3.5" /> Usar numa publicação</Button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {gerados.map((m) => (
                <div key={m.id} className="space-y-1">
                  <MidiaThumb midia={m} className={m.altura > m.largura ? "aspect-[9/16]" : m.largura > m.altura * 1.3 ? "aspect-video" : "aspect-square"} onClick={() => void baixarMidia(m)} />
                  <p className="flex items-center justify-between text-[11px] text-muted-foreground"><span>{m.formato} · {m.largura}×{m.altura}</span><Download className="size-3" /></p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="grid h-full min-h-60 place-items-center rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Escolha o modelo e os formatos e diga o tema — o Designer escreve o texto e as imagens saem nas medidas de cada rede,
            com as cores e o logo da sua marca.
          </div>
        )}
      </div>
      {escolherFundo && <EscolherMidia selecionadas={[]} onClose={() => setEscolherFundo(false)} onEscolher={(ids) => setFundo(ids[0] ?? null)} />}
    </div>
  );
}

export function BibliotecaTab({ reloadKey, usarEmPost }: { reloadKey: number; usarEmPost: (ids: number[], titulo: string) => void }) {
  const [lista, setLista] = useState<Midia[] | null>(null);
  const [filtro, setFiltro] = useState("");
  const [ver, setVer] = useState<Midia | null>(null);
  const [enviando, setEnviando] = useState(false);
  const carregar = () => marketing.midias(filtro).then(setLista).catch(() => setLista([]));
  useEffect(() => { void carregar(); }, [filtro, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const enviar = async (files: FileList | null) => {
    if (!files?.length) return;
    setEnviando(true);
    try { for (const f of Array.from(files)) await marketing.enviarMidia(f); await carregar(); toast.success("Enviado."); }
    catch (e) { toast.error(erroMsg(e)); } finally { setEnviando(false); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-secondary p-1">
          {[["", "Tudo"], ["&origem=criativo", "Criativos"], ["&origem=corte", "Cortes"], ["&origem=video_ia", "Vídeos IA"], ["&origem=upload", "Enviados"]].map(([v, l]) => (
            <button key={l} onClick={() => setFiltro(v)} className={`rounded-md px-2.5 py-1 text-xs ${filtro === v ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>{l}</button>
          ))}
        </div>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
          {enviando ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Enviar arquivos
          <input type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => void enviar(e.target.files)} />
        </label>
      </div>
      {lista === null ? <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p> : !lista.length ? (
        <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">Nada ainda. Crie criativos, corte vídeos ou envie arquivos.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {lista.map((m) => (
            <div key={m.id} className="space-y-1">
              <MidiaThumb midia={m} onClick={() => setVer(m)} />
              <p className="truncate text-[11px]" title={m.titulo}>{m.titulo || "sem título"}</p>
            </div>
          ))}
        </div>
      )}
      {ver && (
        <Dialog open onOpenChange={(o) => !o && setVer(null)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">{ver.titulo || "Mídia"} <Tag>{ver.origem_nome}</Tag></DialogTitle>
              <DialogDescription>{ver.largura}×{ver.altura}{ver.duracao ? ` · ${Math.round(ver.duracao)}s` : ""} · {(ver.tamanho / 1024 / 1024).toFixed(1)} MB</DialogDescription>
            </DialogHeader>
            <MidiaPlayer midia={ver} />
            {ver.legenda_sugerida && <p className="whitespace-pre-wrap rounded-lg bg-secondary p-2 text-xs">{ver.legenda_sugerida}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" className="text-destructive" onClick={async () => { await marketing.removerMidia(ver.id); setVer(null); void carregar(); }}><Trash2 className="size-3.5" /> Excluir</Button>
              <Button variant="outline" onClick={() => void baixarMidia(ver)}><Download className="size-3.5" /> Baixar</Button>
              <Button onClick={() => { usarEmPost([ver.id], ver.titulo); setVer(null); }}><Send className="size-3.5" /> Usar numa publicação</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
