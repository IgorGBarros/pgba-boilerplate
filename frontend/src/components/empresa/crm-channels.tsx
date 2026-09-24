import { useState, useEffect } from "react";
import {
  MessageCircle, Send, Globe, Megaphone,
  Trash2, CheckCircle2, Loader2,
  Copy, Eye, EyeOff, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChannelConfig, ChannelType,
  listChannels, createChannel, updateChannel, deleteChannel, testChannel,
} from "@/lib/api";
import { toast } from "sonner";

// ─── Metadata por canal ────────────────────────────────────────────────────────

const CHANNEL_META: Record<ChannelType, {
  label: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  description: string;
  fields: { key: string; label: string; placeholder: string; isSecret?: boolean }[];
  configFields: { key: string; label: string; placeholder: string }[];
}> = {
  whatsapp: {
    label: "WhatsApp",
    icon: MessageCircle,
    color: "text-green-500",
    bg: "bg-green-500/10",
    description: "Recebe mensagens via Evolution API. Leads criados automaticamente e o agente responde.",
    fields: [
      { key: "api_key", label: "API Key (Evolution API)", placeholder: "sua-api-key", isSecret: true },
    ],
    configFields: [
      { key: "server_url", label: "URL do servidor Evolution", placeholder: "http://localhost:8080" },
      { key: "instance", label: "Nome da instância", placeholder: "minha-empresa" },
    ],
  },
  telegram: {
    label: "Telegram",
    icon: Send,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    description: "Conecta um Telegram Bot. Mensagens criam leads e o agente responde no chat.",
    fields: [
      { key: "api_key", label: "Bot Token", placeholder: "123456:ABC-...", isSecret: true },
    ],
    configFields: [
      { key: "bot_username", label: "Username do bot", placeholder: "@meu_bot" },
    ],
  },
  landing_page: {
    label: "Landing Page",
    icon: Globe,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    description: "Endpoint público para formulários HTML. Copie a URL e use em qualquer landing page.",
    fields: [],
    configFields: [],
  },
  meta_ads: {
    label: "Meta Lead Ads",
    icon: Megaphone,
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    description: "Recebe leads diretamente de anúncios no Facebook e Instagram.",
    fields: [
      { key: "api_key", label: "Access Token (Meta App)", placeholder: "EAAxxxxxx...", isSecret: true },
    ],
    configFields: [
      { key: "page_id", label: "Page ID", placeholder: "123456789" },
      { key: "verify_token", label: "Verify Token (webhook)", placeholder: "meu-token-secreto" },
    ],
  },
};

// ─── ChannelCard ──────────────────────────────────────────────────────────────

function ChannelCard({
  channel,
  existing,
  onSaved,
}: {
  channel: ChannelType;
  existing: ChannelConfig | undefined;
  onSaved: (c: ChannelConfig) => void;
}) {
  const meta = CHANNEL_META[channel];
  const Icon = meta.icon;

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});

  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState(existing?.webhook_secret ?? "");
  const [configVals, setConfigVals] = useState<Record<string, string>>(existing?.config ?? {});
  const [welcomeMessage, setWelcomeMessage] = useState(existing?.welcome_message ?? "");
  const [quickRepliesText, setQuickRepliesText] = useState(
    (existing?.quick_replies ?? []).join("\n")
  );
  const [triggerPhrasesText, setTriggerPhrasesText] = useState(
    (existing?.trigger_phrases ?? []).join("\n")
  );

  useEffect(() => {
    setWebhookSecret(existing?.webhook_secret ?? "");
    setConfigVals(existing?.config ?? {});
    setWelcomeMessage(existing?.welcome_message ?? "");
    setQuickRepliesText((existing?.quick_replies ?? []).join("\n"));
    setTriggerPhrasesText((existing?.trigger_phrases ?? []).join("\n"));
  }, [existing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const quickReplies = quickRepliesText
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean);
      const triggerPhrases = triggerPhrasesText
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean);
      const payload: Partial<ChannelConfig> = {
        channel,
        is_active: true,
        config: configVals,
        webhook_secret: webhookSecret,
        welcome_message: welcomeMessage,
        quick_replies: quickReplies,
        trigger_phrases: triggerPhrases,
      };
      if (apiKey) payload.api_key = apiKey;

      const saved = existing
        ? await updateChannel(existing.id, payload)
        : await createChannel(payload);

      onSaved(saved);
      setApiKey("");
      toast.success("Canal salvo.");
      setOpen(false);
    } catch {
      toast.error("Erro ao salvar canal.");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!existing) return;
    setTesting(true);
    try {
      const res = await testChannel(existing.id);
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    } catch {
      toast.error("Erro ao testar conexão.");
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!existing) return;
    setDeleting(true);
    try {
      await deleteChannel(existing.id);
      toast.success("Canal removido.");
      onSaved({ ...existing, is_active: false } as ChannelConfig);
    } catch {
      toast.error("Erro ao remover canal.");
    } finally {
      setDeleting(false);
    }
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(
      () => toast.success("URL copiada!"),
      () => toast.error("Não foi possível copiar."),
    );
  };

  return (
    <div className={`rounded-xl border border-border bg-card transition-all ${open ? "ring-1 ring-primary/30" : ""}`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${meta.bg}`}>
          <Icon className={`size-5 ${meta.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{meta.label}</span>
            {existing?.is_active && (
              <Badge variant="outline" className="text-green-500 border-green-500/40 text-[10px] px-1.5 py-0">
                Ativo
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">{meta.description}</p>
        </div>
        <div className="text-muted-foreground text-xs">{open ? "▲" : "▼"}</div>
      </div>

      {/* Body */}
      {open && (
        <div className="border-t border-border p-4 flex flex-col gap-4">
          {/* Webhook URL (somente leitura) */}
          {existing?.webhook_url && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground font-medium">URL do Webhook</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md truncate">
                  {existing.webhook_url}
                </code>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => copyUrl(existing.webhook_url)}>
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Campos de API key / secret */}
          {meta.fields.map(f => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground font-medium">{f.label}</label>
              <div className="flex items-center gap-2">
                <Input
                  type={f.isSecret && !showSecret[f.key] ? "password" : "text"}
                  placeholder={existing ? (existing.api_key_masked || "••••••••") : f.placeholder}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  className="h-8 text-xs"
                />
                {f.isSecret && (
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                    onClick={() => setShowSecret(s => ({ ...s, [f.key]: !s[f.key] }))}
                  >
                    {showSecret[f.key] ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </Button>
                )}
              </div>
            </div>
          ))}

          {/* Config fields */}
          {meta.configFields.map(f => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground font-medium">{f.label}</label>
              <Input
                placeholder={f.placeholder}
                value={configVals[f.key] ?? ""}
                onChange={e => setConfigVals(c => ({ ...c, [f.key]: e.target.value }))}
                className="h-8 text-xs"
              />
            </div>
          ))}

          {/* Mensagem de boas-vindas */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Mensagem de boas-vindas <span className="text-muted-foreground/60">(enviada no primeiro contato)</span>
            </label>
            <textarea
              placeholder={"Olá! Seja bem-vindo(a). Como posso te ajudar hoje?"}
              value={welcomeMessage}
              onChange={e => setWelcomeMessage(e.target.value)}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>

          {/* Sugestões de perguntas */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Sugestões de perguntas <span className="text-muted-foreground/60">(uma por linha — exibidas após a boas-vindas)</span>
            </label>
            <textarea
              placeholder={"Ver preços\nFalar com atendente\nSaber mais sobre os serviços"}
              value={quickRepliesText}
              onChange={e => setQuickRepliesText(e.target.value)}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>

          {/* Frases de gatilho */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Frases de gatilho para cadastro{" "}
              <span className="text-muted-foreground/60">
                (uma por linha — só cria lead se a 1ª mensagem contiver alguma dessas frases; deixe vazio para cadastrar qualquer contato)
              </span>
            </label>
            <textarea
              placeholder={"Estou interessado\nQuero saber mais\nGostaria de um orçamento"}
              value={triggerPhrasesText}
              onChange={e => setTriggerPhrasesText(e.target.value)}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>

          {/* Webhook secret */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Webhook Secret <span className="text-muted-foreground/60">(opcional — para validação de assinatura)</span>
            </label>
            <Input
              type="password"
              placeholder="seu-secret"
              value={webhookSecret}
              onChange={e => setWebhookSecret(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          {/* Ações */}
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-8 text-xs gap-1.5">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              {existing ? "Salvar" : "Ativar canal"}
            </Button>

            {existing && (
              <Button size="sm" variant="outline" onClick={handleTest} disabled={testing} className="h-8 text-xs gap-1.5">
                {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                Testar
              </Button>
            )}

            {existing && (
              <Button
                size="sm" variant="ghost"
                onClick={handleDelete} disabled={deleting}
                className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive ml-auto"
              >
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Remover
              </Button>
            )}
          </div>

          {/* Setup guides */}
          {channel === "whatsapp" && (
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Como configurar a Evolution API:</p>
              <p>1. Instale a Evolution API: <code>docker run -d -p 8080:8080 atendai/evolution-api</code></p>
              <p>2. Crie uma instância e conecte seu número (QR Code no painel)</p>
              <p>3. Configure o webhook apontando para a URL acima</p>
            </div>
          )}
          {channel === "telegram" && (
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Como criar o Bot:</p>
              <p>1. Abra o Telegram e converse com <code>@BotFather</code></p>
              <p>2. Envie <code>/newbot</code> e siga as instruções</p>
              <p>3. Cole o token aqui e registre o webhook no Telegram:<br />
                <code>{`https://api.telegram.org/bot<TOKEN>/setWebhook?url=<webhook_url>`}</code>
              </p>
            </div>
          )}
          {channel === "meta_ads" && (
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Como configurar o Meta Lead Ads:</p>
              <p>1. Acesse developers.facebook.com e crie um App</p>
              <p>2. Adicione o produto "Webhooks" e configure a URL acima</p>
              <p>3. Use o Verify Token que você definiu aqui</p>
              <p>4. Inscreva-se no campo <code>leadgen</code> da sua Página</p>
            </div>
          )}
          {channel === "landing_page" && (
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Como usar em um formulário HTML:</p>
              <pre className="bg-muted rounded p-2 overflow-x-auto text-[10px]">{`<form action="${existing?.webhook_url ?? "<webhook_url>"}" method="POST">
  <input name="nome" placeholder="Nome" />
  <input name="email" placeholder="E-mail" />
  <input name="telefone" placeholder="Telefone" />
  <input name="empresa" placeholder="Empresa" />
  <textarea name="mensagem"></textarea>
  <button type="submit">Enviar</button>
</form>`}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CRMChannels (export principal) ───────────────────────────────────────────

export function CRMChannels() {
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listChannels()
      .then(data => setChannels(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSaved = (updated: ChannelConfig) => {
    setChannels(prev => {
      const idx = prev.findIndex(c => c.id === updated.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next.filter(c => c.is_active);
      }
      return updated.is_active ? [...prev, updated] : prev;
    });
  };

  const activeCount = channels.filter(c => c.is_active).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Canais de Entrada</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure os canais que geram leads automaticamente no CRM.
            {activeCount > 0 && <span className="ml-1 text-green-500">{activeCount} ativo{activeCount > 1 ? "s" : ""}.</span>}
          </p>
        </div>
      </div>

      {/* Canal cards */}
      <div className="grid gap-3">
        {(Object.keys(CHANNEL_META) as ChannelType[]).map(ch => (
          <ChannelCard
            key={ch}
            channel={ch}
            existing={channels.find(c => c.channel === ch && c.is_active)}
            onSaved={handleSaved}
          />
        ))}
      </div>

      {/* Footer info */}
      <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Como funciona</p>
        <p>
          Cada canal ativo cria leads automaticamente no seu pipeline. O agente qualificador é ativado
          imediatamente e responde de volta pelo mesmo canal (WhatsApp e Telegram). Leads de Landing Page
          e Meta Ads ficam na primeira etapa aguardando contato.
        </p>
      </div>
    </div>
  );
}
