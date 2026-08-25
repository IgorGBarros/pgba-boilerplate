// frontend/src/types/settings.ts
//
// Deliberadamente SEM `ollamaUrl`/`models`/`temperature` (como o
// LovableClone original tinha) — configuração de provedor de IA vive no
// `harness` do backend (criptografada, por tenant), nunca no navegador.
// Ver SettingsModal.tsx, aba "IA".
export interface AppSettings {
  theme: "light" | "dark" | "system";
  uiFontSize: number;
  language: "pt-BR" | "en";

  editorFontSize: number;
  tabSize: number;
  wordWrap: boolean;

  autoScroll: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  uiFontSize: 14,
  language: "pt-BR",
  editorFontSize: 12,
  tabSize: 2,
  wordWrap: true,
  autoScroll: true,
};
