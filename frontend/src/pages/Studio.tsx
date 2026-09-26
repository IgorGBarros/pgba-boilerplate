// frontend/src/pages/Studio.tsx — conteúdo de cada área do header (App.tsx).
//
// A navegação mora no header (uma barra só). Aqui só:
// - Empresa: Organograma · Tarefas · Aprovações · Atividade (antes eram abas
//   soltas no topo do Estúdio — com as tarefas dentro dos agentes, pertencem
//   à empresa);
// - Escritório 3D, Conhecimento (chat + biblioteca), Projetos e Gerar.
import { lazy, Suspense, useEffect, useState } from "react";
import { ClipboardList, Network, ScrollText, ShieldCheck } from "lucide-react";
import { Toaster } from "sonner";
import { Overview } from "@/components/empresa/overview";
import { Tasks } from "@/components/empresa/tasks";
import { Approvals } from "@/components/empresa/approvals";
import { Knowledge } from "@/components/empresa/knowledge";
import { Logs } from "@/components/empresa/logs";
import { Projects } from "@/components/empresa/projects";
import { ImportProjectDialog, NewProjectDialog, NewTaskDialog } from "@/components/empresa/dialogs";
import GeneratePanel from "@/components/builder/GeneratePanel";
import SettingsModal from "@/components/builder/SettingsModal";
import { DEFAULT_SETTINGS, type AppSettings } from "@/types/settings";
import { listPendingApprovals } from "@/lib/api";
import { useRealtime } from "@/lib/useRealtime";
import { useTheme } from "@/lib/ThemeContext";
import type { EmpresaTab, Section } from "@/lib/navigation";

const CompanyOffice3D = lazy(() => import("@/components/builder/CompanyOffice3D"));

const EMPRESA_TABS: { id: EmpresaTab; label: string; icon: React.ElementType }[] = [
  { id: "org", label: "Organograma", icon: Network },
  { id: "tasks", label: "Tarefas", icon: ClipboardList },
  { id: "approvals", label: "Aprovações", icon: ShieldCheck },
  { id: "activity", label: "Atividade", icon: ScrollText },
];

const EMPRESA_TAB_KEY = "pgba_empresa_tab";

function readEmpresaTab(): EmpresaTab {
  try {
    const t = sessionStorage.getItem(EMPRESA_TAB_KEY) as EmpresaTab | null;
    return t && EMPRESA_TABS.some((x) => x.id === t) ? t : "org";
  } catch {
    return "org";
  }
}

export default function Studio({
  section,
  onNavigate,
  settingsOpen,
  onSettingsOpenChange,
}: {
  section: Section;
  onNavigate: (s: Section) => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}) {
  const { theme } = useTheme();
  const [empresaTab, setEmpresaTabState] = useState<EmpresaTab>(readEmpresaTab);
  const [newTask, setNewTask] = useState(false);
  const [taskSector, setTaskSector] = useState<string | undefined>(undefined);
  const [gerarProjectId, setGerarProjectId] = useState<number | undefined>(undefined);
  const [newProject, setNewProject] = useState(false);
  const [importProject, setImportProject] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);

  const setEmpresaTab = (tab: EmpresaTab) => {
    try { sessionStorage.setItem(EMPRESA_TAB_KEY, tab); } catch { /* aba privada */ }
    setEmpresaTabState(tab);
  };

  // Contador de aprovações pendentes na aba (atualiza com o WebSocket)
  const { lastPendingApprovalEvent } = useRealtime();
  useEffect(() => {
    listPendingApprovals("pending")
      .then((list) => setPendingApprovals(list.length))
      .catch(() => setPendingApprovals(null));
  }, [lastPendingApprovalEvent]);

  const openTask = (sector?: string) => {
    setTaskSector(sector);
    setNewTask(true);
  };

  const openGerar = (projectId?: number) => {
    if (projectId !== undefined) setGerarProjectId(projectId);
    onNavigate("gerar");
  };

  return (
    <>
      <Toaster richColors position="top-right" theme={theme} />

      {section === "empresa" && (
        <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 md:px-6">
          <div className="sticky top-14 z-20 -mx-4 mb-5 flex items-center gap-1 overflow-x-auto border-b border-border bg-background/90 px-4 py-2 backdrop-blur md:-mx-6 md:px-6">
            {EMPRESA_TABS.map((tab) => {
              const active = empresaTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setEmpresaTab(tab.id)}
                  className={`relative flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    active ? "bg-surface text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <tab.icon className="size-4" />
                  {tab.label}
                  {tab.id === "approvals" && pendingApprovals ? (
                    <span className="ml-0.5 rounded-full bg-orange-500 px-1.5 text-[10px] font-semibold leading-4 text-white">
                      {pendingApprovals}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {empresaTab === "org" && <Overview onNewTask={openTask} />}
          {empresaTab === "tasks" && <Tasks onNewTask={openTask} />}
          {empresaTab === "approvals" && <Approvals />}
          {empresaTab === "activity" && <Logs />}
        </div>
      )}

      {section === "office" && (
        <div style={{ height: "calc(100vh - 56px)" }}>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">Carregando escritório 3D…</p>
              </div>
            }
          >
            <CompanyOffice3D />
          </Suspense>
        </div>
      )}

      {section === "knowledge" && (
        <div className="px-4 py-4 md:px-6">
          <Knowledge />
        </div>
      )}

      {section === "projects" && (
        <div className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-5 md:px-6">
          <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Desenvolvimento</span> é o setor responsável por trabalhar
            nos projetos novos e existentes da plataforma.
          </div>
          <Projects
            onNewProject={() => setNewProject(true)}
            onImportProject={() => setImportProject(true)}
            onNewTask={openTask}
            onOpenGerar={openGerar}
          />
        </div>
      )}

      {/* Gerar ocupa toda a altura disponível — aberto a partir de Projetos */}
      {section === "gerar" && <GeneratePanel initialProjectId={gerarProjectId} />}

      <NewTaskDialog open={newTask} onOpenChange={setNewTask} sector={taskSector} />
      <NewProjectDialog open={newProject} onOpenChange={setNewProject} />
      <ImportProjectDialog open={importProject} onOpenChange={setImportProject} />
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => onSettingsOpenChange(false)}
        settings={settings}
        onUpdate={(partial) => setSettings((prev) => ({ ...prev, ...partial }))}
        onReset={() => setSettings(DEFAULT_SETTINGS)}
      />
    </>
  );
}
