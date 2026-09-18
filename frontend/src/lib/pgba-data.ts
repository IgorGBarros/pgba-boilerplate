// Tipos locais de display (subset dos tipos de api.ts adaptados para UI).
// Não contém mais dados mock — os componentes buscam via api.ts.

export type AgentStatus = "working" | "idle" | "paused";
export type DocType = "PDF" | "Documento" | "Imagem" | "Planilha";

export const aiModels: string[] = [
  "gpt-6-astra",
  "claude-opus-5",
  "gemini-2.5-pro",
  "kimi-k2",
  "llama-3.3-70b",
  "mistral-large",
  "ollama/llama3",
];
