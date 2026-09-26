// frontend/src/components/admin/EmailDraftButton.tsx
//
// "Enviar por e-mail" nas telas de Compras: monta o rascunho no backend (texto
// com os itens, caixa do setor Compras) e abre o editor pra pessoa revisar e
// enviar ali mesmo. Sem caixa configurada, o rascunho fica na Caixa de saída.
import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { EmailEditor } from "@/components/admin/OutboxSection";
import type { OutboundEmail } from "@/lib/api";

export function EmailDraftButton({
  label,
  create,
  onDone,
  className,
}: {
  label: string;
  create: () => Promise<OutboundEmail>;
  onDone?: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<OutboundEmail | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async (e) => {
          e.stopPropagation();
          setBusy(true);
          try {
            setDraft(await create());
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Não foi possível montar o e-mail.");
          } finally {
            setBusy(false);
          }
        }}
        className={className ?? "flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Mail className="size-3" />}
        {label}
      </button>
      {draft && <EmailEditor email={draft} sectors={[]} onClose={() => { setDraft(null); onDone?.(); }} onChanged={() => onDone?.()} />}
    </>
  );
}
