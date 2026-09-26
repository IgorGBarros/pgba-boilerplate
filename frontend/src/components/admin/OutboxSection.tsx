// frontend/src/components/admin/OutboxSection.tsx
//
// Caixa de saída: o que agentes e telas (cotação/pedido de Compras) prepararam.
// Nada sai sozinho — uma pessoa revisa, edita se quiser, e clica Enviar.
import { useCallback, useEffect, useState } from "react";
import { Ban, Bot, Loader2, PenSquare, Plus, Send, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelOutboundEmail,
  createOutboundEmail,
  listOutboundEmails,
  listSectors,
  sendOutboundEmail,
  updateOutboundEmail,
  type OutboundEmail,
  type Sector,
} from "@/lib/api";
import { openAdminPanel } from "@/lib/adminPanel";
import { Badge, Card, Field, SectionHeader, fmtDate, type Tone } from "@/components/admin/shared";

const STATUS: Record<OutboundEmail["status"], { label: string; tone: Tone }> = {
  draft: { label: "rascunho", tone: "warn" },
  sending: { label: "enviando", tone: "info" },
  sent: { label: "enviado", tone: "ok" },
  failed: { label: "falhou", tone: "error" },
  cancelled: { label: "cancelado", tone: "muted" },
};

const FILTERS = [
  { id: "draft", label: "Para revisar" },
  { id: "failed", label: "Falharam" },
  { id: "sent", label: "Enviados" },
  { id: "", label: "Todos" },
];

function Origin({ origin }: { origin: string }) {
  if (origin.startsWith("compras.orcamento")) return <Badge tone="info"><ShoppingCart className="size-3" /> cotação</Badge>;
  if (origin.startsWith("compras.pedido")) return <Badge tone="info"><ShoppingCart className="size-3" /> pedido</Badge>;
  if (origin === "agente") return <Badge tone="info"><Bot className="size-3" /> escrito por agente</Badge>;
  return null;
}

const splitList = (v: string) => v.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);

export function EmailEditor({ email, sectors, onClose, onChanged }: { email: OutboundEmail | null; sectors: Sector[]; onClose: () => void; onChanged: () => void }) {
  const editable = !email || email.status === "draft" || email.status === "failed";
  const [form, setForm] = useState({
    sector: email?.sector ? String(email.sector) : "",
    to: email?.to.join(", ") ?? "",
    cc: email?.cc.join(", ") ?? "",
    subject: email?.subject ?? "",
    body: email?.body ?? "",
  });
  const [busy, setBusy] = useState<"save" | "send" | "cancel" | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const persist = async (): Promise<OutboundEmail> => {
    const data = { to: splitList(form.to), cc: splitList(form.cc), subject: form.subject, body: form.body };
    return email ? updateOutboundEmail(email.id, data) : createOutboundEmail({ ...data, sector: form.sector ? Number(form.sector) : null });
  };

  const run = async (kind: "save" | "send" | "cancel") => {
    setBusy(kind);
    try {
      if (kind === "cancel" && email) {
        await cancelOutboundEmail(email.id);
        toast.success("Rascunho cancelado.");
      } else {
        const saved = await persist();
        if (kind === "send") {
          const r = await sendOutboundEmail(saved.id);
          if (r.status === "sent") toast.success(`Enviado por ${r.from_address}.`);
          else if (r.status === "failed") toast.error(`Falhou: ${r.error}`);
          else toast.success("Na fila de envio.");
        } else {
          toast.success("Rascunho salvo.");
        }
      }
      onChanged();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Não foi possível.";
      toast.error(msg, msg.includes("caixa de e-mail") ? { action: { label: "Configurar caixa", onClick: () => openAdminPanel("emails") } } : undefined);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {email ? email.subject : "Novo e-mail"}
            {email && <Badge tone={STATUS[email.status].tone}>{STATUS[email.status].label}</Badge>}
            {email && <Origin origin={email.origin} />}
          </DialogTitle>
          <DialogDescription>
            {email?.status === "sent"
              ? `Enviado ${fmtDate(email.sent_at)} por ${email.from_address}${email.approved_by ? ` · aprovado por ${email.approved_by}` : ""}.`
              : "Revise antes de enviar. Sai pela caixa do setor."}
          </DialogDescription>
        </DialogHeader>
        {email?.error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{email.error}</p>}
        <div className="space-y-3">
          {!email && (
            <Field label="Setor que envia">
              <select value={form.sector} onChange={(e) => set("sector", e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                <option value="">Caixa padrão da empresa</option>
                {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          {email && <p className="text-sm text-muted-foreground">Setor: <span className="text-foreground">{email.sector_name || "empresa"}</span></p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Para"><Input value={form.to} onChange={(e) => set("to", e.target.value)} disabled={!editable} placeholder="fornecedor@exemplo.com" /></Field>
            <Field label="Cópia (opcional)"><Input value={form.cc} onChange={(e) => set("cc", e.target.value)} disabled={!editable} /></Field>
          </div>
          <Field label="Assunto"><Input value={form.subject} onChange={(e) => set("subject", e.target.value)} disabled={!editable} /></Field>
          <Field label="Mensagem"><Textarea rows={12} value={form.body} onChange={(e) => set("body", e.target.value)} disabled={!editable} className="font-mono text-sm" /></Field>
        </div>
        {editable && (
          <DialogFooter className="gap-2 sm:justify-between">
            {email ? (
              <Button variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={busy !== null} onClick={() => run("cancel")}>
                <Ban className="size-3.5" /> Cancelar rascunho
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy !== null} onClick={() => run("save")}>Salvar rascunho</Button>
              <Button disabled={busy !== null || !form.to.trim() || !form.subject.trim()} onClick={() => run("send")}>
                {busy === "send" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Enviar agora
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function OutboxSection() {
  const [filter, setFilter] = useState("draft");
  const [rows, setRows] = useState<OutboundEmail[] | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [open, setOpen] = useState<OutboundEmail | "new" | null>(null);

  const load = useCallback(() => { listOutboundEmails(filter).then(setRows).catch(() => setRows([])); }, [filter]);
  useEffect(load, [load]);
  useEffect(() => { listSectors().then(setSectors).catch(() => setSectors([])); }, []);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Caixa de saída"
        description="E-mails preparados por agentes e pelas telas (cotação e pedido de Compras). Nada sai sem uma pessoa clicar em Enviar."
        actions={<Button size="sm" onClick={() => setOpen("new")}><Plus className="size-3.5" /> Novo e-mail</Button>}
      />
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1 text-sm transition ${filter === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
            {f.label}
          </button>
        ))}
      </div>
      <Card className="p-0">
        {rows?.length ? (
          <ul className="divide-y divide-border">
            {rows.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setOpen(e)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-secondary/50">
                  <PenSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{e.subject}</span>
                      <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge>
                      <Origin origin={e.origin} />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {e.sector_name || "empresa"} → {e.to.join(", ")} · {fmtDate(e.created_at)}
                    </span>
                    {e.error && <span className="block truncate text-xs text-destructive">{e.error}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{rows ? "Nada aqui." : "Carregando…"}</p>
        )}
      </Card>
      {open && <EmailEditor email={open === "new" ? null : open} sectors={sectors} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}
