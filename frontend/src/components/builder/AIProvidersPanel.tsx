// frontend/src/components/builder/AIProvidersPanel.tsx
import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  listAIProviders,
  createAIProvider,
  deleteAIProvider,
  type AIProvider,
  type AIProviderCredential,
} from "@/lib/api";

const PROVIDER_META: Record<
  AIProvider,
  { label: string; needsKey: boolean; placeholder: string; models: string[] }
> = {
  anthropic: {
    label: "Anthropic (Claude)",
    needsKey: true,
    placeholder: "sk-ant-api03-...",
    models: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"],
  },
  openai: {
    label: "OpenAI",
    needsKey: true,
    placeholder: "sk-...",
    models: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"],
  },
  groq: {
    label: "Groq",
    needsKey: true,
    placeholder: "gsk_...",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  },
  openrouter: {
    label: "OpenRouter",
    needsKey: true,
    placeholder: "sk-or-v1-...",
    models: ["moonshotai/kimi-k2", "anthropic/claude-opus-5", "meta-llama/llama-3.3-70b-instruct:free"],
  },
  ollama: {
    label: "Ollama (local)",
    needsKey: false,
    placeholder: "",
    models: ["llama3", "qwen2.5:14b", "mistral-nemo:14b", "deepseek-r1:14b", "nomic-embed-text"],
  },
};

const EMPTY_FORM = {
  provider: "anthropic" as AIProvider,
  api_key: "",
  default_model: "",
  base_url: "",
  label: "",
};

export default function AIProvidersPanel() {
  const [creds, setCreds] = useState<AIProviderCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setCreds(await listAIProviders());
    } catch {
      setError("Erro ao carregar credenciais.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (form.provider !== "ollama") {
      setOllamaModels([]);
      return;
    }
    const baseUrl = (form.base_url || "http://ollama:11434").replace(/\/$/, "");
    let cancelled = false;
    fetch(`${baseUrl}/api/tags`)
      .then((r) => r.json())
      .then((data: { models?: { name: string }[] }) => {
        if (!cancelled) setOllamaModels((data.models ?? []).map((m) => m.name));
      })
      .catch(() => {
        if (!cancelled) setOllamaModels([]);
      });
    return () => { cancelled = true; };
  }, [form.provider, form.base_url]);

  const notify = (msg: string, type: "ok" | "err") => {
    if (type === "ok") {
      setSuccess(msg);
      setError(null);
      setTimeout(() => setSuccess(null), 3500);
    } else {
      setError(msg);
      setSuccess(null);
    }
  };

  async function handleSave() {
    const meta = PROVIDER_META[form.provider];
    if (meta.needsKey && !form.api_key.trim()) {
      notify("A chave de API é obrigatória para este provedor.", "err");
      return;
    }
    if (!form.default_model.trim()) {
      notify("Informe o modelo padrão.", "err");
      return;
    }
    setSaving(true);
    try {
      await createAIProvider({
        provider: form.provider,
        api_key: form.api_key || undefined,
        default_model: form.default_model,
        base_url: form.base_url || undefined,
        label: form.label || undefined,
      });
      notify("Provedor salvo com sucesso.", "ok");
      setShowForm(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : "Erro ao salvar.", "err");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number, providerLabel: string) {
    if (!confirm(`Remover credencial "${providerLabel}"?`)) return;
    try {
      await deleteAIProvider(id);
      notify("Credencial removida.", "ok");
      await load();
    } catch {
      notify("Erro ao remover.", "err");
    }
  }

  const activeCreds = creds.filter((c) => c.is_active);
  const meta = PROVIDER_META[form.provider];

  return (
    <div className="space-y-4">
      {/* Feedback */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {success}
        </div>
      )}

      {/* Lista de credenciais ativas */}
      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando...
        </div>
      ) : activeCreds.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhum provedor configurado — use o formulário abaixo.</p>
      ) : (
        <div className="space-y-2">
          {activeCreds.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-surface px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-200">
                  {PROVIDER_META[c.provider as AIProvider]?.label ?? c.provider}
                  {c.label ? <span className="ml-1.5 text-slate-500">({c.label})</span> : null}
                </p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                  {c.default_model || <span className="italic">sem modelo padrão</span>}
                  {" · "}
                  {c.api_key_masked}
                </p>
              </div>
              <button
                onClick={() => handleDelete(c.id, PROVIDER_META[c.provider as AIProvider]?.label ?? c.provider)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                title="Remover credencial"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Botão para abrir formulário */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-400 hover:border-brand-500/40 hover:text-brand-400"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar provedor
        </button>
      )}

      {/* Formulário */}
      {showForm && (
        <div className="space-y-3 rounded-lg border border-white/10 bg-surface p-3">
          <h4 className="text-xs font-semibold text-slate-300">Novo provedor</h4>

          {/* Provedor */}
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500">Provedor</span>
            <select
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as AIProvider, default_model: "", api_key: "" }))}
              className="w-full rounded-md border border-white/10 bg-surface-raised px-2 py-1.5 text-xs text-slate-200"
            >
              {(Object.keys(PROVIDER_META) as AIProvider[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_META[p].label}</option>
              ))}
            </select>
          </label>

          {/* API Key */}
          {meta.needsKey && (
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-500">Chave de API</span>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={form.api_key}
                  onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                  placeholder={meta.placeholder}
                  className="w-full rounded-md border border-white/10 bg-surface-raised px-2 py-1.5 pr-8 font-mono text-xs text-slate-200 placeholder:text-slate-600"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>
            </label>
          )}

          {/* Modelo */}
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500">Modelo padrão</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.default_model}
                onChange={(e) => setForm((f) => ({ ...f, default_model: e.target.value }))}
                placeholder="ex: claude-haiku-4-5"
                list={`models-${form.provider}`}
                className="flex-1 rounded-md border border-white/10 bg-surface-raised px-2 py-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-600"
              />
              <datalist id={`models-${form.provider}`}>
                {(form.provider === "ollama" && ollamaModels.length > 0 ? ollamaModels : meta.models).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            <p className="text-[10px] text-slate-600">
              {form.provider === "ollama" && ollamaModels.length > 0
                ? `Modelos detectados: ${ollamaModels.join(", ")}`
                : `Sugestões: ${meta.models.join(", ")}`}
            </p>
          </label>

          {/* Base URL (opcional) */}
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500">Base URL <span className="text-slate-600">(opcional — deixe vazio para o padrão)</span></span>
            <input
              type="text"
              value={form.base_url}
              onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
              placeholder={form.provider === "ollama" ? "http://ollama:11434" : ""}
              className="w-full rounded-md border border-white/10 bg-surface-raised px-2 py-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-600"
            />
          </label>

          {/* Label */}
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500">Rótulo <span className="text-slate-600">(opcional)</span></span>
            <input
              type="text"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="ex: produção, dev, cliente X"
              className="w-full rounded-md border border-white/10 bg-surface-raised px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600"
            />
          </label>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 hover:bg-brand-600"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              Salvar
            </button>
            <button
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setError(null); }}
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-slate-600">
        A chave é armazenada criptografada no banco (Fernet). O provedor ativo com maior prioridade
        (OpenRouter → Groq → OpenAI → Anthropic → Ollama) é usado automaticamente.
      </p>
    </div>
  );
}
