// frontend/src/components/builder/GeneratePanel.tsx
import { Sparkles, FolderTree } from "lucide-react";
import ChatPanel from "@/components/builder/ChatPanel";
import PreviewPanel from "@/components/builder/PreviewPanel";
import type { ChatMessage } from "@/types/builder";
import type { GenerateLogEvent, ProjectFile } from "@/lib/devserver";

interface GeneratePanelProps {
  hasOpenedGerar: boolean;
  activeProject: string | null;
  startingProject: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  files: ProjectFile[];
  logs: GenerateLogEvent[];
  previewUrl: string;
  isTerminalOpen: boolean;
  onSend: (prompt: string) => void;
  onReset: () => void;
  onClearLogs: () => void;
  onToggleTerminal: () => void;
  onGoToProjects: () => void;
}

/**
 * "Gerar" — extraído do Studio.tsx pra ficar no mesmo padrão das
 * outras abas (cada uma seu próprio arquivo). Continua recebendo
 * estado via props (não busca nada sozinho, ao contrário de
 * CompanyOverview/ProjectsTree/TaskBoard) porque `messages` é
 * compartilhado com a barra de histórico de conversas do Studio —
 * mover isso pra dentro quebraria essa persistência entre abas.
 *
 * Nunca abre "solto": `hasOpenedGerar` só vira true quando a aba
 * Projetos manda abrir o Principal ou um projeto específico
 * (`handleOpenGerar` no Studio) — sem isso, mostra o estado vazio.
 */
export default function GeneratePanel({
  hasOpenedGerar,
  activeProject,
  startingProject,
  messages,
  isLoading,
  files,
  logs,
  previewUrl,
  isTerminalOpen,
  onSend,
  onReset,
  onClearLogs,
  onToggleTerminal,
  onGoToProjects,
}: GeneratePanelProps) {
  if (!hasOpenedGerar) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Sparkles className="h-8 w-8 text-slate-600" />
        <p className="text-sm font-medium text-slate-300">Selecione um projeto primeiro</p>
        <p className="max-w-sm text-xs text-slate-500">
          Gerar página precisa saber em qual pasta trabalhar — abra o Motor Principal ou um projeto na aba
          Projetos, e clique em "Abrir Gerar" ali.
        </p>
        <button
          onClick={onGoToProjects}
          className="mt-2 flex items-center gap-1.5 rounded-card bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <FolderTree className="h-4 w-4" />
          Ir pra Projetos
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-white/10 bg-black/20 px-4 py-1.5 text-[11px] text-slate-400">
        <FolderTree className="h-3 w-3" />
        Trabalhando em: <span className="font-medium text-slate-200">{activeProject ?? "Motor Principal"}</span>
        {startingProject === activeProject && startingProject !== null && (
          <span className="flex items-center gap-1 text-yellow-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
            iniciando...
          </span>
        )}
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-[38%] min-w-[380px] shrink-0 xl:w-[34%]">
          <ChatPanel messages={messages} isLoading={isLoading} onSend={onSend} onReset={onReset} />
        </div>
        <div className="min-w-0 flex-1">
          <PreviewPanel
            previewUrl={previewUrl}
            files={files}
            logs={logs}
            onClearLogs={onClearLogs}
            workspace={activeProject ?? undefined}
            isTerminalOpen={isTerminalOpen}
            onToggleTerminal={onToggleTerminal}
          />
        </div>
      </div>
    </div>
  );
}
