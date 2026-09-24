import { useState } from "react";
import {
  Boxes,
  Building2,
  ClipboardList,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Overview } from "@/components/empresa/overview";
import { Tasks } from "@/components/empresa/tasks";
import { Approvals } from "@/components/empresa/approvals";
import { Knowledge } from "@/components/empresa/knowledge";
import { Logs } from "@/components/empresa/logs";
import { NewTaskDialog } from "@/components/empresa/dialogs";
import GeneratePanel from "@/components/builder/GeneratePanel";
import { Toaster } from "sonner";

// "gerar" não aparece na barra — só abre via openGerar(projectId)
const tabs = [
  { id: "empresa",      label: "Empresa",      icon: Building2    },
  { id: "tarefas",      label: "Tarefas",      icon: ClipboardList },
  { id: "aprovacoes",   label: "Aprovações",   icon: ShieldCheck  },
  { id: "conhecimento", label: "Conhecimento", icon: Boxes        },
  { id: "logs",         label: "Logs",         icon: ScrollText   },
];

const STUDIO_TAB_KEY = "studio_active_tab";
const VALID_TABS = new Set(["gerar", "empresa", "tarefas", "aprovacoes", "conhecimento", "logs"]);

function readStoredTab(): string {
  try {
    const stored = sessionStorage.getItem(STUDIO_TAB_KEY);
    return stored && VALID_TABS.has(stored) ? stored : "empresa";
  } catch {
    return "empresa";
  }
}

export default function Studio() {
  const [activeTab, setActiveTab] = useState(readStoredTab);
  const [newTask, setNewTask] = useState(false);
  const [taskSector, setTaskSector] = useState<string | undefined>(undefined);
  const [gerarProjectId, setGerarProjectId] = useState<number | undefined>(undefined);

  function changeTab(tab: string) {
    try { sessionStorage.setItem(STUDIO_TAB_KEY, tab); } catch { /* private window */ }
    setActiveTab(tab);
  }

  const openTask = (sector?: string) => {
    setTaskSector(sector);
    setNewTask(true);
  };

  const openGerar = (projectId?: number) => {
    if (projectId !== undefined) setGerarProjectId(projectId);
    changeTab("gerar");
  };

  return (
    <>
      <Toaster richColors position="top-right" />
      <div className="min-h-screen bg-background">
        <Tabs value={activeTab} onValueChange={changeTab} className="w-full">
          <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
            <div className="px-4 py-2">
              <TabsList className="flex-wrap">
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id} className="gap-2">
                    <tab.icon className="size-4" />
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>

          {/* Gerar ocupa toda a altura disponível — sem o padding p-4/p-6 das outras abas */}
          <TabsContent value="gerar" className="mt-0">
            <GeneratePanel initialProjectId={gerarProjectId} />
          </TabsContent>

          <div className="p-4 md:p-6">
            <TabsContent value="empresa">
              <Overview onNewTask={openTask} onOpenGerar={openGerar} />
            </TabsContent>
            <TabsContent value="tarefas">
              <Tasks onNewTask={openTask} />
            </TabsContent>
            <TabsContent value="aprovacoes">
              <Approvals />
            </TabsContent>
            <TabsContent value="conhecimento">
              <Knowledge />
            </TabsContent>
            <TabsContent value="logs">
              <Logs />
            </TabsContent>
          </div>
        </Tabs>

        <NewTaskDialog open={newTask} onOpenChange={setNewTask} sector={taskSector} />
      </div>
    </>
  );
}
