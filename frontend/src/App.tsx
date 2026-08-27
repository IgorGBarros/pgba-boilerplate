// frontend/src/App.tsx
import { Suspense, lazy, useState } from "react";
import KnowledgeChat from "@/components/KnowledgeChat";
import GeneratedRouter from "@/components/GeneratedRouter";

// Carregado sob demanda: só quem abre o Estúdio paga o custo de
// framer-motion + cmdk + react-syntax-highlighter (~700KB) — sem isso, o
// bundle inicial ficaria inflado à toa mesmo pra quem só usa o chat de
// conhecimento. Mesmo assim é a aba PADRÃO (painel principal do sistema —
// ver CLAUDE.md), então o Suspense cobre só o primeiro carregamento.
const Studio = lazy(() => import("@/pages/Studio"));

// "Agentes" deixou de ser aba separada: absorvida pela visão "Empresa"
// dentro do próprio Studio (setores + agentes + projetos, tudo junto).
type Tab = "studio" | "knowledge" | "pages";

const TABS: { id: Tab; label: string }[] = [
  { id: "studio", label: "Estúdio" },
  { id: "knowledge", label: "Conhecimento" },
  { id: "pages", label: "Páginas geradas" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("studio");

  return (
    <main className="min-h-screen">
      <header className="flex items-center justify-between border-b border-white/5 px-6 py-4">
        <h1 className="font-display text-lg">PGBA</h1>
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-card px-3 py-1.5 text-xs font-medium transition ${
                tab === t.id ? "bg-brand-500 text-white" : "text-slate-400 hover:bg-white/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {tab === "studio" && (
        <Suspense fallback={<p className="p-6 text-sm text-slate-500">Carregando estúdio...</p>}>
          <Studio />
        </Suspense>
      )}
      {tab === "knowledge" && <KnowledgeChat />}
      {tab === "pages" && <GeneratedRouter />}
    </main>
  );
}
