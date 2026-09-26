// frontend/devserver/lib/claudeCode.mjs
//
// Ponte entre as Tasks do setor Desenvolvimento e o Claude Code instalado
// NA MÁQUINA do desenvolvedor. O backend (Django, às vezes num container)
// não tem como abrir um terminal nem editar o repositório do dev — o
// devserver tem: ele já roda local, com acesso ao sistema de arquivos.
//
// Dois modos:
//   - "terminal": abre uma janela de terminal com o Claude Code INTERATIVO
//     já com o pedido da Task — você acompanha e conversa com ele. Quando
//     terminar, marca a Task como concluída pelo Studio (finish).
//   - "headless": roda `claude -p` em segundo plano, transmite o log pro
//     Studio e, ao terminar, fecha a Task sozinho (report-result) com o
//     resumo, os arquivos alterados e o custo informado pelo Claude Code.
//
// O pedido nunca entra na linha de comando: vai por stdin (headless) ou por
// um arquivo temporário lido pelo shell (terminal) — texto da Task não vira
// comando, mesmo com aspas, $() ou crases.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IS_WIN = process.platform === "win32";
const CLAUDE_BIN = process.env.CLAUDE_CODE_BIN || "claude";
// Permissão padrão do modo headless: aceita edições de arquivo, pergunta o
// resto (sem ninguém pra responder, o resto é negado). Ajuste no .env.
const HEADLESS_ARGS = (process.env.CLAUDE_CODE_ARGS || "--permission-mode acceptEdits").split(/\s+/).filter(Boolean);

// taskId -> { child, mode, cwd, before }
const running = new Map();

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024, shell: IS_WIN, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || "", stderr: stderr || "", error: err });
    });
  });
}

export async function claudeCodeStatus() {
  const r = await run(CLAUDE_BIN, ["--version"], { timeout: 10_000 });
  if (!r.ok) {
    return {
      available: false,
      error: `Claude Code não encontrado ("${CLAUDE_BIN}"). Instale com npm i -g @anthropic-ai/claude-code ou defina CLAUDE_CODE_BIN no .env do frontend.`,
    };
  }
  return { available: true, version: r.stdout.trim() };
}

/** Arquivos alterados segundo o git (vazio se a pasta não é repositório). */
async function changedFiles(cwd) {
  const r = await run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, shell: false });
  if (!r.ok) return null;
  return r.stdout.split("\n").filter(Boolean).map((l) => l.slice(3).trim());
}

async function reportResult({ apiUrl, accessToken, taskId, success, result, currentFiles, usage }) {
  if (!accessToken) throw new Error("Sem token de acesso para registrar o resultado da tarefa.");
  const res = await fetch(`${apiUrl}/api/v1/agency/tasks/${taskId}/report-result/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ success, result, current_files: currentFiles, ...(usage ? { usage } : {}) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Backend respondeu ${res.status} ao registrar o resultado.`);
  }
}

function writePromptFile(taskId, prompt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pgba-claude-"));
  const file = path.join(dir, `tarefa-${taskId}.md`);
  fs.writeFileSync(file, prompt, "utf-8");
  return file;
}

function onPath(bin) {
  if (bin.includes(path.sep)) return fs.existsSync(bin);
  return (process.env.PATH || "").split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, bin)));
}

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Abre uma janela de terminal com o Claude Code interativo já com o pedido. */
function openTerminal({ cwd, promptFile, title }) {
  if (IS_WIN) {
    // PowerShell lê o arquivo e passa o conteúdo como UM argumento (sem reinterpretar)
    const ps = `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'; & '${CLAUDE_BIN}' (Get-Content -Raw -LiteralPath '${promptFile.replace(/'/g, "''")}')`;
    // `start` usa o 1º argumento entre aspas como título da janela (o Node
    // coloca as aspas por ter espaço); o comando PowerShell só usa aspas simples.
    const child = spawn("cmd.exe", ["/c", "start", title, "powershell", "-NoExit", "-Command", ps], {
      detached: true, stdio: "ignore",
    });
    child.unref();
    return;
  }
  const inner = `cd ${shQuote(cwd)} && ${shQuote(CLAUDE_BIN)} "$(cat ${shQuote(promptFile)})"; exec "$SHELL"`;
  if (process.platform === "darwin") {
    const script = `tell application "Terminal" to do script ${JSON.stringify(inner)}\ntell application "Terminal" to activate`;
    spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  // Linux: o primeiro emulador de terminal disponível
  const custom = process.env.CLAUDE_CODE_TERMINAL; // ex: "gnome-terminal --"
  const candidates = custom
    ? [custom.split(/\s+/)]
    : [["x-terminal-emulator", "-e"], ["gnome-terminal", "--"], ["konsole", "-e"], ["xterm", "-e"]];
  // Procura o executável ANTES: erro de spawn chega assíncrono e a tela
  // diria "terminal aberto" sem ter aberto nada.
  for (const [bin, ...pre] of candidates) {
    if (!onPath(bin)) continue;
    const child = spawn(bin, [...pre, "bash", "-lc", inner], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return;
  }
  throw new Error("Nenhum terminal encontrado. Defina CLAUDE_CODE_TERMINAL (ex: \"gnome-terminal --\") no .env do frontend.");
}

/**
 * Inicia o Claude Code para uma Task. `emit(event)` recebe o progresso
 * ({stage, message}) — o devserver transmite por SSE pro Studio.
 */
export async function startClaudeCode({ taskId, prompt, cwd, mode, apiUrl, accessToken, emit }) {
  if (running.has(taskId)) throw new Error(`O Claude Code já está rodando a tarefa #${taskId}.`);
  if (!fs.existsSync(cwd)) throw new Error(`Pasta do projeto não encontrada: ${cwd}`);
  const status = await claudeCodeStatus();
  if (!status.available) throw new Error(status.error);

  const before = new Set((await changedFiles(cwd)) ?? []);

  if (mode === "terminal") {
    const promptFile = writePromptFile(taskId, prompt);
    openTerminal({ cwd, promptFile, title: `Claude Code · tarefa #${taskId}` });
    running.set(taskId, { child: null, mode, cwd, before });
    emit({ stage: "plan", message: `Claude Code aberto num terminal em ${cwd}. Quando terminar, conclua a tarefa pelo Studio.` });
    return { mode, cwd };
  }

  const args = ["-p", "--output-format", "stream-json", "--verbose", ...HEADLESS_ARGS];
  const child = spawn(CLAUDE_BIN, args, { cwd, shell: IS_WIN, stdio: ["pipe", "pipe", "pipe"] });
  running.set(taskId, { child, mode, cwd, before });
  child.stdin.end(prompt);
  emit({ stage: "plan", message: `Claude Code rodando em ${cwd} (${args.slice(4).join(" ") || "permissões padrão"}).` });

  let final = null;
  let buffer = "";
  const stderr = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { emit({ stage: "log", message: line }); continue; }
      if (msg.type === "result") { final = msg; continue; }
      if (msg.type === "assistant") {
        for (const part of msg.message?.content ?? []) {
          if (part.type === "text" && part.text?.trim()) emit({ stage: "log", message: part.text.trim() });
          if (part.type === "tool_use") {
            const target = part.input?.file_path || part.input?.command || part.input?.pattern || "";
            emit({ stage: "tool", message: `${part.name}${target ? ` · ${String(target).slice(0, 160)}` : ""}` });
          }
        }
      }
    }
  });
  child.stderr.on("data", (c) => stderr.push(c.toString()));

  child.on("close", async (code) => {
    running.delete(taskId);
    const after = (await changedFiles(cwd)) ?? [];
    const files = after.filter((f) => !before.has(f));
    const success = code === 0 && final && !final.is_error;
    const summary = final?.result || stderr.join("").trim() || `Claude Code terminou com código ${code}.`;
    const usage = final ? {
      provider: "anthropic",
      model: "claude-code",
      tokens_in: (final.usage?.input_tokens ?? 0) + (final.usage?.cache_read_input_tokens ?? 0) + (final.usage?.cache_creation_input_tokens ?? 0),
      tokens_out: final.usage?.output_tokens ?? 0,
      cost_usd: final.total_cost_usd ?? null,
    } : null;
    try {
      await reportResult({
        apiUrl, accessToken, taskId, success: Boolean(success),
        result: success
          ? { output: summary, runner: "claude-code", session_id: final?.session_id, num_turns: final?.num_turns, needs_review: true }
          : { error: summary, runner: "claude-code" },
        currentFiles: files,
        usage,
      });
      emit({ stage: success ? "done" : "error", message: success ? `✅ Claude Code terminou. ${files.length} arquivo(s) alterado(s).` : summary });
    } catch (err) {
      emit({ stage: "error", message: `Claude Code terminou, mas não consegui registrar na tarefa: ${err.message}` });
    }
    emit({ stage: "complete", message: success ? "ok" : "falhou", result: { files, success: Boolean(success) } });
  });
  child.on("error", (err) => {
    running.delete(taskId);
    emit({ stage: "error", message: `Não consegui iniciar o Claude Code: ${err.message}` });
    emit({ stage: "complete", message: "falhou" });
  });
  return { mode, cwd };
}

/** Fecha pelo Studio uma Task feita no modo terminal (ou interrompe a headless). */
export async function finishClaudeCode({ taskId, success, note, cwd, apiUrl, accessToken }) {
  const entry = running.get(taskId);
  if (entry?.child) {
    if (success) {
      throw new Error(
        "O Claude Code ainda está rodando esta tarefa em segundo plano — ele fecha a tarefa sozinho ao terminar. Use “Falhou / interromper” para parar.",
      );
    }
    entry.child.kill();
    running.delete(taskId);
    return { stopped: true };
  }
  const workdir = entry?.cwd || cwd;
  const before = entry?.before ?? new Set();
  running.delete(taskId);
  const after = workdir ? (await changedFiles(workdir)) ?? [] : [];
  const files = after.filter((f) => !before.has(f));
  await reportResult({
    apiUrl, accessToken, taskId, success,
    result: success
      ? { output: note || "Concluída no Claude Code (terminal).", runner: "claude-code", needs_review: true }
      : { error: note || "Marcada como falha no Claude Code (terminal).", runner: "claude-code" },
    currentFiles: files,
  });
  return { stopped: false, files };
}

export function isClaudeCodeRunning(taskId) {
  return running.has(taskId);
}
