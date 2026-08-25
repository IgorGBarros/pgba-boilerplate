// frontend/src/components/builder/CommandPalette.tsx
import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { MessageSquare, Settings, Terminal, RotateCcw } from "lucide-react";

interface CommandPaletteProps {
  onNewChat: () => void;
  onToggleTerminal: () => void;
  onResetChat: () => void;
  onOpenSettings: () => void;
}

/**
 * ⌘K / Ctrl+K. Implementado direto com `cmdk` (sem o wrapper shadcn
 * completo, que traria toda a família Radix Dialog junto) — mais leve,
 * mesma experiência de paleta de comandos.
 */
export default function CommandPalette({ onNewChat, onToggleTerminal, onResetChat, onOpenSettings }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  function run(action: () => void) {
    action();
    setOpen(false);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Paleta de comandos"
      className="fixed left-1/2 top-24 z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-white/10 bg-surface-raised shadow-2xl"
    >
      <Command.Input
        placeholder="Buscar ações..."
        className="w-full border-b border-white/10 bg-transparent px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
      />
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-slate-500">Nenhum resultado encontrado.</Command.Empty>

        <Command.Group heading="Ações" className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500">
          <Command.Item
            onSelect={() => run(onNewChat)}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 aria-selected:bg-brand-500/15 aria-selected:text-brand-500"
          >
            <MessageSquare className="h-4 w-4" />
            Nova conversa
          </Command.Item>
          <Command.Item
            onSelect={() => run(onToggleTerminal)}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 aria-selected:bg-brand-500/15 aria-selected:text-brand-500"
          >
            <Terminal className="h-4 w-4" />
            Abrir/fechar terminal
          </Command.Item>
          <Command.Item
            onSelect={() => run(onResetChat)}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 aria-selected:bg-brand-500/15 aria-selected:text-brand-500"
          >
            <RotateCcw className="h-4 w-4" />
            Limpar conversa
          </Command.Item>
          <Command.Item
            onSelect={() => run(onOpenSettings)}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 aria-selected:bg-brand-500/15 aria-selected:text-brand-500"
          >
            <Settings className="h-4 w-4" />
            Configurações
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
