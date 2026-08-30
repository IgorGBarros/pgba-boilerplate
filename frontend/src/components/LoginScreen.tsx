// frontend/src/components/LoginScreen.tsx
import { useState } from "react";
import { Boxes, Loader2 } from "lucide-react";
import { login, ApiError } from "@/lib/api";
import { saveTokens } from "@/lib/auth";

interface LoginScreenProps {
  onSuccess: () => void;
}

/**
 * Sem isso, NENHUMA chamada feita pelo navegador (CompanyOverview,
 * NewProjectModal, tudo que usa frontend/src/lib/api.ts) tinha como se
 * autenticar — api.ts lê o token do localStorage, nunca de .env (isso é
 * usado só pelo devserver, processo separado, para o fluxo de geração de
 * página). Resultado: 401 "credenciais não fornecidas" em tudo, mesmo com
 * um token válido gerado via PowerShell e colado no .env.
 */
export default function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await login(email.trim(), password);
      saveTokens(result.access, result.refresh);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao entrar. Confira email e senha.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5 rounded-card border border-white/10 bg-surface-raised p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/15">
            <Boxes className="h-5 w-5 text-brand-500" />
          </div>
          <h1 className="font-display text-lg font-semibold">Entrar no PGBA</h1>
          <p className="text-xs text-slate-500">Use o mesmo usuário criado com createsuperuser.</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Email</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Senha</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading || !email || !password}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
