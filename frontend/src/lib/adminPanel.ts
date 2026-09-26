// frontend/src/lib/adminPanel.ts
//
// Abre o Painel administrativo de qualquer lugar (caixa "Empresa" do
// organograma, engrenagem, avisos "configure a caixa de e-mail") sem passar
// prop por meia árvore. O painel vive em App.tsx e escuta este evento.
import { useEffect } from "react";

export type AdminSection =
  | "empresa"
  | "emails"
  | "saida"
  | "ia"
  | "n8n"
  | "hostinger"
  | "servidores"
  | "github"
  | "conectores"
  | "aparencia";

const EVENT = "pgba:open-admin";

export function openAdminPanel(section?: AdminSection) {
  window.dispatchEvent(new CustomEvent<AdminSection | undefined>(EVENT, { detail: section }));
}

export function useAdminPanelRequests(onOpen: (section?: AdminSection) => void) {
  useEffect(() => {
    const handler = (e: Event) => onOpen((e as CustomEvent<AdminSection | undefined>).detail);
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [onOpen]);
}

// Abrir um módulo da Empresa (ex.: Data Lake → Conectores) a partir do painel.
// Guarda o pedido no sessionStorage: o Organograma pode ainda não estar montado
// (outra área/aba aberta) — ele lê ao montar e também escuta o evento.
const MODULE_EVENT = "pgba:open-module";
const MODULE_KEY = "pgba_open_module";

export function openEmpresaModule(key: string) {
  try { sessionStorage.setItem(MODULE_KEY, key); } catch { /* aba privada */ }
  window.dispatchEvent(new CustomEvent<string>(MODULE_EVENT, { detail: key }));
}

export function takePendingModule(): string | null {
  try {
    const k = sessionStorage.getItem(MODULE_KEY);
    if (k) sessionStorage.removeItem(MODULE_KEY);
    return k;
  } catch {
    return null;
  }
}

export function useModuleRequests(onOpen: (key: string) => void) {
  useEffect(() => {
    const handler = (e: Event) => onOpen((e as CustomEvent<string>).detail);
    window.addEventListener(MODULE_EVENT, handler);
    return () => window.removeEventListener(MODULE_EVENT, handler);
  }, [onOpen]);
}
