// office3d/providers.ts — nome legível do provedor de IA (Sector/Agent.default_provider).
export const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Claude",
  groq: "Groq",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama (local)",
};

/** Provedores que o backend aceita (harness.AIProviderCredential.Provider). */
export const PROVIDERS = ["anthropic", "groq", "openai", "openrouter", "ollama"] as const;
