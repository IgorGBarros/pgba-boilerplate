import { useState } from "react";
import {
  Boxes,
  Building2,
  ClipboardList,
  Download,
  FolderTree,
  Github,
  LogOut,
  MessageSquare,
  Plus,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const tabs = [
  { id: "empresa", label: "Empresa", icon: Building2 },
  { id: "projetos", label: "Projetos", icon: FolderTree },
  { id: "tarefas", label: "Tarefas", icon: ClipboardList },
  { id: "aprovacoes", label: "Aprovações e políticas", icon: ShieldCheck },
  { id: "conhecimento", label: "Conhecimento", icon: Boxes },
  { id: "logs", label: "Logs", icon: ScrollText },
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
        <header className="flex h-14 items-center justify-between border-b border-border bg-sidebar px-4">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-md gradient-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </span>
            <span className="text-lg font-semibold tracking-tight">PGBA</span>
          </div>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            <Button size="sm">Estúdio</Button>
            <Button variant="ghost" size="sm">
              Conhecimento
            </Button>
            <Button variant="ghost" size="sm">
              Páginas geradas
            </Button>
            <Button variant="ghost" size="icon" aria-label="Sair">
              <LogOut className="size-4" />
            </Button>
          </nav>
        </header>

        <div className="flex">
          <aside className="hidden w-72 shrink-0 border-r border-border bg-sidebar p-4 lg:block">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Histórico
            </p>
            <Button variant="secondary" className="mt-3 w-full justify-start">
              <Plus className="size-4" />
              Nova conversa
            </Button>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar conversas..." className="pl-9" />
            </div>

            <div className="mt-5 space-y-2">
              {[
                { title: "Estruturar admin-panel da empresa", time: "agora" },
                { title: "Criar projeto derivado do template", time: "2 h" },
                { title: "Revisar política de deploy", time: "23 h" },
              ].map((chat) => (
                <button
                  key={chat.title}
                  type="button"
                  className="flex w-full items-start gap-2 rounded-md p-2 text-left transition-colors hover:bg-sidebar-accent"
                >
                  <MessageSquare className="mt-0.5 size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{chat.title}</span>
                    <span className="block text-xs text-muted-foreground">{chat.time}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-6 rounded-lg border border-border bg-elevated p-3 text-xs">
              <p className="flex items-center gap-2 font-medium">
                <Terminal className="size-3.5 text-primary" />
                Rodando
              </p>
              <p className="mt-2 font-mono text-muted-foreground">npm run pgba</p>
              <p className="font-mono text-muted-foreground">studio :5173 · preview :5183</p>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <Tabs defaultValue="empresa" className="w-full">
              <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <TabsList className="flex-wrap">
                    {tabs.map((tab) => (
                      <TabsTrigger key={tab.id} value={tab.id} className="gap-2">
                        <tab.icon className="size-4" />
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setImportProject(true)}>
                      <Download className="size-4" />
                      Importar projeto
                    </Button>
                    <Button size="sm" onClick={() => setNewProject(true)}>
                      <Github className="size-4" />
                      Novo projeto
                    </Button>
                  </div>
                </div>
              </div>

              <div className="p-4 md:p-6">
                <div className="mb-6">
                  <h1 className="text-2xl font-semibold tracking-tight">Empresa</h1>
                  <p className="text-sm text-muted-foreground">
                    Painel administrativo do motor principal e de todos os projetos derivados.
                  </p>
                </div>

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
              </div>
            </Tabs>
          </main>
        </div>

        <NewProjectDialog open={newProject} onOpenChange={setNewProject} />
        <ImportProjectDialog open={importProject} onOpenChange={setImportProject} />
        <NewTaskDialog open={newTask} onOpenChange={setNewTask} sector={taskSector} />
      </div>
    </>
  );
}
