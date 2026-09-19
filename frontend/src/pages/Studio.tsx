import { useState } from "react";
import {
  Boxes,
  Building2,
  ClipboardList,
  ScrollText,
  ShieldCheck,
  Wand2,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Overview } from "@/components/empresa/overview";
import { Tasks } from "@/components/empresa/tasks";
import { Approvals } from "@/components/empresa/approvals";
import { Knowledge } from "@/components/empresa/knowledge";
import { Logs } from "@/components/empresa/logs";
import { Gerar } from "@/components/empresa/gerar";
import { NewTaskDialog } from "@/components/empresa/dialogs";
import { Toaster } from "sonner";

const tabs = [
  { id: "empresa", label: "Empresa", icon: Building2 },
  { id: "tarefas", label: "Tarefas", icon: ClipboardList },
  { id: "aprovacoes", label: "Aprovações", icon: ShieldCheck },
  { id: "conhecimento", label: "Conhecimento", icon: Boxes },
  { id: "gerar", label: "Gerar", icon: Wand2 },
  { id: "logs", label: "Logs", icon: ScrollText },
];

export default function Studio() {
  const [activeTab, setActiveTab] = useState("empresa");
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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
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
              <Overview onNewTask={openTask} onOpenGerar={() => setActiveTab("gerar")} />
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
            <TabsContent value="gerar">
              <Gerar />
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
