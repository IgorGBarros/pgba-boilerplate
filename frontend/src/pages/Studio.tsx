import { lazy, Suspense, useState } from "react";
import {
  Boxes,
  Building2,
  ClipboardList,
  FolderTree,
  ScrollText,
  ShieldCheck,
  Cuboid,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Overview } from "@/components/empresa/overview";
import { Projects } from "@/components/empresa/projects";
import { Tasks } from "@/components/empresa/tasks";
import { Approvals } from "@/components/empresa/approvals";
import { Knowledge } from "@/components/empresa/knowledge";
import { Logs } from "@/components/empresa/logs";
import {
  ImportProjectDialog,
  NewProjectDialog,
  NewTaskDialog,
} from "@/components/empresa/dialogs";
import { Toaster } from "sonner";

// Carregado sob demanda — react-three-fiber + drei pesa ~960KB
const CompanyOffice3D = lazy(() => import("@/components/builder/CompanyOffice3D"));

const tabs = [
  { id: "empresa", label: "Empresa", icon: Building2 },
  { id: "projetos", label: "Projetos", icon: FolderTree },
  { id: "tarefas", label: "Tarefas", icon: ClipboardList },
  { id: "aprovacoes", label: "Aprovações", icon: ShieldCheck },
  { id: "conhecimento", label: "Conhecimento", icon: Boxes },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "escritorio3d", label: "Escritório 3D", icon: Cuboid },
];

export default function Studio() {
  const [newProject, setNewProject] = useState(false);
  const [importProject, setImportProject] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [taskSector, setTaskSector] = useState<string | undefined>(undefined);

  const openTask = (sector?: string) => {
    setTaskSector(sector);
    setNewTask(true);
  };

  return (
    <>
      <Toaster richColors position="top-right" />
      <div className="min-h-screen bg-background">
        <Tabs defaultValue="empresa" className="w-full">
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

          <div className="p-4 md:p-6">
            <TabsContent value="empresa">
              <Overview onNewTask={openTask} />
            </TabsContent>
            <TabsContent value="projetos">
              <Projects
                onNewProject={() => setNewProject(true)}
                onImportProject={() => setImportProject(true)}
                onNewTask={openTask}
              />
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
            <TabsContent value="escritorio3d" className="p-0">
              <Suspense
                fallback={
                  <div className="flex h-96 items-center justify-center">
                    <p className="text-sm text-muted-foreground">Carregando escritório 3D...</p>
                  </div>
                }
              >
                <div style={{ height: "calc(100vh - 110px)" }}>
                  <CompanyOffice3D />
                </div>
              </Suspense>
            </TabsContent>
          </div>
        </Tabs>

        <NewProjectDialog open={newProject} onOpenChange={setNewProject} />
        <ImportProjectDialog open={importProject} onOpenChange={setImportProject} />
        <NewTaskDialog open={newTask} onOpenChange={setNewTask} sector={taskSector} />
      </div>
    </>
  );
}
