// frontend/src/pages/AssinarPage.tsx
//
// Páginas PÚBLICAS (sem login): /assinar/<token> — o signatário lê e assina —
// e /verificar — qualquer pessoa confere se um PDF foi assinado aqui.
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileSignature, Fingerprint, Loader2, Lock, ShieldCheck, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { assinarPublico, verificarDocumento, type AssinarInfo, type VerificacaoAssinatura } from "@/lib/api";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface/80 px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center gap-2 text-sm">
          <FileSignature className="size-4" />
          <span className="font-display font-semibold">Assinatura eletrônica</span>
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" /> conexão segura · documento com SHA-256</span>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-6">{children}</div>
    </main>
  );
}

export function AssinarPage({ token }: { token: string }) {
  const [info, setInfo] = useState<AssinarInfo | null>(null);
  const [erro, setErro] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [codigo, setCodigo] = useState("");
  const [aceite, setAceite] = useState(false);
  const [busy, setBusy] = useState<"codigo" | "assinar" | "recusar" | null>(null);
  const [aviso, setAviso] = useState("");
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [feito, setFeito] = useState<"assinou" | "recusou" | null>(null);

  const load = useCallback(() => {
    assinarPublico.info(token).then(setInfo).catch((e) => setErro(e instanceof Error ? e.message : "Link inválido."));
  }, [token]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!info) return;
    let u: string | null = null;
    assinarPublico.pdf(token, info.concluida).then((b) => { u = URL.createObjectURL(b); setPdfUrl(u); }).catch(() => undefined);
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [token, info?.concluida]); // eslint-disable-line react-hooks/exhaustive-deps

  if (erro) return <Shell><p className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center text-sm text-destructive">{erro}</p></Shell>;
  if (!info) return <Shell><p className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando…</p></Shell>;

  const run = async (kind: "codigo" | "assinar" | "recusar") => {
    setBusy(kind);
    setAviso("");
    try {
      if (kind === "codigo") {
        const r = await assinarPublico.codigo(token);
        setAviso(`Enviamos um código de 6 dígitos para ${r.email}. Vale por 10 minutos.`);
      } else if (kind === "assinar") {
        await assinarPublico.assinar(token, { nome, cpf, codigo, aceite });
        setFeito("assinou");
        load();
      } else {
        await assinarPublico.recusar(token, motivo);
        setFeito("recusou");
        load();
      }
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não foi possível.");
    } finally {
      setBusy(null);
    }
  };

  const podeAssinar = !info.bloqueio && !feito;
  return (
    <Shell>
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <section className="min-w-0 space-y-2">
          <h1 className="font-display text-xl font-semibold">{info.titulo}</h1>
          <p className="text-sm text-muted-foreground">
            {info.empresa ? `${info.empresa} · ` : ""}enviado por {info.remetente || "—"}
            {info.expira_em && info.status === "enviada" ? ` · assine até ${new Date(info.expira_em).toLocaleDateString("pt-BR")}` : ""}
          </p>
          {info.mensagem && <p className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm">{info.mensagem}</p>}
          <div className="h-[70vh] overflow-hidden rounded-xl border border-border bg-white">
            {pdfUrl ? <iframe title="Documento" src={pdfUrl} className="size-full" /> : <p className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando documento…</p>}
          </div>
          <p className="break-all text-[11px] text-muted-foreground">SHA-256: {info.concluida ? info.hash_assinado : info.hash_original}</p>
        </section>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-sm text-muted-foreground">Assinando como</p>
            <p className="font-semibold">{info.signatario.nome}</p>
            <p className="text-xs text-muted-foreground">{info.signatario.papel} · {info.signatario.email}</p>
            {info.outros.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
                {info.outros.map((o) => (
                  <li key={o.nome} className="flex justify-between"><span>{o.nome}</span><span className="text-muted-foreground">{o.status === "assinou" ? "✓ assinou" : o.status === "recusou" ? "✕ recusou" : "pendente"}</span></li>
                ))}
              </ul>
            )}
          </div>

          {feito === "assinou" || info.signatario.status === "assinou" ? (
            <div className="rounded-2xl border border-success/30 bg-success/10 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold text-success"><CheckCircle2 className="size-4" /> Assinatura registrada</p>
              <p className="mt-1 text-muted-foreground">
                {info.concluida ? "Todos assinaram. O documento acima já é a via assinada, com o manifesto de assinaturas no final." : "Quando todos assinarem, você recebe a via assinada por e-mail (ou volte a este link)."}
              </p>
              {info.concluida && pdfUrl && <a href={pdfUrl} download={`${info.titulo} - assinado.pdf`} className="mt-2 inline-block text-sm font-medium underline">Baixar via assinada</a>}
            </div>
          ) : feito === "recusou" || info.signatario.status === "recusou" ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><XCircle className="mb-1 size-4" /> Você recusou este documento. O remetente foi avisado pela plataforma.</div>
          ) : !podeAssinar ? (
            <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">{info.bloqueio}</div>
          ) : recusando ? (
            <div className="space-y-2 rounded-2xl border border-border bg-surface p-4">
              <p className="text-sm font-semibold">Recusar assinatura</p>
              <Textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (ajuda o remetente a corrigir)" />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setRecusando(false)}>Voltar</Button>
                <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => void run("recusar")}>{busy === "recusar" && <Loader2 className="size-3.5 animate-spin" />} Recusar</Button>
              </div>
            </div>
          ) : (
            <form className="space-y-3 rounded-2xl border border-border bg-surface p-4" onSubmit={(e) => { e.preventDefault(); void run("assinar"); }}>
              <label className="block space-y-1 text-sm"><span className="font-medium">Seu nome completo</span>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={info.signatario.nome} autoComplete="name" />
              </label>
              {info.pedir_cpf && (
                <label className="block space-y-1 text-sm"><span className="font-medium">CPF</span>
                  <Input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" inputMode="numeric" />
                </label>
              )}
              {info.exigir_codigo_email && (
                <div className="space-y-1 text-sm">
                  <span className="font-medium">Código enviado ao seu e-mail</span>
                  <div className="flex gap-2">
                    <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="000000" inputMode="numeric" maxLength={6} className="font-mono tracking-widest" />
                    <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" disabled={busy !== null} onClick={() => void run("codigo")}>
                      {busy === "codigo" && <Loader2 className="size-3.5 animate-spin" />} Enviar código
                    </Button>
                  </div>
                </div>
              )}
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
                <span>Li o documento e concordo em assiná-lo eletronicamente. Reconheço a validade desta assinatura (MP 2.200-2/2001, art. 10, § 2º, e Lei 14.063/2020). Serão registrados data, hora, IP e navegador.</span>
              </label>
              {aviso && <p className="rounded-lg bg-secondary px-3 py-2 text-xs">{aviso}</p>}
              <Button type="submit" className="w-full" disabled={busy !== null || !nome.trim() || !aceite || (info.exigir_codigo_email && codigo.length < 6)}>
                {busy === "assinar" ? <Loader2 className="size-4 animate-spin" /> : <FileSignature className="size-4" />} Assinar documento
              </Button>
              <button type="button" onClick={() => setRecusando(true)} className="w-full text-center text-xs text-muted-foreground underline">Recusar</button>
            </form>
          )}
        </aside>
      </div>
    </Shell>
  );
}

export function VerificarPage() {
  const [res, setRes] = useState<VerificacaoAssinatura | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  return (
    <Shell>
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-semibold"><Fingerprint className="size-5" /> Verificar documento assinado</h1>
          <p className="text-sm text-muted-foreground">Envie o PDF: calculamos o SHA-256 e conferimos com os documentos assinados na plataforma. Qualquer alteração no arquivo muda o hash.</p>
        </div>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border bg-surface px-6 py-10 text-center hover:border-foreground/30">
          {busy ? <Loader2 className="size-6 animate-spin" /> : <Upload className="size-6" />}
          <span className="text-sm">Escolher PDF</span>
          <input type="file" accept="application/pdf" className="sr-only" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true); setErro(""); setRes(null);
            try { setRes(await verificarDocumento(f)); } catch (err) { setErro(err instanceof Error ? err.message : "Falhou."); } finally { setBusy(false); }
          }} />
        </label>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        {res && !res.encontrado && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold text-destructive"><XCircle className="size-4" /> Não encontrado</p>
            <p className="mt-1 text-muted-foreground">Este arquivo não corresponde a nenhum documento assinado aqui — ou foi alterado depois da assinatura.</p>
            <p className="mt-2 break-all text-[11px] text-muted-foreground">SHA-256: {res.hash}</p>
          </div>
        )}
        {res?.encontrado && (
          <div className="space-y-3 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold text-success"><ShieldCheck className="size-4" /> Documento autêntico — {res.arquivo}</p>
            <p><span className="text-muted-foreground">Título:</span> {res.titulo} · <span className="text-muted-foreground">situação:</span> {res.status}
              {res.concluida_em ? ` · concluído em ${new Date(res.concluida_em).toLocaleString("pt-BR")}` : ""}</p>
            <p className="text-xs">{res.trilha_integra ? "✓ Trilha de auditoria íntegra (hash encadeado confere)." : "⚠ Trilha de auditoria com inconsistência."}</p>
            <ul className="divide-y divide-success/20 rounded-lg border border-success/20 bg-background/60">
              {res.signatarios?.map((s) => (
                <li key={s.nome + s.email} className="flex justify-between gap-2 px-3 py-2">
                  <span><span className="font-medium">{s.nome}</span> <span className="text-xs text-muted-foreground">· {s.papel} · {s.email}</span></span>
                  <span className="text-xs">{s.assinado_em ? `assinou ${new Date(s.assinado_em).toLocaleString("pt-BR")}` : s.status}</span>
                </li>
              ))}
            </ul>
            <p className="break-all text-[11px] text-muted-foreground">SHA-256: {res.hash}</p>
          </div>
        )}
      </div>
    </Shell>
  );
}
