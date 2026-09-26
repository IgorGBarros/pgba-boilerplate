// frontend/src/components/empresa/ti/time.tsx — o time de TI (agentes do setor) e o que cada um cuida
import { useState } from "react";
import { Bot, Loader2, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ti, type EquipeTI } from "@/lib/api";
import { Tag, erroTexto } from "@/components/empresa/ti/shared";

const CUIDA: Record<string, string> = {
  head: "Distribui o trabalho, acompanha o SLA, revisa diagnóstico antes de virar resposta.",
  sre: "Por que o sistema caiu: fila, workers, agendador, disco, API com 5xx.",
  dba: "Por que o banco está inoperante: conexão, senha, disco, conexões, locks, migrações.",
  suporte: "Atende as pessoas de todos os setores com passos simples.",
  integracoes: "APIs, conectores, servidores MCP, IA dos setores, redes sociais e e-mail.",
  seguranca: "Acesso, credencial exposta, LGPD e configuração insegura.",
};

export function TimeTab({ equipe, onChanged }: { equipe: EquipeTI | null; onChanged: () => void }) {
  const [montando, setMontando] = useState(false);
  const [msg, setMsg] = useState("");
  const montar = async () => {
    setMontando(true); setMsg("");
    try {
      const r = await ti.montarEquipe();
      setMsg(r.criados.length ? `Criados: ${r.criados.join(", ")}.` : "O time já estava completo.");
      onChanged();
    } catch (e) { setMsg(erroTexto(e)); } finally { setMontando(false); }
  };
  if (!equipe) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando…</p>;
  const nomes = new Set(equipe.agentes.map((a) => a.nome));
  const faltando = equipe.papeis.filter((p) => !nomes.has(p.nome));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4">
        <Users className="size-5 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">{equipe.setor ? `Setor ${equipe.setor.nome}` : "Setor TI ainda não existe"}</p>
          <p className="text-xs text-muted-foreground">
            Todo agente do TI nasce <b>observador</b>: diagnostica e sugere, nunca executa comando em servidor nem responde sem uma pessoa.
          </p>
        </div>
        {faltando.length > 0 && (
          <Button size="sm" onClick={montar} disabled={montando}>
            {montando && <Loader2 className="size-3.5 animate-spin" />} {equipe.agentes.length ? `Completar time (${faltando.length})` : "Montar time de TI"}
          </Button>
        )}
      </div>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {equipe.agentes.map((a) => (
          <div key={a.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-full bg-teal-500/15 text-teal-700 dark:text-teal-300">
                {a.nivel === "sector_orchestrator" ? <Star className="size-4" /> : <Bot className="size-4" />}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{a.nome}</p>
                <p className="truncate text-xs text-muted-foreground">{a.cargo}</p>
              </div>
              <span className={`ml-auto size-2.5 rounded-full ${a.work_status === "working" ? "bg-success" : "bg-muted-foreground opacity-50"}`} title={a.work_status} />
            </div>
            {CUIDA[a.papel] && <p className="mt-2 text-xs text-muted-foreground">{CUIDA[a.papel]}</p>}
            <div className="mt-2 flex flex-wrap gap-1">
              <Tag tone={a.chamados_abertos ? "info" : "muted"}>{a.chamados_abertos} chamado(s) aberto(s)</Tag>
              {a.work_status === "working" && a.tarefa_atual && <Tag tone="ok">{a.tarefa_atual.slice(0, 40)}</Tag>}
              {!a.tem_skill && <Tag tone="warn">sem instruções</Tag>}
            </div>
          </div>
        ))}
        {faltando.map((p) => (
          <div key={p.papel} className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground/70">{p.nome}</p>
            <p className="text-xs">{CUIDA[p.papel]}</p>
            <p className="mt-2 text-xs">Ainda não existe — clique em "Montar time".</p>
          </div>
        ))}
      </div>
    </div>
  );
}
