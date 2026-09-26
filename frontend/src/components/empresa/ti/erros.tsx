// frontend/src/components/empresa/ti/erros.tsx — erros do log agrupados (só equipe da plataforma)
import { useCallback, useEffect, useState } from "react";
import { CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ti, type EventoErro } from "@/lib/api";
import { Tag, Vazio, dataHora, relativo } from "@/components/empresa/ti/shared";

export function ErrosTab({ reloadKey, onChanged }: { reloadKey: number; onChanged: () => void }) {
  const [todos, setTodos] = useState(false);
  const [lista, setLista] = useState<EventoErro[] | null>(null);
  const [aberto, setAberto] = useState<number | null>(null);
  const carregar = useCallback(() => { ti.erros(todos).then(setLista).catch(() => setLista([])); }, [todos]);
  useEffect(carregar, [carregar, reloadKey]);

  const resolver = async (ids: number[]) => { await ti.resolverErros(ids); carregar(); onChanged(); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground">
          Todo ERROR do log do backend e dos workers, agrupado por tipo (mesmo lugar do código + mesma mensagem). Dados pessoais saem mascarados.
        </p>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> Mostrar resolvidos
        </label>
        {!!lista?.filter((e) => !e.resolvido).length && (
          <Button size="sm" variant="outline" onClick={() => resolver(lista.filter((e) => !e.resolvido).map((e) => e.id))}>
            <CheckCheck className="size-3.5" /> Marcar todos como resolvidos
          </Button>
        )}
      </div>
      {lista === null ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando…</p>
        : lista.length === 0 ? <Vazio>Nenhum erro no log. 🎉</Vazio> : (
          <ul className="space-y-2">
            {lista.map((e) => (
              <li key={e.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
                <button type="button" className="w-full text-left" onClick={() => setAberto(aberto === e.id ? null : e.id)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone={e.nivel === "CRITICAL" ? "error" : "warn"}>{e.nivel}</Tag>
                    <span className="font-mono text-xs">{e.origem}</span>
                    <Tag>{e.ocorrencias}×</Tag>
                    {e.resolvido && <Tag tone="ok">resolvido</Tag>}
                    <span className="ml-auto text-xs text-muted-foreground">última {relativo(e.ultimo)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 break-words">{e.mensagem}</p>
                  <p className="text-[11px] text-muted-foreground">{e.logger} · primeira vez {dataHora(e.primeiro)}</p>
                </button>
                {aberto === e.id && (
                  <div className="mt-2 space-y-2">
                    {e.trace && <pre className="max-h-72 overflow-auto rounded-lg bg-secondary p-2 text-[11px] leading-snug">{e.trace}</pre>}
                    {!e.resolvido && <Button size="sm" variant="outline" onClick={() => resolver([e.id])}>Marcar como resolvido</Button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
