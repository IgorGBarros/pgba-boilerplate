// frontend/src/App.tsx
import { Suspense, lazy, useState } from "react";
import KnowledgeChat from "@/components/KnowledgeChat";
import GeneratedRouter from "@/components/GeneratedRouter";
import AgentStatusBoard from "@/components/AgentStatusBoard";

// Carregado sob demanda: só quem abre a aba "Estúdio" paga o custo de
// framer-motion + cmdk + react-syntax-highlighter (~700KB) — sem isso, o
// bundle inicial de quem só usa o chat de conhecimento ficava inflado à toa.
const Studio = lazy(() => import("@/pages/Studio"));

type Tab = "knowledge" | "agents" | "pages" | "studio";

const TABS: { id: Tab; label: string }[] = [
  { id: "knowledge", label: "Conhecimento" },
  { id: "agents", label: "Agentes" },
  { id: "pages", label: "Páginas geradas" },
  { id: "studio", label: "Estúdio" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("knowledge");

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

      {tab === "knowledge" && <KnowledgeChat />}
      {tab === "agents" && <AgentStatusBoard />}
      {tab === "pages" && <GeneratedRouter />}
      {tab === "studio" && (
        <Suspense fallback={<p className="p-6 text-sm text-slate-500">Carregando estúdio...</p>}>
          <Studio />
        </Suspense>
      )}
    </main>
  );
}
