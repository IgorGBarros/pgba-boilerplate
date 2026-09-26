// frontend/src/components/admin/SectorMailbox.tsx
//
// Caixa de e-mail de UM setor, aberta pelo envelope no cartão do organograma:
// Recebidos (IMAP, só leitura), Enviados (quem escreveu — a IA ou uma pessoa —
// e quem aprovou) e Rascunhos. "Responder com IA" pede ao agente do setor um
// rascunho; uma pessoa revisa e envia (nada sai sozinho).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Inbox, Loader2, Mail, PenLine, RefreshCw, Reply, Search, Send, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createOutboundEmail,
  draftAiReply,
  fetchMailbox,
  listInboundEmails,
  listOutboundEmails,
  markInboundRead,
  type EmailAccount,
  type InboundEmail,
  type OutboundEmail,
} from "@/lib/api";
import { openAdminPanel } from "@/lib/adminPanel";
import { EmailEditor } from "@/components/admin/OutboxSection";
import { MailboxStatus } from "@/components/admin/EmailsSection";
import { Badge, fmtDate } from "@/components/admin/shared";

type Tab = "in" | "sent" | "drafts";

function ReplyBadges({ email }: { email: InboundEmail }) {
  if (!email.replies.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {email.replies.map((r) => (
        <Badge key={r.id} tone={r.status === "sent" ? "ok" : r.status === "failed" ? "error" : "warn"}>
          {r.written_by_ai && <Bot className="size-3" />}
          {r.status === "sent" ? "respondido" : r.status === "failed" ? "resposta falhou" : "resposta em rascunho"}
        </Badge>
      ))}
    </span>
  );
}

function Reader({
  email,
  agentName,
  onDraft,
}: {
  email: InboundEmail;
  agentName: string;
  onDraft: (draft: OutboundEmail) => void;
}) {
  const [busy, setBusy] = useState<"ai" | "manual" | null>(null);
  const [hint, setHint] = useState("");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-1 border-b border-border px-5 py-4">
        <h3 className="font-display text-lg font-semibold leading-tight">{email.subject || "(sem assunto)"}</h3>
        <p className="text-sm">
          <span className="font-medium">{email.from_name || email.from_address}</span>{" "}
          {email.from_name && <span className="text-muted-foreground">&lt;{email.from_address}&gt;</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          Para {email.to.join(", ") || email.to_address} · {fmtDate(email.received_at)}
        </p>
        <ReplyBadges email={email} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed">{email.body || "(sem texto)"}</div>
      <div className="space-y-2 border-t border-border bg-secondary/30 px-5 py-3">
        <Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder={`Orientação para ${agentName || "a IA"} (opcional) — ex.: aceite o prazo, peça desconto de 5%`} />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy !== null} onClick={async () => {
            setBusy("ai");
            try {
              onDraft(await draftAiReply(email.id, hint));
              setHint("");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "A IA não conseguiu escrever a resposta.");
            } finally {
              setBusy(null);
            }
          }}>
            {busy === "ai" ? <Loader2 className="size-3.5 animate-spin" /> : <Bot className="size-3.5" />}
            Responder com IA{agentName ? ` (${agentName})` : ""}
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={async () => {
            setBusy("manual");
            try {
              onDraft(await createOutboundEmail({
                sector: email.sector,
                to: [email.from_address],
                subject: /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`,
                body: "",
                in_reply_to: email.id,
              }));
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Não foi possível criar a resposta.");
            } finally {
              setBusy(null);
            }
          }}>
            <Reply className="size-3.5" /> Responder eu mesmo
          </Button>
          <span className="text-[11px] text-muted-foreground">A resposta abre como rascunho: você revisa e envia.</span>
        </div>
      </div>
    </div>
  );
}

export function SectorMailbox({
  sector,
  account,
  agents,
  onClose,
  onChanged,
}: {
  sector: { id: number; name: string };
  account: EmailAccount | null;
  agents: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("in");
  const [inbox, setInbox] = useState<InboundEmail[] | null>(null);
  const [out, setOut] = useState<OutboundEmail[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<OutboundEmail | null>(null);
  const [fetching, setFetching] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    listInboundEmails(sector.id).then(setInbox).catch(() => setInbox([]));
    listOutboundEmails("", sector.id).then(setOut).catch(() => setOut([]));
  }, [sector.id]);
  useEffect(load, [load]);

  const refreshAll = () => { load(); onChanged(); };
  const unread = inbox?.filter((e) => !e.is_read).length ?? 0;
  const sent = useMemo(() => (out ?? []).filter((e) => e.status === "sent" || e.status === "failed"), [out]);
  const drafts = useMemo(() => (out ?? []).filter((e) => e.status === "draft"), [out]);
  const term = q.trim().toLowerCase();
  const inboxShown = (inbox ?? []).filter((e) => !term || `${e.subject} ${e.from_address} ${e.from_name}`.toLowerCase().includes(term));
  const current = inbox?.find((e) => e.id === selected) ?? null;

  const open = async (e: InboundEmail) => {
    setSelected(e.id);
    if (!e.is_read) {
      setInbox((list) => list?.map((x) => (x.id === e.id ? { ...x, is_read: true } : x)) ?? null);
      markInboundRead(e.id).then(onChanged).catch(() => undefined);
    }
  };

  const outList = tab === "sent" ? sent : drafts;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[min(88vh,820px)] max-w-[min(1100px,96vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1100px,96vw)]">
        <DialogHeader className="space-y-2 border-b border-border px-5 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <span className="grid size-9 place-items-center rounded-lg bg-secondary"><Mail className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="flex flex-wrap items-center gap-2">
                E-mail — {sector.name} <MailboxStatus account={account} />
              </DialogTitle>
              <DialogDescription className="truncate">
                {account?.address || "sem endereço ainda"}
                {agents.length ? ` · usada por ${agents.join(", ")}` : ""}
                {account?.last_fetch_at ? ` · última busca ${fmtDate(account.last_fetch_at)}` : ""}
              </DialogDescription>
            </div>
            {account?.status === "ready" && (
              <Button size="sm" variant="outline" disabled={fetching} onClick={async () => {
                setFetching(true);
                try {
                  const r = await fetchMailbox(account.id);
                  toast.success(r.created ? `${r.created} e-mail(s) novo(s).` : "Nenhum e-mail novo.");
                  refreshAll();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Não foi possível buscar.");
                } finally {
                  setFetching(false);
                }
              }}>
                <RefreshCw className={`size-3.5 ${fetching ? "animate-spin" : ""}`} /> Buscar e-mails
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { onClose(); openAdminPanel("emails"); }} title="Configurar a caixa">
              <Settings2 className="size-3.5" />
            </Button>
          </div>
          <div className="flex gap-1">
            {([
              ["in", "Recebidos", unread ? <Badge key="u" tone="warn">{unread} nova(s)</Badge> : null],
              ["sent", "Enviados", sent.length ? <Badge key="s">{sent.length}</Badge> : null],
              ["drafts", "Rascunhos", drafts.length ? <Badge key="d" tone="info">{drafts.length}</Badge> : null],
            ] as const).map(([id, label, badge]) => (
              <button key={id} type="button" onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition ${tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
                {label} {badge}
              </button>
            ))}
          </div>
        </DialogHeader>

        {!account?.configured && (
          <div className="flex items-center gap-3 border-b border-border bg-warning/10 px-5 py-2.5 text-sm">
            <span className="flex-1">
              {account ? "A caixa está reservada, mas sem endereço/senha — nada chega nem sai ainda." : "Este setor ainda não tem caixa de e-mail."}
            </span>
            <Button size="sm" onClick={() => { onClose(); openAdminPanel("emails"); }}>Configurar caixa</Button>
          </div>
        )}
        {account?.configured && !account.imap_host && (
          <p className="border-b border-border bg-secondary/40 px-5 py-2 text-xs text-muted-foreground">Sem IMAP configurado: a caixa envia, mas não recebe aqui.</p>
        )}

        <div className="flex min-h-0 flex-1">
          {tab === "in" ? (
            <>
              <aside className={`${current ? "hidden md:flex" : "flex"} w-full min-w-0 flex-col border-r border-border md:w-[360px] md:shrink-0`}>
                <div className="relative border-b border-border p-2">
                  <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar remetente ou assunto…" className="pl-8" />
                </div>
                <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                  {inboxShown.map((e) => (
                    <li key={e.id}>
                      <button type="button" onClick={() => void open(e)}
                        className={`block w-full px-4 py-3 text-left transition hover:bg-secondary/50 ${selected === e.id ? "bg-secondary/70" : ""}`}>
                        <span className="flex items-center gap-2">
                          {!e.is_read && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="não lido" />}
                          <span className={`truncate text-sm ${e.is_read ? "" : "font-semibold"}`}>{e.from_name || e.from_address}</span>
                          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{fmtDate(e.received_at)}</span>
                        </span>
                        <span className={`mt-0.5 block truncate text-sm ${e.is_read ? "text-muted-foreground" : ""}`}>{e.subject || "(sem assunto)"}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{e.body.slice(0, 120)}</span>
                        {e.replies.length > 0 && <span className="mt-1 block"><ReplyBadges email={e} /></span>}
                      </button>
                    </li>
                  ))}
                  {inbox && !inboxShown.length && (
                    <li className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
                      <Inbox className="size-6" />
                      {term ? "Nada encontrado." : account?.status === "ready" ? "Nenhum e-mail recebido ainda. A caixa é conferida a cada 5 minutos." : "Os e-mails recebidos aparecem aqui quando a caixa estiver pronta."}
                    </li>
                  )}
                  {!inbox && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando…</li>}
                </ul>
              </aside>
              {current ? (
                <div className="flex min-w-0 flex-1 flex-col">
                  <button type="button" onClick={() => setSelected(null)} className="border-b border-border px-5 py-2 text-left text-xs text-muted-foreground md:hidden">← Voltar</button>
                  <Reader email={current} agentName={agents[0] ?? ""} onDraft={(d) => { setEditing(d); load(); }} />
                </div>
              ) : (
                <div className="hidden flex-1 items-center justify-center text-sm text-muted-foreground md:flex">Selecione um e-mail para ler.</div>
              )}
            </>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
              {outList.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => setEditing(e)} className="flex w-full items-start gap-3 px-5 py-3 text-left transition hover:bg-secondary/50">
                    {tab === "sent" ? <Send className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <PenLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{e.subject}</span>
                        {e.written_by_ai && <Badge tone="info"><Bot className="size-3" /> escrito pela IA{e.requested_by ? ` · ${e.requested_by}` : ""}</Badge>}
                        {e.status === "failed" && <Badge tone="error">falhou</Badge>}
                        {e.in_reply_to && <Badge>resposta</Badge>}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        para {e.to.join(", ")}
                        {e.status === "sent" ? ` · enviado ${fmtDate(e.sent_at)}${e.approved_by ? ` por ${e.approved_by}` : ""}` : ` · criado ${fmtDate(e.created_at)}`}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{e.body.slice(0, 140)}</span>
                    </span>
                  </button>
                </li>
              ))}
              {out && !outList.length && (
                <li className="px-6 py-12 text-center text-sm text-muted-foreground">
                  {tab === "sent" ? "Nada enviado por esta caixa ainda." : "Nenhum rascunho esperando."}
                </li>
              )}
            </ul>
          )}
        </div>
        {editing && <EmailEditor email={editing} sectors={[]} onClose={() => { setEditing(null); refreshAll(); }} onChanged={refreshAll} />}
      </DialogContent>
    </Dialog>
  );
}
