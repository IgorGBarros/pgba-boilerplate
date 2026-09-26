// frontend/src/lib/ThemeContext.tsx
//
// Preferências de aparência do navegador (tema, tamanho e família da fonte,
// editor) — um lugar só. Antes a engrenagem guardava isso num estado do
// Studio que ninguém lia: mudar tema/fonte não fazia nada e sumia ao recarregar.
//
// - tema: claro / escuro / "sistema" (segue o SO e muda junto);
// - tamanho: `font-size` do <html> — o Tailwind é todo em rem, então a
//   interface inteira escala junto (texto e espaçamentos);
// - família: variáveis --font-body/--font-display (index.css + tailwind.config).
// Guardado em localStorage ("pgba-prefs"; "pgba-theme" continua pro legado).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";
export type FontFamilyPref = "padrao" | "sistema" | "legivel";

export interface Preferences {
  theme: ThemePreference;
  uiFontSize: number; // px do <html>; 16 = padrão do navegador
  fontFamily: FontFamilyPref;
  editorFontSize: number;
  wordWrap: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark",
  uiFontSize: 16,
  fontFamily: "padrao",
  editorFontSize: 12,
  wordWrap: true,
};

export const FONT_FAMILIES: Record<FontFamilyPref, { label: string; body: string; display: string }> = {
  padrao: { label: "Padrão (DM Sans)", body: "'DM Sans', sans-serif", display: "'Space Grotesk', sans-serif" },
  sistema: {
    label: "Do sistema",
    body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    display: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  legivel: {
    label: "Alta legibilidade (Atkinson)",
    body: "'Atkinson Hyperlegible', sans-serif",
    display: "'Atkinson Hyperlegible', sans-serif",
  },
};

const PREFS_KEY = "pgba-prefs";
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

function readPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Preferences>) : {};
    const legacy = localStorage.getItem("pgba-theme") as Theme | null;
    // Sem preferências salvas ainda: herda o tema da chave antiga
    const merged = { ...DEFAULT_PREFERENCES, ...(legacy ? { theme: legacy } : {}), ...saved };
    return {
      ...merged,
      uiFontSize: clamp(merged.uiFontSize, 13, 20),
      editorFontSize: clamp(merged.editorFontSize, 10, 20),
      fontFamily: merged.fontFamily in FONT_FAMILIES ? merged.fontFamily : "padrao",
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

interface ThemeContextValue {
  /** Tema efetivo (resolve "sistema"). */
  theme: Theme;
  toggle: () => void;
  prefs: Preferences;
  update: (partial: Partial<Preferences>) => void;
  reset: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggle: () => {},
  prefs: DEFAULT_PREFERENCES,
  update: () => {},
  reset: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(readPrefs);
  const [system, setSystem] = useState<Theme>(systemTheme);

  // "Sistema": acompanha a troca de tema do SO em tempo real
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const theme: Theme = prefs.theme === "system" ? system : prefs.theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    root.style.fontSize = `${prefs.uiFontSize}px`;
    const fam = FONT_FAMILIES[prefs.fontFamily] ?? FONT_FAMILIES.padrao;
    root.style.setProperty("--font-body", fam.body);
    root.style.setProperty("--font-display", fam.display);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      localStorage.setItem("pgba-theme", theme);
    } catch {
      // storage bloqueado (aba privada etc.): vale só nesta sessão
    }
  }, [prefs, theme]);

  const update = useCallback((partial: Partial<Preferences>) => setPrefs((p) => ({ ...p, ...partial })), []);
  // "Restaurar padrão" volta fonte/editor; o tema escolhido continua (tem botão próprio)
  const reset = useCallback(() => setPrefs((p) => ({ ...DEFAULT_PREFERENCES, theme: p.theme })), []);
  const toggle = useCallback(
    () => setPrefs((p) => ({ ...p, theme: (p.theme === "system" ? system : p.theme) === "dark" ? "light" : "dark" })),
    [system],
  );

  const value = useMemo(() => ({ theme, toggle, prefs, update, reset }), [theme, toggle, prefs, update, reset]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/** Mesmo contexto, nome mais claro pra quem só quer as preferências. */
export const usePreferences = useTheme;
