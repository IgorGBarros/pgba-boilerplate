import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/empresa/shared";

interface LogEntry {
  id: string;
  ts: string;
  level: "info" | "warn" | "error";
  agent: string;
  message: string;
  fn?: string;
}

const logs: LogEntry[] = [
  {
    id: "L-001",
    ts: "09:41:22",
    level: "info",
    agent: "Orquestrador-Geral",
    message: "Tarefa T-001 delegada para AI Backend",
    fn: "delegate_task",
  },
  {
    id: "L-002",
    ts: "09:38:05",
    level: "info",
    agent: "Agente SDR",
    message: "Proposta comercial gerada para lead #4421",
    fn: "gerar_proposta",
  },
  {
    id: "L-003",
    ts: "09:35:17",
    level: "warn",
    agent: "Agente Conciliação",
    message: "Divergência de R$ 240,00 encontrada no extrato do dia 15",
  },
  {
    id: "L-004",
    ts: "09:30:01",
    level: "error",
    agent: "AI Backend",
    message: "Falha ao conectar ao Ollama — provider fora do ar",
  },
  {
    id: "L-005",
    ts: "09:22:44",
    level: "info",
    agent: "AI Frontend",
    message: "Typecheck passou — componentes enviados para revisão",
  },
  {
    id: "L-006",
    ts: "09:15:09",
    level: "info",
    agent: "Agente Compras",
    message: "3 cotações comparadas para fornecedor Papelaria São Paulo",
    fn: "comparar_cotacoes",
  },
];

const levelVariant: Record<LogEntry["level"], "default" | "secondary" | "destructive"> = {
  info: "secondary",
  warn: "default",
  error: "destructive",
};

const levelColor: Record<LogEntry["level"], string> = {
  info: "text-muted-foreground",
  warn: "text-warning",
  error: "text-destructive",
};

export function Logs() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Logs de auditoria"
        description="Registro de todas as interações dos agentes — auditável e rastreável."
      />

      <div className="panel">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <ScrollText className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhum log registrado.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {logs.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground w-16">
                  {entry.ts}
                </span>
                <Badge variant={levelVariant[entry.level]} className="mt-0.5 shrink-0 text-[11px]">
                  {entry.level}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${levelColor[entry.level]}`}>{entry.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.agent}
                    {entry.fn && (
                      <span className="font-mono"> · {entry.fn}()</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
