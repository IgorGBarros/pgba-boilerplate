// office3d/AIConfigModal.tsx — configurar chaves de IA sem sair do Escritório.
//
// Mesmo painel das Configurações do Studio (AIProvidersPanel: status,
// testar conexão, cadastrar chave) — aberto a partir do aviso "IA sem
// credencial" da planta ou da janela da sala, já no provedor que falta.
import { useEffect } from "react";
import { KeyRound, X } from "lucide-react";
import AIProvidersPanel from "../AIProvidersPanel";
import type { AIProvider } from "@/lib/api";

export function AIConfigModal({
  open,
  provider,
  onClose,
}: {
  open: boolean;
  /** Provedor que falta (abre o formulário dele). */
  provider?: AIProvider;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-stone-900/25 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88%] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf8f4] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-stone-200 px-4 py-3">
          <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-stone-200 text-stone-700"><KeyRound className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-800">Configurar IA</p>
            <p className="text-xs text-stone-500">Chaves ficam criptografadas no banco — as mesmas das Configurações do Studio.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-800"><X className="size-4" /></button>
        </div>
        {/* O painel é do Studio (tema escuro): roda num cartão escuro próprio */}
        <div className="dark min-h-0 flex-1 overflow-y-auto bg-slate-900 px-4 py-3">
          <AIProvidersPanel focusProvider={provider} />
        </div>
      </div>
    </div>
  );
}
