// frontend/src/pages/StatusPage.tsx — status público da plataforma (/status), sem login.
// Funciona com o banco fora: o endpoint testa na hora e não depende de dado gravado.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { saudePublica, type SaudePublica, type StatusSaude } from "@/lib/api";

const COR: Record<StatusSaude, { dot: string; texto: string; label: string }> = {
  ok: { dot: "bg-success", texto: "text-success", label: "Operando" },
  alerta: { dot: "bg-warning", texto: "text-warning", label: "Instável" },
  falha: { dot: "bg-destructive", texto: "text-destructive", label: "Fora do ar" },
  desconhecido: { dot: "bg-muted-foreground opacity-50", texto: "text-muted-foreground", label: "Sem dado" },
};

export function StatusPage() {
  const [s, setS] = useState<SaudePublica | null>(null);
  const [erro, setErro] = useState(false);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(() => {
    setCarregando(true);
    saudePublica()
      .then((r) => { setS(r); setErro(false); })
      .catch(() => setErro(true))
      .finally(() => setCarregando(false));
  }, []);
  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  const geral: StatusSaude = erro ? "falha" : s?.status ?? "desconhecido";
  const Icone = geral === "ok" ? CheckCircle2 : geral === "falha" ? XCircle : AlertTriangle;

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <main className="mx-auto max-w-xl space-y-5">
        <header className="flex items-center justify-between">
          <h1 className="font-display text-xl font-semibold">Status do sistema</h1>
          <button type="button" onClick={carregar} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            {carregando ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Atualizar
          </button>
        </header>

        <section className={`flex items-center gap-3 rounded-2xl border p-5 ${geral === "ok" ? "border-success/30 bg-success/5" : geral === "falha" ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5"}`}>
          {!s && !erro ? <Loader2 className="size-7 animate-spin text-muted-foreground" /> : <Icone className={`size-7 ${COR[geral].texto}`} />}
          <div>
            <p className="font-display text-lg font-semibold">
              {erro ? "Não foi possível falar com o servidor" : !s ? "Verificando…" : geral === "ok" ? "Todos os sistemas operando" : geral === "falha" ? "Parte do sistema está fora do ar" : "Instabilidade em parte do sistema"}
            </p>
            <p className="text-xs text-muted-foreground">
              {erro ? "O servidor da aplicação não respondeu — a equipe de TI já é avisada pelo monitoramento." :
                s ? `Verificado às ${new Date(s.verificado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · atualiza a cada minuto` : ""}
            </p>
          </div>
        </section>

        {s && (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {s.componentes.map((c) => (
              <li key={c.nome} className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span className={`size-2.5 rounded-full ${COR[c.status].dot}`} />
                  <span className="flex-1 text-sm font-medium">{c.nome}</span>
                  <span className={`text-xs ${COR[c.status].texto}`}>{COR[c.status].label}</span>
                </div>
                {c.status !== "ok" && c.causa && <p className="ml-5 mt-1 text-xs text-muted-foreground">{c.causa}</p>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-center text-xs text-muted-foreground"><a className="text-primary" href="/">Voltar ao sistema</a></p>
      </main>
    </div>
  );
}
