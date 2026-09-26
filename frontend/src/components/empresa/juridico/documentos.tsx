// frontend/src/components/empresa/juridico/documentos.tsx — Documentos, modelos e assinatura eletrônica
import { useCallback, useEffect, useState } from "react";
import {
  Ban, Check, Copy, Eye, FilePlus2, FileSignature, FileText, Fingerprint, Loader2, Mail, Plus, Send, ShieldCheck,
  Trash2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErpCrud, type FieldDef } from "@/components/empresa/erp-crud";
import { dataBR, relationOptions, type Option } from "@/components/empresa/erp-utils";
import {
  cancelarAssinatura, criarAssinatura, criarModelosPadrao, deleteDocumentoJuridico, eventosAssinatura, gerarDocumento,
  getEmailOverview, linksAssinatura, listAssinaturas, listDocumentosJuridicos, listModelos, reenviarConvite,
  uploadDocumentoJuridico, type DocumentoJuridico, type ModeloDocumento, type NovoSignatario, type SolicitacaoAssinatura,
} from "@/lib/api";
import { openAdminPanel } from "@/lib/adminPanel";
import { PdfViewer, TIPO_DOC, Tag, label } from "@/components/empresa/juridico/shared";

const STATUS_DOC = { rascunho: ["Rascunho", "muted"], final: ["Versão final", "info"], em_assinatura: ["Em assinatura", "violet"], assinado: ["Assinado", "ok"] } as const;
const fmtDT = (d: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: Option[]; placeholder: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ─── Novo documento (modelo ou PDF) ──────────────────────────────────────────

function NovoDocumento({ onClose, onCreated }: { onClose: () => void; onCreated: (d: DocumentoJuridico) => void }) {
  const [modo, setModo] = useState<"modelo" | "pdf">("modelo");
  const [modelos, setModelos] = useState<ModeloDocumento[]>([]);
  const [rel, setRel] = useState<{ processos: Option[]; contratos: Option[]; parceiros: Option[] }>({ processos: [], contratos: [], parceiros: [] });
  const [f, setF] = useState({ modelo: "", titulo: "", processo: "", contrato: "", parceiro: "", tipo: "contrato" });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { listModelos().then(setModelos).catch(() => setModelos([])); }, []);
  useEffect(() => {
    load();
    Promise.all([relationOptions("processos_juridicos", true), relationOptions("contratos_juridicos", true), relationOptions("parceiros")])
      .then(([processos, contratos, parceiros]) => setRel({ processos, contratos, parceiros }))
      .catch(() => undefined);
  }, [load]);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const salvar = async () => {
    setBusy(true);
    try {
      if (modo === "modelo") {
        const doc = await gerarDocumento(Number(f.modelo), {
          titulo: f.titulo || undefined, processo: f.processo ? Number(f.processo) : null,
          contrato: f.contrato ? Number(f.contrato) : null, parceiro: f.parceiro ? Number(f.parceiro) : null,
        });
        if (doc.faltando.length) toast.warning(`Ficaram campos sem dado: ${doc.faltando.join(", ")}. Revise o texto antes de enviar.`);
        else toast.success("Documento gerado.");
        onCreated(doc);
      } else {
        const form = new FormData();
        form.append("titulo", f.titulo || arquivo?.name.replace(/\.pdf$/i, "") || "Documento");
        form.append("tipo", f.tipo);
        if (f.processo) form.append("processo", f.processo);
        if (f.contrato) form.append("contrato", f.contrato);
        if (arquivo) form.append("arquivo", arquivo);
        onCreated(await uploadDocumentoJuridico(form));
        toast.success("PDF enviado.");
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Novo documento</DialogTitle>
          <DialogDescription>Gere de um modelo (preenchido com os dados do processo/contrato/parte) ou envie um PDF pronto.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {([["modelo", "De um modelo", FilePlus2], ["pdf", "Enviar PDF", Upload]] as const).map(([id, l, Icon]) => (
            <button key={id} type="button" onClick={() => setModo(id)} aria-pressed={modo === id}
              className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${modo === id ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground"}`}>
              <Icon className="size-4" /> {l}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {modo === "modelo" ? (
            <>
              {modelos.length === 0 ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border p-3 text-sm">
                  <span className="text-muted-foreground">Nenhum modelo ainda.</span>
                  <Button size="sm" variant="outline" onClick={async () => { const r = await criarModelosPadrao(); toast.success(`${r.criados} modelo(s) criados.`); load(); }}>Criar modelos padrão</Button>
                </div>
              ) : (
                <Select value={f.modelo} onChange={(v) => set("modelo", v)} placeholder="Escolha o modelo…" options={modelos.map((m) => ({ value: String(m.id), label: m.nome }))} />
              )}
            </>
          ) : (
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border p-3 text-sm hover:border-foreground/30">
              <Upload className="size-4" />
              <span className="flex-1 truncate">{arquivo ? arquivo.name : "Escolher PDF (até 20 MB)"}</span>
              <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            </label>
          )}
          <Input value={f.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="Título (opcional)" />
          {modo === "pdf" && <Select value={f.tipo} onChange={(v) => set("tipo", v)} placeholder="Tipo" options={TIPO_DOC} />}
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={f.processo} onChange={(v) => set("processo", v)} placeholder="Processo (opcional)" options={rel.processos} />
            <Select value={f.contrato} onChange={(v) => set("contrato", v)} placeholder="Contrato (opcional)" options={rel.contratos} />
          </div>
          {modo === "modelo" && <Select value={f.parceiro} onChange={(v) => set("parceiro", v)} placeholder="Parte / parceiro (opcional)" options={rel.parceiros} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={busy || (modo === "modelo" ? !f.modelo : !arquivo)}>{busy && <Loader2 className="size-3.5 animate-spin" />} Criar documento</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Enviar para assinatura ──────────────────────────────────────────────────

const PAPEIS: [string, string][] = [["parte", "Parte"], ["representante", "Representante legal"], ["testemunha", "Testemunha"], ["aprovador", "Aprovador"]];

function EnviarAssinatura({ doc, onClose, onDone }: { doc: DocumentoJuridico; onClose: () => void; onDone: () => void }) {
  const [sigs, setSigs] = useState<NovoSignatario[]>([{ nome: "", email: "", cpf: "", papel: "parte" }]);
  const [codigo, setCodigo] = useState(true);
  const [ordem, setOrdem] = useState(false);
  const [expira, setExpira] = useState("30");
  const [mensagem, setMensagem] = useState("");
  const [temCaixa, setTemCaixa] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<{ nome: string; link: string }[] | null>(null);

  useEffect(() => {
    getEmailOverview().then((o) => {
      const jur = o.sectors.find((s) => /jur[ií]dico/i.test(s.sector.name));
      const ok = jur?.account?.status === "ready" || o.default_account?.status === "ready";
      setTemCaixa(ok);
      if (!ok) setCodigo(false);
    }).catch(() => setTemCaixa(false));
  }, []);

  const up = (i: number, k: keyof NovoSignatario, v: string) => setSigs((l) => l.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const valido = sigs.every((s) => s.nome.trim() && /\S+@\S+\.\S+/.test(s.email));

  if (links) {
    return (
      <Dialog open onOpenChange={(o) => !o && (onDone(), onClose())}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Links de assinatura</DialogTitle>
            <DialogDescription>Sem caixa de e-mail configurada, envie cada link para a pessoa certa (ex.: WhatsApp). O link é pessoal.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.link} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
                <span className="w-32 shrink-0 truncate font-medium">{l.nome}</span>
                <code className="min-w-0 flex-1 truncate rounded bg-secondary px-2 py-1 text-xs">{l.link}</code>
                <Button size="icon" variant="ghost" className="size-8" title="Copiar" onClick={() => { void navigator.clipboard?.writeText(l.link); toast.success("Link copiado."); }}><Copy className="size-3.5" /></Button>
              </li>
            ))}
          </ul>
          <DialogFooter><Button onClick={() => { onDone(); onClose(); }}>Concluir</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSignature className="size-4" /> Enviar para assinatura</DialogTitle>
          <DialogDescription>“{doc.titulo}” é congelado em PDF com SHA-256; cada signatário recebe um link pessoal.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {sigs.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-xl border border-border p-2.5 sm:grid-cols-[1.3fr_1.3fr_1fr_1fr_auto]">
              <Input value={s.nome} onChange={(e) => up(i, "nome", e.target.value)} placeholder="Nome completo" />
              <Input type="email" value={s.email} onChange={(e) => up(i, "email", e.target.value)} placeholder="E-mail" />
              <Input value={s.cpf ?? ""} onChange={(e) => up(i, "cpf", e.target.value)} placeholder="CPF (opcional)" title="Se informado, o signatário precisa digitar o mesmo CPF" />
              <select value={s.papel} onChange={(e) => up(i, "papel", e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
                {PAPEIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <Button size="icon" variant="ghost" className="size-9" disabled={sigs.length === 1} onClick={() => setSigs((l) => l.filter((_, j) => j !== i))} title="Remover"><X className="size-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setSigs((l) => [...l, { nome: "", email: "", cpf: "", papel: "parte" }])}><Plus className="size-3.5" /> Signatário</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${!temCaixa ? "opacity-60" : ""}`}>
            <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={codigo} disabled={!temCaixa} onChange={(e) => setCodigo(e.target.checked)} />
            <span><span className="font-medium">Código por e-mail</span><span className="block text-xs text-muted-foreground">
              {temCaixa === false ? "Precisa da caixa de e-mail do Jurídico (ou da padrão) configurada." : "Confirma que quem assina tem acesso ao e-mail (recomendado)."}</span></span>
          </label>
          <label className="flex items-start gap-2 rounded-xl border p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={ordem} onChange={(e) => setOrdem(e.target.checked)} />
            <span><span className="font-medium">Assinar na ordem</span><span className="block text-xs text-muted-foreground">O próximo só recebe depois que o anterior assinar.</span></span>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <Textarea rows={2} value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Mensagem para os signatários (opcional)" />
          <label className="space-y-1 text-xs"><span className="block text-muted-foreground">Válido por (dias)</span><Input type="number" min={1} max={180} value={expira} onChange={(e) => setExpira(e.target.value)} /></label>
        </div>
        {temCaixa === false && (
          <p className="flex items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
            Sem caixa de e-mail: você vai receber os links para enviar manualmente.
            <Button size="sm" variant="outline" className="h-7" onClick={() => { onClose(); openAdminPanel("emails"); }}><Mail className="size-3.5" /> Configurar</Button>
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!valido || busy} onClick={async () => {
            setBusy(true);
            try {
              const sol = await criarAssinatura({
                documento: doc.id, mensagem, exigir_codigo_email: codigo, ordem_sequencial: ordem,
                expira_dias: Number(expira) || 30, signatarios: sigs.map((s) => ({ ...s, cpf: s.cpf?.trim() || undefined })),
              });
              if (sol.envio?.sem_email) {
                setLinks((await linksAssinatura(sol.id)).map((l) => ({ nome: l.nome, link: l.link })));
              } else {
                toast.success(`Enviado: ${sol.envio?.convites_enviados ?? 0} convite(s) por e-mail.`);
                onDone();
                onClose();
              }
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Não foi possível enviar.");
            } finally {
              setBusy(false);
            }
          }}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Enviar para assinatura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Documentos ──────────────────────────────────────────────────────────────

export function DocumentosTab({ onChanged }: { onChanged: () => void }) {
  const [docs, setDocs] = useState<DocumentoJuridico[] | null>(null);
  const [novo, setNovo] = useState(false);
  const [ver, setVer] = useState<DocumentoJuridico | null>(null);
  const [assinar, setAssinar] = useState<DocumentoJuridico | null>(null);
  const [modelos, setModelos] = useState(false);
  const load = useCallback(() => { listDocumentosJuridicos().then(setDocs).catch(() => setDocs([])); }, []);
  useEffect(load, [load]);

  if (modelos) return <ModelosCrud onBack={() => setModelos(false)} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-semibold">Documentos</h3>
          <p className="text-sm text-muted-foreground">Gere de modelo ou envie PDF; mande para assinatura eletrônica com trilha de auditoria.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setModelos(true)}><FileText className="size-3.5" /> Modelos</Button>
          <Button size="sm" onClick={() => setNovo(true)}><Plus className="size-3.5" /> Novo documento</Button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {docs?.map((d) => {
          const [st, tone] = STATUS_DOC[d.status];
          return (
            <div key={d.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary"><FileText className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{d.titulo}</p>
                  <p className="truncate text-xs text-muted-foreground">{label(TIPO_DOC, d.tipo)} · v{d.versao} · {dataBR(d.created_at)}{d.processo_titulo ? ` · ${d.processo_titulo}` : d.contrato_titulo ? ` · ${d.contrato_titulo}` : ""}</p>
                </div>
                <Tag tone={tone}>{st}</Tag>
              </div>
              <div className="mt-auto flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-8" onClick={() => setVer(d)}><Eye className="size-3.5" /> Ver</Button>
                {d.status !== "assinado" && d.status !== "em_assinatura" && (
                  <Button size="sm" className="h-8" onClick={() => setAssinar(d)}><FileSignature className="size-3.5" /> Assinar</Button>
                )}
                {d.status === "rascunho" && (
                  <Button size="sm" variant="ghost" className="ml-auto h-8 text-muted-foreground hover:text-destructive" title="Excluir" onClick={async () => { await deleteDocumentoJuridico(d.id); load(); }}><Trash2 className="size-3.5" /></Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {docs && !docs.length && (
        <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Nenhum documento ainda. Comece com “Novo documento” — há modelos prontos (prestação de serviços, NDA, procuração, notificação).
        </div>
      )}
      {novo && <NovoDocumento onClose={() => setNovo(false)} onCreated={() => { load(); onChanged(); }} />}
      {ver && <PdfViewer path={`/api/v1/juridico/documentos/${ver.id}/pdf/`} title={ver.titulo} onClose={() => setVer(null)} />}
      {assinar && <EnviarAssinatura doc={assinar} onClose={() => setAssinar(null)} onDone={() => { load(); onChanged(); }} />}
    </div>
  );
}

const MODELO_FIELDS: FieldDef[] = [
  { name: "nome", label: "Nome", required: true, wide: true },
  { name: "tipo", label: "Tipo", type: "select", options: TIPO_DOC, required: true },
  { name: "descricao", label: "Descrição" },
  { name: "corpo", label: "Texto do modelo", type: "textarea", required: true, wide: true,
    help: "Campos: {{empresa.razao_social}} {{empresa.cnpj}} {{empresa.endereco}} {{empresa.municipio}} {{empresa.uf}} {{parte.nome}} {{parte.documento}} {{parte.endereco}} {{processo.numero}} {{processo.foro}} {{contrato.titulo}} {{contrato.inicio}} {{contrato.fim}} {{contrato.valor}} {{contrato.reajuste}} {{data.hoje}} {{data.extenso}}" },
];

function ModelosCrud({ onBack }: { onBack: () => void }) {
  const [key, setKey] = useState(0);
  return (
    <div className="space-y-3">
      <Button size="sm" variant="ghost" onClick={onBack}>← Documentos</Button>
      <ErpCrud<ModeloDocumento>
        resource="juridico/modelos"
        title="Modelos de documento"
        description="Textos com campos {{...}} preenchidos com os dados do processo, contrato, parte e empresa."
        singular="modelo"
        fields={MODELO_FIELDS}
        columns={[
          { key: "nome", label: "Modelo", render: (m) => <span className="block"><span className="font-medium">{m.nome}</span><span className="block text-xs text-muted-foreground">{m.descricao}</span></span> },
          { key: "tipo", label: "Tipo", render: (m) => label(TIPO_DOC, m.tipo) },
          { key: "campos", label: "Campos", render: (m) => <span className="text-xs text-muted-foreground">{m.campos.length}</span> },
        ]}
        defaults={{ tipo: "contrato" }}
        reloadKey={key}
        headerExtra={<Button size="sm" variant="outline" onClick={async () => { const r = await criarModelosPadrao(); toast.success(r.criados ? `${r.criados} modelo(s) criado(s).` : "Os modelos padrão já existem."); setKey((k) => k + 1); }}>Criar modelos padrão</Button>}
      />
    </div>
  );
}

// ─── Assinaturas ─────────────────────────────────────────────────────────────

const STATUS_SOL: Record<SolicitacaoAssinatura["status"], [string, "muted" | "violet" | "ok" | "error" | "warn"]> = {
  rascunho: ["Rascunho", "muted"], enviada: ["Aguardando", "violet"], concluida: ["Concluída", "ok"],
  recusada: ["Recusada", "error"], cancelada: ["Cancelada", "muted"], expirada: ["Expirada", "warn"],
};
const SIG_ICON = { pendente: "○", visualizou: "◐", assinou: "●", recusou: "✕" } as const;
const SIG_TONE = { pendente: "muted", visualizou: "info", assinou: "ok", recusou: "error" } as const;

function Trilha({ sol, onClose }: { sol: SolicitacaoAssinatura; onClose: () => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof eventosAssinatura>> | null>(null);
  useEffect(() => { eventosAssinatura(sol.id).then(setD).catch(() => setD(null)); }, [sol.id]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">Trilha de auditoria {d && (d.trilha_integra ? <Tag tone="ok"><ShieldCheck className="size-3" /> íntegra</Tag> : <Tag tone="error">corrente quebrada</Tag>)}</DialogTitle>
          <DialogDescription className="break-all">SHA-256 do original: {sol.hash_original}{sol.hash_assinado ? ` · via assinada: ${sol.hash_assinado}` : ""}</DialogDescription>
        </DialogHeader>
        <ol className="relative space-y-3 border-l border-border pl-5">
          {d?.eventos.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full bg-primary ring-4 ring-background" />
              <p className="text-xs text-muted-foreground">{fmtDT(e.created_at)}{e.ip ? ` · IP ${e.ip}` : ""} · <code>#{e.hash_encadeado.slice(0, 12)}</code></p>
              <p className="text-sm"><span className="font-medium">{e.tipo.replace("_", " ")}</span>{e.signatario_nome ? ` — ${e.signatario_nome}` : ""}</p>
              {e.detalhe && <p className="text-xs text-muted-foreground">{e.detalhe}</p>}
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

export function AssinaturasTab({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<SolicitacaoAssinatura[] | null>(null);
  const [trilha, setTrilha] = useState<SolicitacaoAssinatura | null>(null);
  const [pdf, setPdf] = useState<{ path: string; title: string } | null>(null);
  const load = useCallback(() => { listAssinaturas().then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);

  const copiar = async (sol: SolicitacaoAssinatura, sigId: number) => {
    const l = (await linksAssinatura(sol.id)).find((x) => x.signatario === sigId);
    if (l) { await navigator.clipboard?.writeText(l.link); toast.success("Link copiado."); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-semibold">Assinaturas eletrônicas</h3>
          <p className="text-sm text-muted-foreground">Link pessoal, código por e-mail, IP e horário de cada assinatura, trilha encadeada por hash e PDF final com manifesto.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => window.open("/verificar", "_blank")}><Fingerprint className="size-3.5" /> Verificar documento</Button>
      </div>
      {rows?.map((s) => {
        const [st, tone] = STATUS_SOL[s.status];
        return (
          <div key={s.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary"><FileSignature className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">{s.titulo} <Tag tone={tone}>{st}</Tag>
                  <span className="text-xs font-normal text-muted-foreground">{s.assinados.feitos}/{s.assinados.total} assinaram</span></p>
                <p className="text-xs text-muted-foreground">
                  Enviado {fmtDT(s.enviada_em)} por {s.criado_por || "—"}{s.status === "enviada" && s.expira_em ? ` · expira ${dataBR(s.expira_em)}` : ""}
                  {s.concluida_em ? ` · concluído ${fmtDT(s.concluida_em)}` : ""}{s.exigir_codigo_email ? " · código por e-mail" : ""}{s.ordem_sequencial ? " · em ordem" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-8" onClick={() => setPdf({ path: `/api/v1/juridico/assinaturas/${s.id}/arquivo/`, title: `${s.titulo} (original)` })}><Eye className="size-3.5" /> Original</Button>
                {s.status === "concluida" && (
                  <Button size="sm" className="h-8" onClick={() => setPdf({ path: `/api/v1/juridico/assinaturas/${s.id}/arquivo/?via=assinada`, title: `${s.titulo} (assinado)` })}><Check className="size-3.5" /> Via assinada</Button>
                )}
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setTrilha(s)}><ShieldCheck className="size-3.5" /> Trilha</Button>
                {s.status === "enviada" && (
                  <Button size="sm" variant="ghost" className="h-8 text-muted-foreground hover:text-destructive" onClick={async () => { await cancelarAssinatura(s.id); toast.success("Cancelada."); load(); onChanged(); }}><Ban className="size-3.5" /> Cancelar</Button>
                )}
              </div>
            </div>
            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {s.signatarios.map((g) => (
                <li key={g.id} className="flex items-center gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-sm">
                  <span className="font-mono text-xs">{s.ordem_sequencial ? `${g.ordem}.` : ""}{SIG_ICON[g.status]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{g.nome} <span className="text-xs font-normal text-muted-foreground">· {g.papel_display}</span></span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {g.email}{g.assinado_em ? ` · assinou ${fmtDT(g.assinado_em)}${g.ip ? ` (IP ${g.ip})` : ""}` : g.visualizado_em ? ` · abriu ${fmtDT(g.visualizado_em)}` : g.convite_enviado_em ? ` · convite ${fmtDT(g.convite_enviado_em)}` : ""}
                      {g.recusa_motivo ? ` · “${g.recusa_motivo}”` : ""}
                    </span>
                  </span>
                  <Tag tone={SIG_TONE[g.status]}>{g.status}</Tag>
                  {s.status === "enviada" && g.status !== "assinou" && g.status !== "recusou" && (
                    <>
                      <Button size="icon" variant="ghost" className="size-7" title="Copiar link" onClick={() => void copiar(s, g.id)}><Copy className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-7" title="Reenviar convite por e-mail" onClick={async () => {
                        const r = await reenviarConvite(s.id, g.id).catch(() => ({ enviado: false }));
                        (r.enviado ? toast.success : toast.error)(r.enviado ? "Convite reenviado." : "Não foi enviado (sem caixa de e-mail?) — copie o link.");
                      }}><Mail className="size-3.5" /></Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {rows && !rows.length && (
        <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Nenhuma assinatura ainda. Em Documentos, clique em “Assinar” num documento.
        </div>
      )}
      {trilha && <Trilha sol={trilha} onClose={() => setTrilha(null)} />}
      {pdf && <PdfViewer path={pdf.path} title={pdf.title} onClose={() => setPdf(null)} />}
    </div>
  );
}
