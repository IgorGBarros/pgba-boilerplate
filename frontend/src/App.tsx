// frontend/src/App.tsx
import { Suspense, lazy, useState } from "react";
import { Boxes, LogOut } from "lucide-react";
import KnowledgeChat from "@/components/KnowledgeChat";
import GeneratedRouter from "@/components/GeneratedRouter";
import LoginScreen from "@/components/LoginScreen";
import { isLoggedIn, logout } from "@/lib/auth";

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

// Altura real do header (56px) — usada pelo Studio para calcular sua
// própria altura (`h-[calc(100vh-var(--pgba-header-h))]`). Um valor só,
// nunca dois números que podem descolar um do outro.
export const HEADER_HEIGHT_PX = 56;

const params = new URLSearchParams(window.location.search);
// Modo embutido — usado SÓ pelo preview do próprio Studio quando o
// projeto selecionado é o "Principal": sem isso, o iframe carregaria o
// app inteiro de novo (cabeçalho, abas, e a própria aba Estúdio com OUTRO
// iframe apontando pra si mesma — a "boneca russa" que aparecia na tela).
// Com `?embed=1`, esconde cabeçalho/abas e mostra só o conteúdo da aba
// pedida em `?tab=` (`pages` por padrão — é o "produto" de verdade sendo
// construído, não a ferramenta que constrói).
const isEmbedded = params.get("embed") === "1";
const embeddedTab = (params.get("tab") as Tab | null) ?? "pages";

export default function App() {
  const [tab, setTab] = useState<Tab>(isEmbedded ? embeddedTab : "studio");
  const [authed, setAuthed] = useState(isLoggedIn());

  if (isEmbedded) {
    return (
      <main className="min-h-screen bg-surface">
        {tab === "studio" && (
          <Suspense fallback={null}>
            <Studio />
          </Suspense>
        )}
        {tab === "knowledge" && <KnowledgeChat />}
        {tab === "pages" && <GeneratedRouter />}
      </main>
    );
  }

  // Sem isso, toda chamada feita pelo navegador (agentes, setores,
  // métricas — tudo que agency/CompanyOverview usa) volta 401 "credenciais
  // não fornecidas": api.ts lê o token do localStorage, que só é
  // preenchido depois de um login de verdade — nunca pelo PGBA_ACCESS_TOKEN
  // do .env (isso é usado só pelo devserver, processo separado).
  if (!authed) {
    return <LoginScreen onSuccess={() => setAuthed(true)} />;
  }

  return (
    <main className="min-h-screen bg-surface">
      <header
        style={{ height: HEADER_HEIGHT_PX }}
        className="flex items-center justify-between gap-3 border-b border-white/10 bg-surface-raised/80 px-4 backdrop-blur-sm sm:px-6"
      >
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/15">
            <Boxes className="h-4 w-4 text-brand-500" />
          </div>
          <h1 className="font-display text-base font-semibold tracking-tight sm:text-lg">PGBA</h1>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <nav className="flex min-w-0 gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`shrink-0 whitespace-nowrap rounded-card px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                  tab === t.id ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <button onClick={logout} title="Sair" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white/5 hover:text-slate-200">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {tab === "studio" && (
        <Suspense
          fallback={
            <div className="flex h-[60vh] items-center justify-center">
              <p className="text-sm text-slate-500">Carregando estúdio...</p>
            </div>
          }
        >
          <Studio />
        </Suspense>
      )}
      {tab === "knowledge" && <KnowledgeChat />}
      {tab === "pages" && <GeneratedRouter />}
    </main>
  );
}