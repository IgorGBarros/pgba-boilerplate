// frontend/src/components/admin/shared.tsx — peças comuns do Painel administrativo
import { useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, PlugZap, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  removeServiceCredential,
  saveServiceCredential,
  testServiceCredential,
  type CredentialProvider,
  type ServiceCredentialInfo,
} from "@/lib/api";

export type Tone = "ok" | "warn" | "error" | "muted" | "info";
const TONES: Record<Tone, string> = {
  ok: "border-success/30 bg-success/10 text-success",
  warn: "border-warning/30 bg-warning/10 text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-border bg-secondary text-muted-foreground",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

export function Badge({ tone = "muted", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function SectionHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
        {description && <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-surface p-4 ${className}`}>{children}</div>;
}

export function Field({ label, help, children }: { label: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {help && <span className="block text-xs text-muted-foreground">{help}</span>}
    </label>
  );
}

export function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="new-password" className="pr-9" />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title={show ? "Esconder" : "Mostrar"}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function Kpi({ label, value, tone }: { label: string; value: React.ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-xl font-semibold tabular-nums ${tone === "error" ? "text-destructive" : tone === "ok" ? "text-success" : ""}`}>{value}</p>
    </div>
  );
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Cartão de credencial de um serviço (n8n, Hostinger, GitHub): token cifrado
 * no backend, volta só mascarado; "Testar" faz chamada real.
 */
export function CredentialCard({
  provider,
  current,
  title,
  accountLabel,
  accountPlaceholder,
  accountHelp,
  tokenLabel,
  tokenPlaceholder,
  tokenHelp,
  tokenOptional = false,
  onChanged,
}: {
  provider: CredentialProvider;
  current: ServiceCredentialInfo | undefined;
  title: string;
  accountLabel?: string;
  accountPlaceholder?: string;
  accountHelp?: React.ReactNode;
  tokenLabel: string;
  tokenPlaceholder?: string;
  tokenHelp?: React.ReactNode;
  /** Serviço que funciona só com o endereço (ex.: MoneyPrinterTurbo em rede confiável). */
  tokenOptional?: boolean;
  onChanged: () => void;
}) {
  const [account, setAccount] = useState(current?.account_ref ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const save = async () => {
    setBusy("save");
    try {
      await saveServiceCredential({ provider, account_ref: account, ...(token ? { token } : {}) });
      setToken("");
      toast.success(`${title}: salvo.`);
      onChanged();
      setBusy("test");
      setResult(await testServiceCredential(provider).catch((e) => ({ ok: false, detail: e instanceof Error ? e.message : "Falhou." })));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        {current?.configured ? <Badge tone="ok"><CheckCircle2 className="size-3" /> configurado · {current.token_masked}</Badge> : <Badge>não configurado</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {accountLabel && (
          <Field label={accountLabel} help={accountHelp}>
            <Input value={account} onChange={(e) => setAccount(e.target.value)} placeholder={accountPlaceholder} />
          </Field>
        )}
        <Field label={tokenLabel} help={tokenHelp}>
          <SecretInput value={token} onChange={setToken} placeholder={current?.configured ? "deixe vazio para manter o atual" : tokenPlaceholder} />
        </Field>
      </div>
      {result && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${result.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
          {result.detail}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy !== null || (!current?.configured && !token && !(tokenOptional && account.trim()))}>
          {busy === "save" && <Loader2 className="size-3.5 animate-spin" />} Salvar e testar
        </Button>
        {current?.configured && (
          <>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={async () => {
              setBusy("test");
              setResult(await testServiceCredential(provider).catch((e) => ({ ok: false, detail: e instanceof Error ? e.message : "Falhou." })));
              setBusy(null);
            }}>
              {busy === "test" ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />} Testar conexão
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={busy !== null} onClick={async () => {
              await removeServiceCredential(provider);
              setResult(null);
              toast.success(`${title}: removido.`);
              onChanged();
            }}>
              <Trash2 className="size-3.5" /> Remover
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
