// frontend/src/App.tsx
import { Suspense, lazy, useState } from "react";
import { Boxes, Building2, Cuboid, FolderTree, LibraryBig, LogOut, PanelsTopLeft, Settings } from "lucide-react";
import KnowledgeChat from "@/components/KnowledgeChat";
import GeneratedRouter from "@/components/GeneratedRouter";
import LoginScreen from "@/components/LoginScreen";
import { isLoggedIn, logout } from "@/lib/auth";
import { RealtimeProvider } from "@/lib/RealtimeContext";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AdminPanelHost } from "@/components/admin/AdminPanel";
import { AssinarPage, VerificarPage } from "@/pages/AssinarPage";
import { MarketingConectado } from "@/pages/MarketingConectado";
import { StatusPage } from "@/pages/StatusPage";
import type { Section } from "@/lib/navigation";

// Carregado sob demanda: só quem abre o Estúdio paga o custo de
// framer-motion + cmdk + react-syntax-highlighter (~700KB) — sem isso, o
// bundle inicial ficaria inflado à toa. É a área PADRÃO (painel principal
// do sistema — ver CLAUDE.md), então o Suspense cobre só o 1º carregamento.
const Studio = lazy(() => import("@/pages/Studio"));

// Navegação ÚNICA, no header. Antes eram três níveis (Estúdio/Conhecimento/
// Páginas no topo, Empresa/Tarefas/Aprovações/Conhecimento/Logs no Estúdio,
// Visão Geral/Projetos/Escritório 3D na Empresa) — com as tarefas dentro dos
// agentes, várias abas repetiam a mesma coisa. Tarefas, Aprovações e
// Atividade agora ficam dentro de Empresa; Conhecimento (chat + biblioteca)
// virou uma área só, ao lado do Escritório 3D.
const NAV: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "empresa", label: "Empresa", icon: Building2 },
  { id: "office", label: "Escritório 3D", icon: Cuboid },
  { id: "knowledge", label: "Conhecimento", icon: LibraryBig },
  { id: "projects", label: "Projetos", icon: FolderTree },
];

const SECTION_KEY = "pgba_section";
const VALID: Section[] = ["empresa", "office", "knowledge", "projects", "gerar", "pages"];

function readSection(): Section {
  try {
    const s = sessionStorage.getItem(SECTION_KEY) as Section | null;
    return s && VALID.includes(s) ? s : "empresa";
  } catch {
    return "empresa";
  }
}

// Modo embutido (preview do próprio Studio): só aceita estas visões
type EmbedTab = "studio" | "knowledge" | "pages";

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
const embeddedTab = (params.get("tab") as EmbedTab | null) ?? "pages";

// Páginas públicas (sem login): assinatura por link pessoal e verificação de PDF
const assinarToken = window.location.pathname.match(/^\/assinar\/([\w-]+)\/?$/)?.[1];
const isVerificar = /^\/verificar\/?$/.test(window.location.pathname);
const isMarketingConectado = /^\/marketing-conectado\/?$/.test(window.location.pathname);
const isStatus = /^\/status\/?$/.test(window.location.pathname);

export default function App() {
  if (assinarToken) return <AssinarPage token={assinarToken} />;
  if (isVerificar) return <VerificarPage />;
  if (isMarketingConectado) return <MarketingConectado />;
  if (isStatus) return <StatusPage />;
  return <MainApp />;
}

function MainApp() {
  const [section, setSectionState] = useState<Section>(readSection);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authed, setAuthed] = useState(isLoggedIn());

  const setSection = (next: Section) => {
    try { sessionStorage.setItem(SECTION_KEY, next); } catch { /* aba privada */ }
    setSectionState(next);
  };

  if (isEmbedded) {
    return (
      <main className="min-h-screen bg-background">
        {embeddedTab === "studio" && (
          <Suspense fallback={null}>
            <Studio section="empresa" onNavigate={() => {}} settingsOpen={false} onSettingsOpenChange={() => {}} />
          </Suspense>
        )}
        {embeddedTab === "knowledge" && <KnowledgeChat />}
        {embeddedTab === "pages" && <GeneratedRouter />}
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

  // "Gerar" é aberto a partir de Projetos — o menu continua marcando Projetos
  const activeNav: Section = section === "gerar" ? "projects" : section;

  return (
    <RealtimeProvider>
    <main className="min-h-screen bg-background">
      <header
        style={{ height: HEADER_HEIGHT_PX }}
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface/90 px-3 backdrop-blur-sm sm:px-5"
      >
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Boxes className="h-4 w-4" />
          </div>
          <h1 className="font-display text-base font-semibold tracking-tight">PGBA</h1>
        </div>

        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:ml-4">
          {NAV.map((item) => {
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <item.icon className="size-4" />
                <span className="hidden md:inline">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setSection("pages")}
            title="Páginas geradas — o produto sendo construído"
            className={`flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors ${
              section === "pages" ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <PanelsTopLeft className="size-4" />
            <span className="hidden lg:inline">Páginas geradas</span>
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Configurações"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Settings className="size-4" />
          </button>
          <ThemeToggle />
          <button
            onClick={logout}
            title="Sair"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      {section === "pages" ? (
        <GeneratedRouter />
      ) : (
        <Suspense
          fallback={
            <div className="flex h-[60vh] items-center justify-center">
              <p className="text-sm text-muted-foreground">Carregando…</p>
            </div>
          }
        >
          <Studio
            section={section}
            onNavigate={setSection}
            settingsOpen={settingsOpen}
            onSettingsOpenChange={setSettingsOpen}
          />
        </Suspense>
      )}
      {/* Painel administrativo — abre pela caixa Empresa do organograma ou pela engrenagem */}
      <AdminPanelHost onNavigateEmpresa={() => setSection("empresa")} />
    </main>
    </RealtimeProvider>
  );
}
