// frontend/src/components/admin/InfraSections.tsx — Hostinger, Servidores (VPS), GitHub
import { useCallback, useEffect, useState } from "react";
import { Globe, Loader2, Mail, PlugZap, Plus, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  checkServer,
  deleteServer,
  getHostingerOverview,
  listServers,
  saveServer,
  type HostingerOverview,
  type ServerConnection,
  type ServiceCredentialInfo,
} from "@/lib/api";
import { openAdminPanel } from "@/lib/adminPanel";
import { Badge, Card, CredentialCard, Field, SecretInput, SectionHeader, fmtDate } from "@/components/admin/shared";

// ─── Hostinger ───────────────────────────────────────────────────────────────

export function HostingerSection({ credential, onCredentialsChanged }: { credential: ServiceCredentialInfo | undefined; onCredentialsChanged: () => void }) {
  const [data, setData] = useState<HostingerOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!credential?.configured) return;
    setLoading(true);
    try {
      setData(await getHostingerOverview());
    } catch (err) {
      setData({ vps: [], domains: [], errors: [err instanceof Error ? err.message : "Falhou."] });
    } finally {
      setLoading(false);
    }
  }, [credential?.configured]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <SectionHeader title="Hostinger" description="E-mail dos setores (SMTP/IMAP da Hostinger) e, opcionalmente, a API da conta para ver VPS e domínios." />
      <Card className="flex flex-wrap items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-secondary"><Mail className="size-4" /></span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">E-mail da Hostinger</p>
          <p className="text-muted-foreground">
            Crie as caixas no hPanel (E-mails → Contas de e-mail) e cadastre cada uma no setor. O servidor já vem preenchido:
            <code className="mx-1 rounded bg-secondary px-1">smtp.hostinger.com:465</code> e <code className="rounded bg-secondary px-1">imap.hostinger.com:993</code>.
          </p>
        </div>
        <Button size="sm" onClick={() => openAdminPanel("emails")}>Configurar e-mails dos setores</Button>
      </Card>
      <CredentialCard
        provider="hostinger"
        current={credential}
        title="API da Hostinger (opcional)"
        tokenLabel="Token da API"
        tokenPlaceholder="token do hPanel"
        tokenHelp="hPanel → Perfil → API → Gerar token. Usado só para LER a conta (VPS e domínios)."
        onChanged={() => { onCredentialsChanged(); void load(); }}
      />
      {loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Lendo a conta…</p>}
      {data && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Server className="size-4" /> VPS ({data.vps.length})</p>
            {data.vps.length ? (
              <ul className="space-y-1.5 text-sm">
                {data.vps.map((v) => (
                  <li key={String(v.id)} className="flex items-center justify-between gap-2">
                    <span className="truncate">{v.hostname || `VPS ${v.id}`} <span className="text-xs text-muted-foreground">{v.ip}</span></span>
                    <Badge tone={v.state === "running" ? "ok" : "muted"}>{v.state || "—"}</Badge>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Nenhuma VPS nesta conta.</p>}
          </Card>
          <Card>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Globe className="size-4" /> Domínios ({data.domains.length})</p>
            {data.domains.length ? (
              <ul className="space-y-1.5 text-sm">
                {data.domains.map((d) => (
                  <li key={d.domain} className="flex items-center justify-between gap-2">
                    <span className="truncate">{d.domain}</span>
                    <span className="text-xs text-muted-foreground">{d.status}{d.expires_at ? ` · vence ${fmtDate(d.expires_at)}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Nenhum domínio listado.</p>}
          </Card>
          {data.errors.map((e) => <p key={e} className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive md:col-span-2">{e}</p>)}
        </div>
      )}
    </div>
  );
}

// ─── Servidores (VPS) ────────────────────────────────────────────────────────

const PROVIDER_LABEL: Record<ServerConnection["provider"], string> = { oracle: "Oracle Cloud", hostinger: "Hostinger", outro: "Outro" };

function ServerDialog({ server, onClose, onSaved }: { server: ServerConnection | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: server?.name ?? "VPS Oracle (Always Free)",
    provider: server?.provider ?? ("oracle" as ServerConnection["provider"]),
    host: server?.host ?? "",
    ssh_port: String(server?.ssh_port ?? 22),
    username: server?.username ?? "ubuntu",
    region: server?.region ?? "",
    purpose: server?.purpose ?? "",
    notes: server?.notes ?? "",
    private_key: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const { private_key, ssh_port, ...rest } = form;
      await saveServer({ ...rest, ssh_port: Number(ssh_port) || 22, ...(private_key ? { private_key } : {}) }, server?.id);
      toast.success("Servidor salvo.");
      onSaved();
      onClose();
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
          <DialogTitle>{server ? server.name : "Novo servidor"}</DialogTitle>
          <DialogDescription>Pode cadastrar antes de a VPS existir — o endereço entra depois.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome"><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Provedor">
            <select value={form.provider} onChange={(e) => set("provider", e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              {Object.entries(PROVIDER_LABEL).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
            </select>
          </Field>
          <Field label="IP público / host" help="Oracle: Compute → Instances → Public IP."><Input value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="150.230.x.x" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Porta SSH"><Input type="number" value={form.ssh_port} onChange={(e) => set("ssh_port", e.target.value)} /></Field>
            <Field label="Usuário" help="Ubuntu na Oracle: ubuntu"><Input value={form.username} onChange={(e) => set("username", e.target.value)} /></Field>
          </div>
          <Field label="Região"><Input value={form.region} onChange={(e) => set("region", e.target.value)} placeholder="sa-saopaulo-1" /></Field>
          <Field label="Pra que serve"><Input value={form.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="n8n, backend, banco…" /></Field>
          <div className="sm:col-span-2">
            <Field label="Chave SSH privada (opcional)" help={server?.has_private_key ? "Já salva (cifrada). Vazio mantém a atual." : "Fica cifrada; nunca volta pra tela. O sistema não roda comando remoto — só testa se o SSH responde."}>
              <SecretInput value={form.private_key} onChange={(v) => set("private_key", v)} placeholder={server?.has_private_key ? "••••••••" : "-----BEGIN OPENSSH PRIVATE KEY-----"} />
            </Field>
          </div>
          <div className="sm:col-span-2"><Field label="Anotações"><Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={busy || !form.name.trim()}>{busy && <Loader2 className="size-3.5 animate-spin" />} Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ServersSection() {
  const [rows, setRows] = useState<ServerConnection[] | null>(null);
  const [editing, setEditing] = useState<ServerConnection | "new" | null>(null);
  const [checking, setChecking] = useState<number | null>(null);
  const load = useCallback(() => { listServers().then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Servidores (VPS)"
        description="Onde a plataforma e as automações rodam — Oracle Cloud (Always Free), Hostinger ou outro. Guarda o acesso cifrado e testa se o SSH responde."
        actions={<Button size="sm" onClick={() => setEditing("new")}><Plus className="size-3.5" /> Adicionar servidor</Button>}
      />
      {rows?.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((s) => (
            <Card key={s.id} className="space-y-2">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary"><Server className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{s.name}</p>
                    <Badge>{PROVIDER_LABEL[s.provider]}</Badge>
                    {s.last_check_ok === true && <Badge tone="ok">SSH ok</Badge>}
                    {s.last_check_ok === false && <Badge tone={s.host ? "error" : "warn"}>{s.host ? "sem resposta" : "sem IP ainda"}</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.host ? `${s.username || "?"}@${s.host}:${s.ssh_port}` : "endereço ainda não definido"}{s.region ? ` · ${s.region}` : ""}{s.purpose ? ` · ${s.purpose}` : ""}
                  </p>
                  {s.last_check_message && <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{fmtDate(s.last_check_at)} · {s.last_check_message}</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={checking === s.id} onClick={async () => {
                  setChecking(s.id);
                  try {
                    const r = await checkServer(s.id);
                    (r.ok ? toast.success : toast.error)(r.detail);
                    load();
                  } finally {
                    setChecking(null);
                  }
                }}>
                  {checking === s.id ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />} Testar acesso
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Editar</Button>
                <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={async () => {
                  await deleteServer(s.id);
                  toast.success("Servidor removido.");
                  load();
                }}><Trash2 className="size-3.5" /></Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="space-y-2 text-sm text-muted-foreground">
          <p>{rows ? "Nenhum servidor ainda." : "Carregando…"}</p>
          {rows && (
            <ol className="list-decimal space-y-1 pl-5">
              <li>Crie a conta Oracle Cloud Free Tier e uma instância <em>Always Free</em> (Ampere A1 ou VM.Standard.E2.1.Micro), Ubuntu.</li>
              <li>Baixe a chave SSH gerada na criação e anote o IP público.</li>
              <li>Na VCN → Security List, libere a porta 22 (e 80/443 se for servir o sistema/n8n).</li>
              <li>Cadastre aqui e clique em <strong className="text-foreground">Testar acesso</strong>.</li>
            </ol>
          )}
        </Card>
      )}
      {editing && <ServerDialog server={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

// ─── GitHub ──────────────────────────────────────────────────────────────────

export function GithubSection({ credential, onCredentialsChanged }: { credential: ServiceCredentialInfo | undefined; onCredentialsChanged: () => void }) {
  return (
    <div className="space-y-4">
      <SectionHeader title="GitHub" description="Usado pelo setor Desenvolvimento para criar o repositório de projetos novos e abrir PR ao aprovar tarefas." />
      <CredentialCard
        provider="github"
        current={credential}
        title="Token do GitHub"
        accountLabel="Organização ou usuário"
        accountPlaceholder="sua-org (vazio = conta do token)"
        tokenLabel="Token (fine-grained)"
        tokenPlaceholder="github_pat_..."
        tokenHelp="Permissões: Contents e Pull requests (leitura e escrita), Administration para criar repositório."
        onChanged={onCredentialsChanged}
      />
    </div>
  );
}
