// frontend/src/components/empresa/marketing/publicacoes.tsx — fila, editor, IA e plano
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Bot, CalendarPlus, CheckCircle2, ExternalLink, Loader2, Plus, RotateCcw, Send, Sparkles, Trash2, Upload, Wand2, X as XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { marketing, type ContaSocial, type Midia, type Publicacao, type PublicacaoInput } from "@/lib/api";
import {
  Campo, FORMATOS_POST, MidiaThumb, REDES, RedeIcon, STATUS, Tag, deLocal, erroMsg, paraLocal, quando, selectCls,
} from "@/components/empresa/marketing/shared";

// ─── Seleção de contas ───────────────────────────────────────────────────────

export function EscolherContas({ contas, valor, onChange }: { contas: ContaSocial[]; valor: number[]; onChange: (ids: number[]) => void }) {
  if (!contas.length) return <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">Nenhuma conta conectada ainda — conecte em <b>Contas</b>. Dá pra escrever e planejar mesmo assim.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {contas.map((c) => {
        const on = valor.includes(c.id);
        return (
          <button key={c.id} type="button" onClick={() => onChange(on ? valor.filter((v) => v !== c.id) : [...valor, c.id])}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground hover:bg-secondary"}`}>
            <RedeIcon rede={c.rede} className="size-3.5" /> {c.nome}
            {c.status !== "conectada" && <AlertTriangle className="size-3 text-warning" />}
          </button>
        );
      })}
    </div>
  );
}

// ─── Biblioteca (escolher mídia) ─────────────────────────────────────────────

export function EscolherMidia({ selecionadas, onClose, onEscolher }: { selecionadas: number[]; onClose: () => void; onEscolher: (ids: number[]) => void }) {
  const [midias, setMidias] = useState<Midia[] | null>(null);
  const [sel, setSel] = useState<number[]>(selecionadas);
  const [enviando, setEnviando] = useState(false);
  const carregar = () => marketing.midias().then(setMidias).catch(() => setMidias([]));
  useEffect(() => { void carregar(); }, []);
  const enviar = async (files: FileList | null) => {
    if (!files?.length) return;
    setEnviando(true);
    try {
      for (const f of Array.from(files)) {
        const m = await marketing.enviarMidia(f);
        setSel((s) => [...s, m.id]);
      }
      await carregar();
    } catch (e) { toast.error(erroMsg(e)); } finally { setEnviando(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Escolher imagem ou vídeo</DialogTitle>
          <DialogDescription>Criativos, cortes, vídeos da IA e arquivos enviados. A ordem de clique é a ordem do carrossel.</DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground hover:bg-secondary">
          {enviando ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Enviar do computador
          <input type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => void enviar(e.target.files)} />
        </label>
        <div className="grid max-h-[55vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
          {midias === null ? <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Carregando…</p>
            : midias.length === 0 ? <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Biblioteca vazia.</p>
            : midias.map((m) => {
              const i = sel.indexOf(m.id);
              return (
                <div key={m.id} className="relative">
                  <MidiaThumb midia={m} selecionada={i >= 0} onClick={() => setSel(i >= 0 ? sel.filter((x) => x !== m.id) : [...sel, m.id])} />
                  {i >= 0 && <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{i + 1}</span>}
                </div>
              );
            })}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => { onEscolher(sel); onClose(); }}>Usar {sel.length ? `(${sel.length})` : ""}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function Contador({ n, limite }: { n: number; limite: number | null }) {
  if (!limite) return null;
  const cls = n > limite ? "text-destructive font-semibold" : n > limite * 0.9 ? "text-warning" : "text-muted-foreground";
  return <span className={`text-[11px] tabular-nums ${cls}`}>{n}/{limite}</span>;
}

export function EditorPublicacao({ id, inicial, contas, onClose, onChanged }: {
  id?: number;
  inicial?: PublicacaoInput;
  contas: ContaSocial[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pub, setPub] = useState<Publicacao | null>(null);
  const [f, setF] = useState<PublicacaoInput>({ titulo: "", texto: "", formato: "post", hashtags: "", link: "", contas: [], midias_ids: [], agendada_para: null, ...inicial });
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [aba, setAba] = useState<string>("base");
  const [busy, setBusy] = useState<string | null>(null);
  const [erros, setErros] = useState<string[] | null>(null);
  const [biblioteca, setBiblioteca] = useState(false);
  const [instrucoes, setInstrucoes] = useState("");

  const aplicar = useCallback((p: Publicacao) => {
    setPub(p);
    setF({ titulo: p.titulo, texto: p.texto, formato: p.formato, hashtags: p.hashtags, link: p.link, pilar: p.pilar, gancho: p.gancho,
      agendada_para: p.agendada_para, contas: p.destinos.map((d) => d.conta), midias_ids: p.midias_ids, observacoes: p.observacoes });
    setTextos(Object.fromEntries(p.destinos.map((d) => [String(d.conta), d.texto])));
    if (p.avisos?.length) setErros(p.avisos);
  }, []);
  useEffect(() => { if (id) marketing.publicacao(id).then(aplicar).catch((e) => toast.error(erroMsg(e))); }, [id, aplicar]);

  const travada = pub ? ["publicando", "publicada"].includes(pub.status) : false;
  const destinosSel = contas.filter((c) => f.contas?.includes(c.id));
  const set = <K extends keyof PublicacaoInput>(k: K, v: PublicacaoInput[K]) => setF((s) => ({ ...s, [k]: v }));

  const salvar = async (silencioso = false): Promise<Publicacao | null> => {
    if (!f.titulo?.trim()) { toast.error("Dê um título (uso interno) à publicação."); return null; }
    setBusy("salvar");
    try {
      const corpo = { ...f, textos };
      const p = pub ? await marketing.salvarPublicacao(pub.id, corpo) : await marketing.criarPublicacao(corpo);
      aplicar(p);
      onChanged();
      if (!silencioso) toast.success("Salvo.");
      return p;
    } catch (e) { toast.error(erroMsg(e)); return null; } finally { setBusy(null); }
  };

  const acao = async (nome: string, fn: (id: number) => Promise<Publicacao>, ok: string) => {
    const p = await salvar(true);
    if (!p) return;
    setBusy(nome);
    try {
      const r = await fn(p.id);
      aplicar(r);
      onChanged();
      toast.success(ok);
      setErros(r.avisos ?? null);
    } catch (e) {
      const msg = erroMsg(e);
      setErros(msg.split(" · "));
      toast.error("Não deu: veja os avisos.");
    } finally { setBusy(null); }
  };

  const conferir = async () => {
    const p = await salvar(true);
    if (!p) return;
    const r = await marketing.conferir(p.id);
    setErros(r.erros.length ? r.erros : []);
  };

  const status = pub ? STATUS[pub.status] : STATUS.rascunho;
  const destinoTexto = (contaId: number) => textos[String(contaId)] ?? "";
  const textoFinal = (contaId: number) => destinoTexto(contaId) || pub?.destinos.find((d) => d.conta === contaId)?.texto_final || f.texto || "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {pub ? "Publicação" : "Nova publicação"} <Tag tone={status.tone}>{status.label}</Tag>
            {pub?.escrita_por_ia && <Tag tone="violet"><Bot className="size-3" /> {pub.agente_nome || "IA"}</Tag>}
          </DialogTitle>
          <DialogDescription>
            A IA escreve; publicar é sempre decisão de uma pessoa. Editar algo já aprovado volta pra aprovação.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
              <Campo label="Título (uso interno / título do YouTube)">
                <Input value={f.titulo ?? ""} onChange={(e) => set("titulo", e.target.value)} disabled={travada} placeholder="Ex.: 3 erros no delivery" />
              </Campo>
              <Campo label="Formato">
                <select className={selectCls} value={f.formato} onChange={(e) => set("formato", e.target.value as Publicacao["formato"])} disabled={travada}>
                  {FORMATOS_POST.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Campo>
            </div>

            <Campo label="Onde publicar">
              <EscolherContas contas={contas} valor={f.contas ?? []} onChange={(v) => set("contas", v)} />
            </Campo>

            <div className="rounded-xl border border-border">
              <div className="flex gap-1 overflow-x-auto border-b border-border p-1">
                <button type="button" onClick={() => setAba("base")} className={`rounded-md px-2.5 py-1 text-xs ${aba === "base" ? "bg-secondary font-medium" : "text-muted-foreground"}`}>Texto base</button>
                {destinosSel.map((c) => (
                  <button key={c.id} type="button" onClick={() => setAba(String(c.id))}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs ${aba === String(c.id) ? "bg-secondary font-medium" : "text-muted-foreground"}`}>
                    <RedeIcon rede={c.rede} className="size-3" /> {REDES[c.rede].nome}
                    {destinoTexto(c.id) && <span className="size-1.5 rounded-full bg-primary" title="texto próprio" />}
                  </button>
                ))}
              </div>
              <div className="space-y-2 p-3">
                {aba === "base" ? (
                  <>
                    <Textarea rows={8} value={f.texto ?? ""} onChange={(e) => set("texto", e.target.value)} disabled={travada}
                      placeholder="Texto que vai pra todas as redes (cada rede pode ter o seu na aba dela)." />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input value={f.hashtags ?? ""} onChange={(e) => set("hashtags", e.target.value)} disabled={travada} placeholder="#hashtags (entram no fim, se faltarem)" />
                      <Input value={f.link ?? ""} onChange={(e) => set("link", e.target.value)} disabled={travada} placeholder="https://link (onde o link é clicável)" />
                    </div>
                  </>
                ) : (() => {
                  const c = contas.find((x) => String(x.id) === aba);
                  if (!c) return null;
                  const d = pub?.destinos.find((x) => x.conta === c.id);
                  const limite = d?.limite ?? null;
                  return (
                    <>
                      <Textarea rows={8} value={destinoTexto(c.id)} disabled={travada}
                        onChange={(e) => setTextos((t) => ({ ...t, [String(c.id)]: e.target.value }))}
                        placeholder={`Vazio = usa o texto base (+ hashtags e link). Escreva aqui um texto só pro ${REDES[c.rede].nome}.`} />
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{REDES[c.rede].dica}</span>
                        <Contador n={textoFinal(c.id).length} limite={limite} />
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            <Campo label="Imagens / vídeo">
              <div className="flex flex-wrap items-center gap-2">
                {(f.midias_ids ?? []).map((mid) => (
                  <div key={mid} className="relative w-20">
                    <MidiaThumb midia={{ id: mid, tipo: pub?.midias_info.find((x) => x.id === mid)?.tipo ?? "imagem", titulo: "" }} />
                    {!travada && (
                      <button type="button" onClick={() => set("midias_ids", (f.midias_ids ?? []).filter((x) => x !== mid))}
                        className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-destructive text-white"><XIcon className="size-3" /></button>
                    )}
                  </div>
                ))}
                {!travada && <Button type="button" variant="outline" size="sm" onClick={() => setBiblioteca(true)}><Plus className="size-3.5" /> Mídia</Button>}
              </div>
            </Campo>

            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Quando publicar" help="Vazio = publica assim que aprovar.">
                <Input type="datetime-local" value={paraLocal(f.agendada_para ?? null)} onChange={(e) => set("agendada_para", deLocal(e.target.value))} disabled={travada} />
              </Campo>
              <Campo label="Observações internas">
                <Input value={f.observacoes ?? ""} onChange={(e) => set("observacoes", e.target.value)} />
              </Campo>
            </div>
          </div>

          <aside className="space-y-3">
            {pub?.ideia_visual && (
              <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 text-xs">
                <p className="mb-1 font-semibold text-violet-700 dark:text-violet-300">Ideia visual da IA</p>
                <p className="text-muted-foreground">{pub.ideia_visual}</p>
              </div>
            )}
            {!travada && (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-violet-500" /> Copywriter (IA)</p>
                <Input value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)} placeholder="Orientação (opcional): mais curto, tom divertido…" />
                <Button size="sm" variant="outline" className="w-full" disabled={!!busy}
                  onClick={() => void acao("ia", (i) => marketing.escreverPost(i, { instrucoes }), "Texto escrito — revise antes de aprovar.")}>
                  {busy === "ia" ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} {f.texto ? "Reescrever" : "Escrever"} pra cada rede
                </Button>
              </div>
            )}

            {erros && (
              erros.length ? (
                <div className="space-y-1 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs">
                  <p className="flex items-center gap-1 font-semibold text-warning"><AlertTriangle className="size-3.5" /> Antes de publicar</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-foreground/80">{erros.map((e) => <li key={e}>{e}</li>)}</ul>
                </div>
              ) : <p className="flex items-center gap-1.5 rounded-xl border border-success/30 bg-success/10 p-3 text-xs text-success"><CheckCircle2 className="size-3.5" /> Tudo certo pra publicar.</p>
            )}

            {pub && pub.destinos.length > 0 && ["publicada", "parcial", "erro", "publicando"].includes(pub.status) && (
              <div className="space-y-1.5 rounded-xl border border-border p-3">
                <p className="text-sm font-semibold">Resultado por rede</p>
                {pub.destinos.map((d) => (
                  <div key={d.id} className="text-xs">
                    <div className="flex items-center gap-1.5">
                      <RedeIcon rede={d.rede} className="size-3.5" />
                      <span className="min-w-0 flex-1 truncate">{d.conta_nome}</span>
                      <Tag tone={d.status === "publicado" ? "ok" : d.status === "erro" ? "error" : "muted"}>{d.status}</Tag>
                      {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="text-primary"><ExternalLink className="size-3.5" /></a>}
                    </div>
                    {d.erro && <p className={`mt-0.5 pl-5 ${d.status === "erro" ? "text-destructive" : "text-muted-foreground"}`}>{d.erro}</p>}
                  </div>
                ))}
              </div>
            )}

            {pub?.aprovada_por && <p className="text-[11px] text-muted-foreground">Aprovada por {pub.aprovada_por}{pub.aprovada_em ? ` em ${quando(pub.aprovada_em)}` : ""}.</p>}

            <div className="flex flex-col gap-2">
              {!travada && <Button variant="outline" disabled={!!busy} onClick={() => void salvar()}>{busy === "salvar" && <Loader2 className="size-3.5 animate-spin" />} Salvar</Button>}
              {!travada && <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void conferir()}>Conferir limites e mídia</Button>}
              {(!pub || ["rascunho", "erro", "cancelada"].includes(pub.status)) && (
                <Button variant="outline" disabled={!!busy} onClick={() => void acao("rev", marketing.paraRevisao, "Enviada pra aprovação.")}><Send className="size-3.5" /> Enviar pra aprovação</Button>
              )}
              {(!pub || ["rascunho", "revisao", "cancelada"].includes(pub.status)) && (
                <>
                  <Button disabled={!!busy || !f.contas?.length} onClick={() => void acao("aprovar", (i) => marketing.aprovar(i), f.agendada_para ? "Aprovada — sai no horário marcado." : "Aprovada — publicando.")}>
                    {busy === "aprovar" ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                    {f.agendada_para ? "Aprovar e agendar" : "Aprovar e publicar agora"}
                  </Button>
                  {f.agendada_para && (
                    <Button variant="secondary" disabled={!!busy || !f.contas?.length} onClick={() => void acao("agora", (i) => marketing.aprovar(i, true), "Aprovada — publicando agora.")}>Aprovar e publicar agora</Button>
                  )}
                </>
              )}
              {pub && ["erro", "parcial"].includes(pub.status) && pub.aprovada_em && (
                <Button disabled={!!busy} onClick={() => void acao("de-novo", marketing.tentarDeNovo, "Tentando de novo nas redes que falharam.")}><RotateCcw className="size-3.5" /> Tentar de novo (só as que falharam)</Button>
              )}
              {pub && pub.status === "agendada" && (
                <Button variant="outline" disabled={!!busy} onClick={() => void acao("voltar", marketing.voltarRascunho, "Voltou pra rascunho.")}>Desfazer aprovação</Button>
              )}
              {pub && !travada && pub.status !== "cancelada" && (
                <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={!!busy} onClick={() => void acao("cancelar", marketing.cancelar, "Cancelada.")}>Cancelar publicação</Button>
              )}
            </div>
          </aside>
        </div>
        {biblioteca && <EscolherMidia selecionadas={f.midias_ids ?? []} onClose={() => setBiblioteca(false)} onEscolher={(ids) => set("midias_ids", ids)} />}
      </DialogContent>
    </Dialog>
  );
}

// ─── Novo post com IA ────────────────────────────────────────────────────────

export function NovoPostIA({ contas, inicial, onClose, onCriado }: {
  contas: ContaSocial[];
  inicial?: { agendada_para?: string | null; midias?: number[]; tema?: string; formato?: string };
  onClose: () => void;
  onCriado: (p: Publicacao) => void;
}) {
  const [tema, setTema] = useState(inicial?.tema ?? "");
  const [formato, setFormato] = useState(inicial?.formato ?? "post");
  const [sel, setSel] = useState<number[]>(contas.filter((c) => c.status === "conectada").map((c) => c.id));
  const [quandoV, setQuando] = useState(paraLocal(inicial?.agendada_para ?? null));
  const [instrucoes, setInstrucoes] = useState("");
  const [busy, setBusy] = useState(false);
  const gerar = async () => {
    setBusy(true);
    try {
      const p = await marketing.gerarPost({ tema, contas: sel, formato, instrucoes, agendada_para: deLocal(quandoV), midias: inicial?.midias });
      toast.success("Rascunho escrito pelo Copywriter.");
      onCriado(p);
    } catch (e) { toast.error(erroMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-violet-500" /> Novo post com IA</DialogTitle>
          <DialogDescription>O Copywriter escreve um texto pra cada rede, com o perfil da sua marca e o que está no cérebro do setor. Sai como rascunho.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Campo label="Sobre o quê?">
            <Textarea rows={3} value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Ex.: lançamento do projeto X — o que ele resolve e como testar" />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Formato">
              <select className={selectCls} value={formato} onChange={(e) => setFormato(e.target.value)}>
                {FORMATOS_POST.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Campo>
            <Campo label="Quando (opcional)"><Input type="datetime-local" value={quandoV} onChange={(e) => setQuando(e.target.value)} /></Campo>
          </div>
          <Campo label="Redes"><EscolherContas contas={contas} valor={sel} onChange={setSel} /></Campo>
          <Campo label="Orientação (opcional)"><Input value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)} placeholder="Ex.: termina convidando pro Discord" /></Campo>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void gerar()} disabled={busy || !tema.trim()}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} Escrever</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Planejar período ────────────────────────────────────────────────────────

export function PlanejarDialog({ contas, onClose, onPronto }: { contas: ContaSocial[]; onClose: () => void; onPronto: () => void }) {
  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [inicio, setInicio] = useState(amanha);
  const [semanas, setSemanas] = useState(4);
  const [porSemana, setPorSemana] = useState(3);
  const [sel, setSel] = useState<number[]>(contas.filter((c) => c.status === "conectada").map((c) => c.id));
  const [objetivo, setObjetivo] = useState("");
  const [escrever, setEscrever] = useState(true);
  const [busy, setBusy] = useState(false);
  const planejar = async () => {
    setBusy(true);
    try {
      const r = await marketing.planejar({ inicio, semanas, por_semana: porSemana, contas: sel, objetivo, escrever });
      toast.success(`${r.criadas.length} publicações no calendário${escrever ? (r.enfileirado ? " — o Copywriter está escrevendo os textos." : " com os textos escritos.") : "."}`);
      onPronto();
      onClose();
    } catch (e) { toast.error(erroMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarPlus className="size-4" /> Planejar as próximas semanas</DialogTitle>
          <DialogDescription>
            O Estrategista distribui os pilares da marca no calendário (tema, gancho, formato e rede de cada dia). Tudo nasce rascunho —
            você aprova em lote na Fila.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Campo label="A partir de"><Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></Campo>
            <Campo label="Semanas"><Input type="number" min={1} max={8} value={semanas} onChange={(e) => setSemanas(Number(e.target.value))} /></Campo>
            <Campo label="Posts por semana"><Input type="number" min={1} max={14} value={porSemana} onChange={(e) => setPorSemana(Number(e.target.value))} /></Campo>
          </div>
          <Campo label="Contas do plano"><EscolherContas contas={contas} valor={sel} onChange={setSel} /></Campo>
          <Campo label="Objetivo do período" help="Ex.: mostrar meus projetos e atrair clientes de desenvolvimento web; lançar o curso em março.">
            <Textarea rows={2} value={objetivo} onChange={(e) => setObjetivo(e.target.value)} />
          </Campo>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={escrever} onChange={(e) => setEscrever(e.target.checked)} /> O Copywriter já escreve o texto de cada post
          </label>
          <p className="text-xs text-muted-foreground">{semanas * porSemana} publicações · cada texto é uma chamada à IA do setor (custo entra no orçamento do Marketing).</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void planejar()} disabled={busy || !sel.length}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Planejar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Fila ────────────────────────────────────────────────────────────────────

const FILTROS: { id: string; label: string; status?: string }[] = [
  { id: "aprovar", label: "Pra aprovar", status: "rascunho,revisao" },
  { id: "agendadas", label: "Agendadas", status: "agendada" },
  { id: "erro", label: "Com erro", status: "erro,parcial" },
  { id: "publicadas", label: "Publicadas", status: "publicada" },
  { id: "todas", label: "Todas" },
];

export function FilaTab({ reloadKey, onChanged, abrir, novoIA }: {
  reloadKey: number;
  onChanged: () => void;
  abrir: (id?: number) => void;
  novoIA: () => void;
}) {
  const [filtro, setFiltro] = useState("aprovar");
  const [lista, setLista] = useState<Publicacao[] | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const carregar = useCallback(async () => {
    const st = FILTROS.find((x) => x.id === filtro)?.status;
    const todas = await marketing.publicacoes("&ordering=agendada_para");
    setLista(st ? todas.filter((p) => st.split(",").includes(p.status)) : todas);
    setSel([]);
  }, [filtro]);
  useEffect(() => { void carregar().catch(() => setLista([])); }, [carregar, reloadKey]);

  const lote = async (tipo: "aprovar" | "escrever" | "excluir") => {
    setBusy(true);
    try {
      if (tipo === "aprovar") {
        const r = await marketing.aprovarLote(sel);
        const n = Object.keys(r.erros).length;
        toast[n ? "warning" : "success"](`${r.aprovadas.length} aprovada(s)${n ? ` · ${n} com pendência (abra pra ver)` : ""}.`);
      } else if (tipo === "escrever") {
        const r = await marketing.escreverLote(sel);
        toast.success(r.enfileirado ? "O Copywriter está escrevendo — atualize em instantes." : "Textos escritos.");
      } else {
        await Promise.all(sel.map((i) => marketing.removerPublicacao(i)));
        toast.success("Excluídas.");
      }
      onChanged();
      await carregar();
    } catch (e) { toast.error(erroMsg(e)); } finally { setBusy(false); }
  };

  const vazias = useMemo(() => (lista ?? []).filter((p) => !p.texto.trim()).length, [lista]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-secondary p-1">
          {FILTROS.map((x) => (
            <button key={x.id} onClick={() => setFiltro(x.id)} className={`rounded-md px-2.5 py-1 text-xs ${filtro === x.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>{x.label}</button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => abrir()}><Plus className="size-3.5" /> Em branco</Button>
          <Button size="sm" onClick={novoIA}><Sparkles className="size-3.5" /> Novo post com IA</Button>
        </div>
      </div>

      {sel.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{sel.length} selecionada(s)</span>
          <Button size="sm" disabled={busy} onClick={() => void lote("aprovar")}><CheckCircle2 className="size-3.5" /> Aprovar</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void lote("escrever")}><Wand2 className="size-3.5" /> IA escrever</Button>
          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void lote("excluir")}><Trash2 className="size-3.5" /> Excluir</Button>
        </div>
      )}
      {filtro === "aprovar" && vazias > 0 && (
        <p className="text-xs text-muted-foreground">{vazias} item(ns) do plano ainda sem texto — selecione e clique em “IA escrever”.</p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {lista === null ? <p className="p-8 text-center text-sm text-muted-foreground">Carregando…</p>
          : lista.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Nada aqui.</p>
          : (
            <ul className="divide-y divide-border">
              {lista.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/50">
                  <input type="checkbox" checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />
                  <button type="button" onClick={() => abrir(p.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">{quando(p.agendada_para)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.titulo}</span>
                      <span className="block truncate text-xs text-muted-foreground">{p.texto || (p.gancho ? `Gancho: ${p.gancho}` : "sem texto ainda")}</span>
                    </span>
                    <span className="hidden shrink-0 gap-1 sm:flex">{[...new Set(p.destinos.map((d) => d.rede))].map((r) => <RedeIcon key={r} rede={r} className="size-3.5" />)}</span>
                    {p.escrita_por_ia && <Bot className="size-3.5 shrink-0 text-violet-500" aria-label="IA" />}
                    <Tag tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Tag>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
