// office3d/providers.ts — nome legível do provedor de IA (Sector/Agent.default_provider).
import type { ProviderCost } from "@/lib/api";

export const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Claude",
  groq: "Groq",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama (local)",
};

/** Provedores que o backend aceita (harness.AIProviderCredential.Provider). */
export const PROVIDERS = ["anthropic", "groq", "openai", "openrouter", "ollama"] as const;

/** Cor fixa por provedor (barras de custo). "" = interação anterior ao registro de provedor. */
export const PROVIDER_COLOR: Record<string, string> = {
  anthropic: "#d97757",
  groq: "#f55036",
  openai: "#10a37f",
  openrouter: "#6366f1",
  ollama: "#78716c",
  "": "#d6d3d1",
};

export function providerName(provider: string): string {
  return provider ? PROVIDER_LABEL[provider] ?? provider : "sem registro";
}

/** Custo estimado em US$ — 2 casas quando dá, 4 quando é centavo de centavo. */
export function formatUsd(usd: number): string {
  if (usd === 0) return "US$ 0";
  return usd >= 1 ? `US$ ${usd.toFixed(2)}` : `US$ ${usd.toFixed(4)}`;
}

/** Soma várias listas por provedor (ex: todos os setores). */
export function sumByProvider(lists: ProviderCost[][]): ProviderCost[] {
  const acc = new Map<string, ProviderCost>();
  for (const list of lists) {
    for (const r of list) {
      const cur = acc.get(r.provider) ?? { provider: r.provider, cost_usd: 0, tokens: 0, calls: 0 };
      acc.set(r.provider, {
        provider: r.provider,
        cost_usd: cur.cost_usd + r.cost_usd,
        tokens: cur.tokens + r.tokens,
        calls: cur.calls + r.calls,
      });
    }
  }
  return [...acc.values()].sort((a, b) => b.cost_usd - a.cost_usd);
}
