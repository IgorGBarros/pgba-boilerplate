// frontend/src/components/builder/SettingsModal.tsx
//
// Engrenagem do header: preferências DESTE navegador (tema, fonte, editor).
// Tudo vem de usePreferences() (lib/ThemeContext) — aplica na hora e fica
// salvo. Configuração da empresa (IA, e-mails, integrações) fica no Painel
// administrativo, não aqui.
import { Monitor, Moon, RotateCcw, Settings2, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FONT_FAMILIES, usePreferences, type FontFamilyPref, type ThemePreference } from "@/lib/ThemeContext";
import { openAdminPanel } from "@/lib/adminPanel";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const THEMES: { id: ThemePreference; label: string; icon: React.ElementType }[] = [
  { id: "light", label: "Claro", icon: Sun },
  { id: "dark", label: "Escuro", icon: Moon },
  { id: "system", label: "Sistema", icon: Monitor },
];

export function AppearanceSettings() {
  const { prefs, update, reset } = usePreferences();
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tema</h3>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => {
            const active = prefs.theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => update({ theme: t.id })}
                aria-pressed={active}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-sm transition ${
                  active ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                }`}
              >
                <t.icon className="size-4" />
                {t.label}
              </button>
            );
          })}
        </div>
        {prefs.theme === "system" && <p className="text-xs text-muted-foreground">Segue o tema do sistema operacional e muda junto.</p>}
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fonte</h3>
        <label className="block space-y-1.5 text-sm">
          <span className="flex items-center justify-between">
            Tamanho do texto
            <span className="tabular-nums text-muted-foreground">{prefs.uiFontSize}px{prefs.uiFontSize === 16 ? " (padrão)" : ""}</span>
          </span>
          <input
            type="range"
            min={13}
            max={20}
            step={1}
            value={prefs.uiFontSize}
            onChange={(e) => update({ uiFontSize: Number(e.target.value) })}
            className="w-full accent-primary"
            aria-label="Tamanho do texto"
          />
          <span className="flex justify-between text-[11px] text-muted-foreground"><span>menor</span><span>maior</span></span>
        </label>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(FONT_FAMILIES) as FontFamilyPref[]).map((id) => {
            const f = FONT_FAMILIES[id];
            const active = prefs.fontFamily === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => update({ fontFamily: id })}
                aria-pressed={active}
                style={{ fontFamily: f.body }}
                className={`rounded-xl border p-3 text-left text-sm transition ${
                  active ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                }`}
              >
                <span className="block text-base font-semibold" style={{ fontFamily: f.display }}>Aa</span>
                {f.label}
              </button>
            );
          })}
        </div>
        <p className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
          Prévia: <span className="text-foreground">O agente de Compras enviou 3 cotações hoje.</span>
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Editor de código</h3>
        <label className="flex items-center justify-between text-sm">
          Tamanho da fonte do código
          <select
            value={prefs.editorFontSize}
            onChange={(e) => update({ editorFontSize: Number(e.target.value) })}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
          >
            {[10, 11, 12, 13, 14, 15, 16, 18].map((n) => <option key={n} value={n}>{n}px</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between text-sm">
          Quebra de linha automática
          <input type="checkbox" checked={prefs.wordWrap} onChange={(e) => update({ wordWrap: e.target.checked })} className="size-4 accent-primary" />
        </label>
      </section>

      <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
        <RotateCcw className="size-3.5" /> Restaurar padrão
      </Button>
    </div>
  );
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Preferências</DialogTitle>
          <DialogDescription>Aparência deste navegador — vale na hora e fica salvo.</DialogDescription>
        </DialogHeader>
        <AppearanceSettings />
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/40 p-3">
          <p className="text-sm text-muted-foreground">IA, e-mails dos setores, n8n, Hostinger, servidores e integrações ficam no painel da empresa.</p>
          <Button size="sm" onClick={() => { onClose(); openAdminPanel(); }}>
            <Settings2 className="size-3.5" /> Painel administrativo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
