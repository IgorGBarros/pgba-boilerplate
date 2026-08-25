// frontend/src/hooks/useSettings.ts
import { useState, useCallback, useEffect } from "react";
import { AppSettings, DEFAULT_SETTINGS } from "@/types/settings";

const STORAGE_KEY = "pgba-studio-settings";

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {
      // ignora JSON inválido — cai no default
    }
    return { ...DEFAULT_SETTINGS };
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const root = document.documentElement;
    const isDark =
      settings.theme === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : settings.theme === "dark";
    root.classList.toggle("light", !isDark);
  }, [settings.theme]);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettingsState({ ...DEFAULT_SETTINGS });
  }, []);

  return { settings, updateSettings, resetSettings };
}
