// office3d/claudeCode.ts — tarefa do setor Desenvolvimento → Claude Code local.
//
// Fluxo: marca a Task como rodando fora do Django (start-external/, o
// agente aparece trabalhando na planta) → pede ao devserver (na máquina do
// dev) pra abrir o Claude Code num terminal ou rodar em segundo plano. Se
// o devserver recusar, a Task é fechada como falha na hora — nunca fica
// "em andamento" pra sempre.
import { reportTaskResult, startExternalTask, type Task } from "@/lib/api";
import { runClaudeCode } from "@/lib/devserver";

export type ClaudeCodeMode = "terminal" | "headless";

/** Setor cujas tarefas vão pro Claude Code local (o Desenvolvimento). */
export function isClaudeCodeSector(name: string | null | undefined): boolean {
  return !!name && /desenvolvimento/i.test(name);
}

const AUTO_KEY = "pgba_claude_code_auto";

/** "Abrir o Claude Code quando chegar tarefa nova" — preferência deste navegador. */
export function getClaudeAutoOpen(): boolean {
  try { return localStorage.getItem(AUTO_KEY) === "terminal"; } catch { return false; }
}
export function setClaudeAutoOpen(on: boolean) {
  try { localStorage.setItem(AUTO_KEY, on ? "terminal" : "off"); } catch { /* sem storage: vale só nesta sessão */ }
}

export function claudeCodePrompt(task: Task): string {
  return [
    `Tarefa #${task.id} do setor Desenvolvimento do PGBA, atribuída a ${task.agent_name}.`,
    "",
    task.brief,
    "",
    "Contexto: esta tarefa veio do Escritório Virtual do PGBA. Siga o CLAUDE.md do repositório.",
    "Antes de terminar, valide o que mudou (typecheck, lint e os testes relevantes).",
    "Não faça push nem abra PR: a tarefa passa por aprovação humana no Studio.",
    "Ao final, resuma em poucas linhas o que mudou, como validou e o que ficou pendente.",
  ].join("\n");
}

/** Id do canal de log (SSE) — gerado antes, pra conectar o log antes de disparar. */
export function newClaudeJobId(taskId: number) {
  return `claude_${taskId}_${Date.now()}`;
}

/**
 * Inicia o Claude Code para a Task. Devolve a Task atualizada (em andamento)
 * e o jobId do log. Em falha, fecha a Task como erro e relança.
 */

export async function launchClaudeCode(
  task: Task, mode: ClaudeCodeMode, jobId = newClaudeJobId(task.id),
): Promise<{ task: Task; jobId: string }> {
  const started = await startExternalTask(task.id);
  try {
    await runClaudeCode({
      taskId: task.id, jobId, mode, prompt: claudeCodePrompt(task),
      workspace: task.workspace || undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao iniciar o Claude Code.";
    const closed = await reportTaskResult(task.id, { success: false, result: { error: message, runner: "claude-code" } })
      .catch(() => started);
    throw Object.assign(new Error(message), { task: closed });
  }
  return { task: started, jobId };
}
