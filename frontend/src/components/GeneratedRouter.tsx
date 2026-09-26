// frontend/src/components/GeneratedRouter.tsx
import { useEffect, useState } from "react";
import { routes } from "@/generated-config/routes";

/**
 * Navegação simples entre páginas geradas por `npm run generate`.
 * Para um projeto real, troque por react-router — isto é só o suficiente
 * para visualizar o que foi gerado sem adicionar uma dependência de
 * roteamento ao scaffold base.
 */
// A página ativa fica no hash (#/contato): o preview do Studio abre direto
// na página recém-gerada, e recarregar o iframe não perde onde estava.
const fromHash = () => window.location.hash.replace(/^#/, "") || null;

export default function GeneratedRouter() {
  const [active, setActiveState] = useState<string | null>(fromHash);
  useEffect(() => {
    const onHash = () => setActiveState(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const setActive = (path: string) => { window.location.hash = path; };
  const current = routes.find((r) => r.path === active);
  const Current = current?.component;

  if (routes.length === 0) {
    return (
      <p className="p-6 text-sm text-slate-500">
        Nenhuma página gerada ainda. Descreva uma página na aba “Gerar” ou rode{" "}
        <code className="rounded bg-surface-raised px-1.5 py-0.5">
          npm run generate -- "descrição da página"
        </code>
        .
      </p>
    );
  }

  return (
    <div className="p-6">
      <nav className="mb-4 flex flex-wrap gap-2">
        {routes.map((r) => (
          <button
            key={r.path}
            onClick={() => setActive(r.path)}
            className={`rounded-card px-3 py-1.5 text-xs font-medium transition ${
              active === r.path
                ? "bg-brand-500 text-white"
                : "bg-surface-raised text-slate-300 hover:bg-white/10"
            }`}
          >
            {r.name}
          </button>
        ))}
      </nav>
      {Current ? <Current /> : <p className="text-sm text-slate-500">Selecione uma página acima.</p>}
    </div>
  );
}
