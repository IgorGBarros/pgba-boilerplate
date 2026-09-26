// frontend/src/components/admin/EmailsSection.tsx
//
// Uma caixa de e-mail por setor (ex.: Compras → compras@empresa.com.br). Dá
// pra RESERVAR a caixa sem ter o e-mail ainda — os rascunhos dos agentes
// ficam esperando nela; quando o endereço chega, é só preencher e testar.
import { useCallback, useEffect, useState } from "react";
import { AtSign, Building2, ChevronDown, Inbox, Loader2, Mail, PlugZap, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteEmailAccount,
  getEmailOverview,
  getEmailPresets,
  saveEmailAccount,
  testEmailAccount,
  type EmailAccount,
  type EmailOverview,
  type EmailProvider,
} from "@/lib/api";
import { Badge, Card, Field, SecretInput, SectionHeader, fmtDate } from "@/components/admin/shared";

const PROVIDERS: { id: EmailProvider; label: string; help: string }[] = [
  { id: "hostinger", label: "Hostinger", help: "hPanel → E-mails → Contas de e-mail. Use o endereço e a senha da caixa." },
  { id: "gmail", label: "Gmail / Workspace", help: "Precisa de senha de app (Conta Google → Segurança → Senhas de app)." },
  { id: "outlook", label: "Outlook / 365", help: "SMTP AUTH precisa estar liberado na conta." },
  { id: "custom", label: "Outro SMTP", help: "Preencha servidor e porta nas opções avançadas." },
];

export function MailboxStatus({ account }: { account: EmailAccount | null }) {
  if (!account) return <Badge>sem caixa</Badge>;
  if (account.status === "ready") return <Badge tone="ok">pronta</Badge>;
  if (account.status === "error") return <Badge tone="error" title={account.last_check_message}>com erro</Badge>;
  return <Badge tone="warn">{account.configured ? "falta testar" : "aguardando e-mail"}</Badge>;
}

function MailboxDialog({
  sector,
  account,
  onClose,
  onSaved,
}: {
  sector: { id: number; name: string } | null;
  account: EmailAccount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [presets, setPresets] = useState<Record<string, Partial<EmailAccount>>>({});
  const [form, setForm] = useState({
    provider: account?.provider ?? ("hostinger" as EmailProvider),
    address: account?.address ?? "",
    display_name: account?.display_name ?? (sector ? `${sector.name}` : ""),
    password: "",
    smtp_host: account?.smtp_host ?? "",
    smtp_port: String(account?.smtp_port ?? ""),
    smtp_security: account?.smtp_security ?? "ssl",
    imap_host: account?.imap_host ?? "",
    imap_port: String(account?.imap_port ?? ""),
    username: account?.username ?? "",
    signature: account?.signature ?? "",
  });
  const [advanced, setAdvanced] = useState(form.provider === "custom");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  useEffect(() => { getEmailPresets().then(setPresets).catch(() => undefined); }, []);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const pickProvider = (p: EmailProvider) => {
    const pr = presets[p] ?? {};
    setForm((f) => ({
      ...f,
      provider: p,
      smtp_host: String(pr.smtp_host ?? ""),
      smtp_port: String(pr.smtp_port ?? ""),
      smtp_security: (pr.smtp_security as typeof f.smtp_security) ?? f.smtp_security,
      imap_host: String(pr.imap_host ?? ""),
      imap_port: String(pr.imap_port ?? ""),
    }));
    if (p === "custom") setAdvanced(true);
  };
  const help = PROVIDERS.find((p) => p.id === form.provider)?.help;

  const save = async (andTest: boolean) => {
    setBusy(true);
    setResult(null);
    try {
      const payload: Partial<EmailAccount> & { password?: string } = {
        sector: sector?.id ?? null,
        provider: form.provider,
        address: form.address.trim(),
        display_name: form.display_name,
        smtp_host: form.smtp_host,
        smtp_security: form.smtp_security,
        imap_host: form.imap_host,
        username: form.username,
        signature: form.signature,
        ...(form.smtp_port ? { smtp_port: Number(form.smtp_port) } : {}),
        ...(form.imap_port ? { imap_port: Number(form.imap_port) } : {}),
        ...(form.password ? { password: form.password } : {}),
      };
      const saved = await saveEmailAccount(payload, account?.id);
      onSaved();
      if (andTest && saved.configured) {
        const r = await testEmailAccount(saved.id);
        setResult(r);
        onSaved();
        if (r.ok) toast.success("Caixa pronta para enviar.");
      } else {
        toast.success(saved.configured ? "Caixa salva." : "Caixa reservada — os rascunhos esperam por ela.");
        if (!andTest) onClose();
        else setResult({ ok: false, detail: "Salvo. Para testar, preencha endereço e senha." });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{sector ? `Caixa de e-mail — ${sector.name}` : "Caixa padrão da empresa"}</DialogTitle>
          <DialogDescription>
            {sector
              ? `Os agentes de ${sector.name} escrevem os e-mails; uma pessoa revisa e envia por esta caixa.`
              : "Usada pelos setores que ainda não têm caixa própria."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PROVIDERS.map((p) => (
              <button key={p.id} type="button" onClick={() => pickProvider(p.id)} aria-pressed={form.provider === p.id}
                className={`rounded-xl border px-3 py-2 text-sm transition ${form.provider === p.id ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {p.label}
              </button>
            ))}
          </div>
          {help && <p className="text-xs text-muted-foreground">{help}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Endereço de e-mail" help="Pode deixar vazio por enquanto — a caixa fica reservada.">
              <Input type="email" value={form.address} onChange={(e) => set("address", e.target.value)} placeholder={sector ? `${sector.name.toLowerCase().replace(/\s+/g, "")}@suaempresa.com.br` : "contato@suaempresa.com.br"} />
            </Field>
            <Field label="Nome do remetente">
              <Input value={form.display_name} onChange={(e) => set("display_name", e.target.value)} placeholder="Compras — Sua Empresa" />
            </Field>
            <Field label="Senha da caixa" help={account?.has_password ? "Já salva (cifrada). Vazio mantém a atual." : "Fica cifrada; nunca volta pra tela."}>
              <SecretInput value={form.password} onChange={(v) => set("password", v)} placeholder={account?.has_password ? "••••••••" : ""} />
            </Field>
            <Field label="Assinatura (opcional)">
              <Textarea rows={2} value={form.signature} onChange={(e) => set("signature", e.target.value)} placeholder={"Equipe de Compras\n(11) 0000-0000"} />
            </Field>
          </div>
          <button type="button" onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={`size-3.5 transition ${advanced ? "rotate-180" : ""}`} /> Servidor (avançado)
          </button>
          {advanced && (
            <div className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-3">
              <Field label="SMTP"><Input value={form.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} placeholder="smtp.hostinger.com" /></Field>
              <Field label="Porta"><Input type="number" value={form.smtp_port} onChange={(e) => set("smtp_port", e.target.value)} placeholder="465" /></Field>
              <Field label="Segurança">
                <select value={form.smtp_security} onChange={(e) => set("smtp_security", e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                  <option value="ssl">SSL/TLS</option><option value="starttls">STARTTLS</option><option value="none">Nenhuma</option>
                </select>
              </Field>
              <Field label="IMAP (opcional)"><Input value={form.imap_host} onChange={(e) => set("imap_host", e.target.value)} placeholder="imap.hostinger.com" /></Field>
              <Field label="Porta IMAP"><Input type="number" value={form.imap_port} onChange={(e) => set("imap_port", e.target.value)} placeholder="993" /></Field>
              <Field label="Usuário" help="Vazio = o endereço."><Input value={form.username} onChange={(e) => set("username", e.target.value)} /></Field>
            </div>
          )}
          {result && (
            <p className={`rounded-lg border px-3 py-2 text-sm ${result.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>{result.detail}</p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {account ? (
            <Button variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={async () => {
              await deleteEmailAccount(account.id);
              toast.success("Caixa removida.");
              onSaved();
              onClose();
            }}>
              <Trash2 className="size-3.5" /> Remover caixa
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => save(false)} disabled={busy}>Salvar</Button>
            <Button onClick={() => save(true)} disabled={busy || !form.address || (!form.password && !account?.has_password)}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />} Salvar e testar envio
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EmailsSection({ onOpenOutbox }: { onOpenOutbox: () => void }) {
  const [data, setData] = useState<EmailOverview | null>(null);
  const [editing, setEditing] = useState<{ sector: { id: number; name: string } | null; account: EmailAccount | null } | null>(null);
  const load = useCallback(() => { getEmailOverview().then(setData).catch(() => setData({ default_account: null, sectors: [] })); }, []);
  useEffect(load, [load]);

  const ready = data?.sectors.filter((s) => s.account?.status === "ready").length ?? 0;
  const drafts = data?.sectors.reduce((n, s) => n + s.drafts, 0) ?? 0;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="E-mails dos setores"
        description="Cada setor envia pela própria caixa (ex.: a IA Comprador manda cotação e pedido pela caixa de Compras). Sem o e-mail ainda? Reserve a caixa — os rascunhos esperam."
        actions={
          <Button variant="outline" size="sm" onClick={onOpenOutbox}>
            <Inbox className="size-3.5" /> Caixa de saída {drafts ? <Badge tone="warn">{drafts}</Badge> : null}
          </Button>
        }
      />
      <Card className="flex flex-wrap items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-secondary"><Building2 className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Caixa padrão da empresa</p>
          <p className="truncate text-xs text-muted-foreground">{data?.default_account?.address || "Usada por setor sem caixa própria (opcional)."}</p>
        </div>
        <MailboxStatus account={data?.default_account ?? null} />
        <Button size="sm" variant="outline" onClick={() => setEditing({ sector: null, account: data?.default_account ?? null })}>
          {data?.default_account ? "Editar" : "Configurar"}
        </Button>
      </Card>
      <p className="text-xs text-muted-foreground">{ready} de {data?.sectors.length ?? 0} setores prontos para enviar.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {data?.sectors.map((row) => (
          <Card key={row.sector.id} className="space-y-2">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary"><Mail className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{row.sector.name}</p>
                  <MailboxStatus account={row.account} />
                  {row.drafts > 0 && <Badge tone="info">{row.drafts} rascunho(s)</Badge>}
                </div>
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                  <AtSign className="size-3" /> {row.account?.address || "sem endereço ainda"}
                </p>
                {row.agents.length > 0 && <p className="truncate text-[11px] text-muted-foreground">Usada por: {row.agents.join(", ")}</p>}
                {row.account?.last_check_message && (
                  <p className={`mt-1 line-clamp-2 text-[11px] ${row.account.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                    {fmtDate(row.account.last_check_at)} · {row.account.last_check_message}
                  </p>
                )}
              </div>
              <Button size="sm" variant={row.account ? "outline" : "default"} onClick={() => setEditing({ sector: row.sector, account: row.account })}>
                {row.account ? "Editar" : <><Plus className="size-3.5" /> Criar caixa</>}
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {!data && <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>}
      {editing && <MailboxDialog sector={editing.sector} account={editing.account} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
