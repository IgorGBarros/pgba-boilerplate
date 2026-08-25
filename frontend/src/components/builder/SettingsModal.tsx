// frontend/src/components/builder/SettingsModal.tsx
import { X } from "lucide-react";
import type { AppSettings } from "@/types/settings";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdate: (partial: Partial<AppSettings>) => void;
  onReset: () => void;
}

export default function SettingsModal({ isOpen, onClose, settings, onUpdate, onReset }: SettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-white/10 bg-surface-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Configurações</h2>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 p-5">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Aparência</h3>

            <label className="flex items-center justify-between text-sm text-slate-300">
              Tema
              <select
                value={settings.theme}
                onChange={(e) => onUpdate({ theme: e.target.value as AppSettings["theme"] })}
                className="rounded-md border border-white/10 bg-surface px-2 py-1 text-xs text-slate-200"
              >
                <option value="dark">Escuro</option>
                <option value="light">Claro</option>
                <option value="system">Sistema</option>
              </select>
            </label>

            <label className="flex items-center justify-between text-sm text-slate-300">
              Tamanho da fonte (interface)
              <input
                type="number"
                min={10}
                max={20}
                value={settings.uiFontSize}
                onChange={(e) => onUpdate({ uiFontSize: Number(e.target.value) })}
                className="w-16 rounded-md border border-white/10 bg-surface px-2 py-1 text-xs text-slate-200"
              />
            </label>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Editor (visualizador de código)</h3>

            <label className="flex items-center justify-between text-sm text-slate-300">
              Tamanho da fonte
              <input
                type="number"
                min={10}
                max={18}
                value={settings.editorFontSize}
                onChange={(e) => onUpdate({ editorFontSize: Number(e.target.value) })}
                className="w-16 rounded-md border border-white/10 bg-surface px-2 py-1 text-xs text-slate-200"
              />
            </label>

            <label className="flex items-center justify-between text-sm text-slate-300">
              Quebra de linha automática
              <input
                type="checkbox"
                checked={settings.wordWrap}
                onChange={(e) => onUpdate({ wordWrap: e.target.checked })}
                className="h-4 w-4 accent-brand-500"
              />
            </label>
          </section>

          <section className="space-y-2 rounded-lg border border-white/10 bg-surface p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">IA</h3>
            <p className="text-xs leading-relaxed text-slate-400">
              O modelo e a credencial usados na geração são configurados no backend (<code className="rounded bg-white/5 px-1">harness</code>),
              nunca aqui — isso mantém a chave de API fora do navegador e centralizada por tenant. Para trocar de modelo:
            </p>
            <pre className="overflow-x-auto rounded-md bg-black/30 p-2 text-[11px] text-slate-300">
              docker compose exec backend python manage.py configure_ai_provider --provider ollama --model qwen2.5-coder
            </pre>
          </section>

          <button onClick={onReset} className="text-xs text-slate-500 underline decoration-dotted hover:text-slate-300">
            Restaurar configurações padrão
          </button>
        </div>
      </div>
    </div>
  );
}
