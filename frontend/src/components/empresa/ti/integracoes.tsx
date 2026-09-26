// frontend/src/components/empresa/ti/integracoes.tsx
//
// APIs e integrações: rotas da API desta empresa, provedores de IA, saídas HTTP
// (só a equipe da plataforma) e o estado de cada conector/MCP/e-mail/rede social.
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ti, type Componente, type Metricas } from "@/lib/api";
import { Dot, GRUPOS, SAUDE, Vazio, relativo } from "@/components/empresa/ti/shared";

const TIPOS = [
  { id: "api", label: "Rotas da API", chave: "Rota" },
  { id: "ia", label: "Provedores de IA", chave: "Provedor : modelo" },
  { id: "http", label: "Saídas HTTP", chave: "Host externo" },
] as const;

function Serie({ serie }: { serie: Metricas["serie"] }) {
  if (serie.length < 2) return null;
  const max = Math.max(...serie.map((s) => s.total), 1);
  return (
    <div className="flex h-16 items-end gap-px rounded-lg border border-border bg-surface p-2" aria-label="Volume por hora">
      {serie.map((s) => (
        <div key={s.hora} className="flex flex-1 flex-col justify-end" title={`${new Date(s.hora).toLocaleString("pt-BR", { day: "2-digit", hour: "2-digit" })}h · ${s.total} req · ${s.erros} erro(s)`}>
          <div className="w-full rounded-sm bg-destructive/70" style={{ height: `${(s.erros / max) * 48}px` }} />
          <div className="w-full rounded-sm bg-primary/60" style={{ height: `${((s.total - s.erros) / max) * 48}px` }} />
        </div>
      ))}
    </div>
  );
}

export function IntegracoesTab({ reloadKey, staff, componentes }: { reloadKey: number; staff: boolean; componentes: Componente[] }) {
  const [tipo, setTipo] = useState<"api" | "ia" | "http">("api");
  const [horas, setHoras] = useState(24);
  const [m, setM] = useState<Metricas | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    setM(null); setErro("");
    ti.metricas(tipo, horas).then(setM).catch((e) => setErro(e instanceof Error ? e.message : String(e)));
  }, [tipo, horas, reloadKey]);

  const integracoes = componentes.filter((c) => ["conector", "mcp", "email", "social", "ia"].includes(c.grupo));
  const tipos = TIPOS.filter((t) => t.id !== "http" || staff);

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Integrações monitoradas</h3>
        {integracoes.length === 0 ? (
          <Vazio>Nenhuma integração verificada ainda — conectores, servidores MCP, e-mails e redes sociais aparecem aqui depois da primeira verificação.</Vazio>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-secondary/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-3 py-2">Integração</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Detalhe</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {integracoes.map((c) => (
                  <tr key={c.id} className="bg-surface align-top">
                    <td className="px-3 py-2"><span className="flex items-center gap-2"><Dot status={c.status} />{c.nome}</span></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{GRUPOS[c.grupo] ?? c.grupo}</td>
                    <td className="px-3 py-2 text-xs"><span className={SAUDE[c.status].text}>{SAUDE[c.status].label}</span><p className="text-muted-foreground">{relativo(c.verificado_em)}{c.ms != null ? ` · ${c.ms} ms` : ""}</p></td>
                    <td className="max-w-[360px] px-3 py-2 text-xs">
                      <p className="break-words text-muted-foreground">{c.detalhe}</p>
                      {c.status !== "ok" && c.acao && <p className="mt-0.5">→ {c.acao}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-secondary p-1 text-xs">
            {tipos.map((t) => (
              <button key={t.id} type="button" onClick={() => setTipo(t.id)}
                className={`rounded-md px-2.5 py-1 ${tipo === t.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>{t.label}</button>
            ))}
          </div>
          <select className="h-8 rounded-md border border-border bg-background px-2 text-xs" value={horas} onChange={(e) => setHoras(Number(e.target.value))} aria-label="Janela">
            <option value={1}>Última hora</option><option value={24}>24 horas</option><option value={168}>7 dias</option><option value={720}>30 dias</option>
          </select>
          {tipo === "http" && <span className="text-xs text-muted-foreground">Toda saída pra fora (conectores, redes, MCP, GitHub…) passa pelo safe_http e é medida aqui.</span>}
        </div>
        {erro ? <p className="text-sm text-destructive">{erro}</p> : !m ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando…</p>
        ) : m.linhas.length === 0 ? <Vazio>Sem chamadas nessa janela.</Vazio> : (
          <>
            <Serie serie={m.serie} />
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-secondary/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">{TIPOS.find((t) => t.id === tipo)!.chave}</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Erros</th>
                    {tipo === "api" && <th className="px-3 py-2 text-right">4xx</th>}
                    <th className="px-3 py-2 text-right">Média</th>
                    <th className="px-3 py-2 text-right">Pior</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {m.linhas.map((l) => (
                    <tr key={l.chave} className="bg-surface">
                      <td className="max-w-[380px] truncate px-3 py-1.5 font-mono text-xs" title={l.chave}>{l.chave}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.total}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${l.erros ? "text-destructive" : "text-muted-foreground"}`}>{l.erros} {l.erros > 0 && <span className="text-[11px]">({l.taxa_erro}%)</span>}</td>
                      {tipo === "api" && <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{l.erros_cliente}</td>}
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.ms_medio ?? "—"} ms</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${l.ms_max > 5000 ? "text-warning" : "text-muted-foreground"}`}>{l.ms_max} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
