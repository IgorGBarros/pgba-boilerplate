// frontend/src/components/empresa/marketing/contas.tsx — conectar as 8 redes
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, KeyRound, Link2, Loader2, PlugZap, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { marketing, type AppsRedes, type ContaSocial, type ProvedorOAuth, type RedeSocial } from "@/lib/api";
import { Campo, ORDEM_REDES, REDES, RedeIcon, Tag, erroMsg, selectCls } from "@/components/empresa/marketing/shared";

/** O que cada rede exige de verdade — dito na tela, pra ninguém descobrir na hora de publicar. */
const REQUISITOS: Record<RedeSocial, string[]> = {
  instagram: [
    "Conta profissional (Empresa ou Criador) ligada a uma página do Facebook.",
    "App da Meta (tipo Empresa) com Instagram Graph API; em modo desenvolvimento funciona pra quem é admin do app — pra outras pessoas, a Meta revisa o app.",
    "A Meta busca a mídia por link: o servidor precisa de PUBLIC_API_URL (https público).",
  ],
  facebook: ["Página do Facebook (não perfil pessoal). Mesmo app e login do Instagram — conecta os dois juntos."],
  tiktok: [
    "App no TikTok for Developers com Login Kit + Content Posting API.",
    "Sem auditoria do TikTok, o vídeo vai pra caixa de entrada do app (você finaliza no celular) ou sai privado.",
  ],
  youtube: [
    "Projeto no Google Cloud com a YouTube Data API v3 e tela de consentimento OAuth.",
    "App não verificado pelo Google: os vídeos sobem como privados. Cota padrão ≈ 6 uploads por dia.",
  ],
  linkedin: [
    "App no LinkedIn Developers com os produtos “Sign In with LinkedIn using OpenID Connect” e “Share on LinkedIn”.",
    "Publica no seu perfil. Página de empresa precisa do produto Community Management (aprovação do LinkedIn).",
  ],
  x: ["App no portal de desenvolvedores do X com OAuth 2.0 (tipo Web App, confidential).", "Publicar exige um plano da API do X que permita escrita — confira os limites do seu plano."],
  discord: ["Nenhum app: crie um webhook no canal (Editar canal → Integrações → Webhooks) e cole a URL."],
  twitch: ["App no console da Twitch.", "A Twitch não tem feed de posts: o texto vai como anúncio no chat do seu canal."],
};

function AppForm({ prov, redirect, onSaved }: { prov: AppsRedes["provedores"][number]; redirect: string; onSaved: () => void }) {
  const [clientId, setClientId] = useState(prov.app?.client_id ?? "");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const salvar = async () => {
    setBusy(true);
    try { await marketing.salvarApp(prov.provedor, clientId, secret); setSecret(""); toast.success("App salvo."); onSaved(); }
    catch (e) { toast.error(erroMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
      <p className="text-xs font-semibold">App {prov.nome}</p>
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="text-muted-foreground">Endereço de retorno (cadastre no app):</span>
        <code className="min-w-0 truncate rounded bg-background px-1.5 py-0.5">{redirect}</code>
        <button type="button" title="Copiar" onClick={() => { void navigator.clipboard.writeText(redirect); toast.success("Copiado."); }}><Copy className="size-3" /></button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={prov.provedor === "tiktok" ? "Client key" : "Client ID / App ID"} />
        <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={prov.app?.secret_definido ? "•••• (deixe vazio pra manter)" : "Client secret"} autoComplete="off" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <a href={prov.portal} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary">Abrir portal de desenvolvedor <ExternalLink className="size-3" /></a>
        <Button size="sm" disabled={busy || !clientId || (!secret && !prov.app?.secret_definido)} onClick={() => void salvar()}>{busy && <Loader2 className="size-3.5 animate-spin" />} Salvar app</Button>
      </div>
      <p className="text-[10px] text-muted-foreground">Permissões pedidas: {prov.escopos.join(", ")}. Segredo guardado cifrado.</p>
    </div>
  );
}

function ManualForm({ rede, onDone }: { rede: RedeSocial; onDone: () => void }) {
  const [token, setToken] = useState("");
  const [contaId, setContaId] = useState("");
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState(false);
  const salvar = async () => {
    setBusy(true);
    try {
      const r = await marketing.conectarManual({ rede, token, conta_id: contaId, nome });
      toast[r.status === "conectada" ? "success" : "warning"](r.teste);
      onDone();
    } catch (e) { toast.error(erroMsg(e)); } finally { setBusy(false); }
  };
  const idLabel = { instagram: "Id da conta do Instagram (IG user id)", facebook: "Id da página", youtube: "Id do canal (UC…)", linkedin: "Id da pessoa (sub)", x: "Id do usuário", tiktok: "open_id", twitch: "Id do canal (broadcaster)", discord: "" }[rede];
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
      <p className="text-xs text-muted-foreground">Já tem um token gerado no portal da rede? Cole aqui (sem renovação automática).</p>
      <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token de acesso" autoComplete="off" />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={contaId} onChange={(e) => setContaId(e.target.value)} placeholder={idLabel} />
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome pra mostrar" />
      </div>
      <Button size="sm" variant="outline" disabled={busy || !token || !contaId} onClick={() => void salvar()}>{busy && <Loader2 className="size-3.5 animate-spin" />} Salvar e testar</Button>
    </div>
  );
}

function DiscordForm({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" />
      <div className="flex gap-2">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (ex.: #novidades)" />
        <Button size="sm" disabled={busy || !url} onClick={async () => {
          setBusy(true);
          try { await marketing.conectarDiscord(url, nome); toast.success("Canal conectado."); setUrl(""); onDone(); }
          catch (e) { toast.error(erroMsg(e)); } finally { setBusy(false); }
        }}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />} Conectar</Button>
      </div>
    </div>
  );
}

function ConfigConta({ conta, onDone }: { conta: ContaSocial; onDone: () => void }) {
  const [cfg, setCfg] = useState<Record<string, string>>(conta.config ?? {});
  if (!["youtube", "tiktok", "linkedin"].includes(conta.rede)) return null;
  const salvar = async (novo: Record<string, string>) => {
    setCfg(novo);
    try { await marketing.configConta(conta.id, novo); onDone(); } catch (e) { toast.error(erroMsg(e)); }
  };
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6 text-[11px]">
      {conta.rede === "youtube" && (
        <select className={`${selectCls} h-7 w-auto text-xs`} value={cfg.privacidade ?? "public"} onChange={(e) => void salvar({ ...cfg, privacidade: e.target.value })}>
          <option value="public">Público</option><option value="unlisted">Não listado</option><option value="private">Privado</option>
        </select>
      )}
      {conta.rede === "tiktok" && (
        <select className={`${selectCls} h-7 w-auto text-xs`} value={cfg.modo ?? "rascunho"} onChange={(e) => void salvar({ ...cfg, modo: e.target.value })}>
          <option value="rascunho">Mandar pra caixa de entrada do app</option><option value="direto">Publicar direto (app auditado)</option>
        </select>
      )}
      {conta.rede === "linkedin" && (
        <Input className="h-7 w-72 text-xs" defaultValue={cfg.author ?? ""} placeholder="Página: urn:li:organization:123 (opcional)"
          onBlur={(e) => { if (e.target.value !== (cfg.author ?? "")) void salvar({ ...cfg, author: e.target.value }); }} />
      )}
    </div>
  );
}

export function ContasTab({ onChanged }: { onChanged: () => void }) {
  const [contas, setContas] = useState<ContaSocial[] | null>(null);
  const [apps, setApps] = useState<AppsRedes | null>(null);
  const [aberta, setAberta] = useState<RedeSocial | null>(null);
  const [esperando, setEsperando] = useState<ProvedorOAuth | null>(null);
  const antes = useRef(0);
  const carregar = useCallback(async () => {
    const [c, a] = await Promise.all([marketing.contas(), marketing.apps()]);
    setContas(c); setApps(a);
    return c;
  }, []);
  useEffect(() => { void carregar().catch(() => setContas([])); }, [carregar]);

  // depois do login na janela da rede, a lista de contas muda — espera até 3 min
  useEffect(() => {
    if (!esperando) return;
    let n = 0;
    const t = setInterval(async () => {
      n++;
      const c = await carregar().catch(() => null);
      if ((c && c.length > antes.current) || n > 90) { setEsperando(null); if (c && c.length > antes.current) { toast.success("Conta conectada."); onChanged(); } }
    }, 2000);
    const msg = (e: MessageEvent) => { if (e.data?.tipo === "marketing-oauth") void carregar(); };
    window.addEventListener("message", msg);
    return () => { clearInterval(t); window.removeEventListener("message", msg); };
  }, [esperando, carregar, onChanged]);

  const conectar = async (provedor: ProvedorOAuth) => {
    const janela = window.open("", "pgba-oauth", "width=620,height=760");
    try {
      const { url } = await marketing.conectar(provedor);
      antes.current = contas?.length ?? 0;
      if (janela) janela.location.href = url; else window.location.href = url;
      setEsperando(provedor);
    } catch (e) { janela?.close(); toast.error(erroMsg(e)); }
  };

  if (!contas || !apps) return <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>;
  const provDe = (r: RedeSocial) => apps.provedores.find((p) => p.redes.includes(r));

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Cada rede pede um <b>app</b> criado no portal de desenvolvedor dela (uma vez só) — depois é só “Conectar” e autorizar na janela da rede.
        Tokens ficam cifrados e nunca voltam pra tela.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {ORDEM_REDES.map((r) => {
          const minhas = contas.filter((c) => c.rede === r);
          const prov = provDe(r);
          const temApp = !!prov?.app;
          return (
            <div key={r} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl" style={{ backgroundColor: `${REDES[r].cor}14` }}><RedeIcon rede={r} className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{REDES[r].nome}</p>
                  <p className="text-xs text-muted-foreground">{REDES[r].dica}</p>
                </div>
                {r === "discord" ? null : temApp ? (
                  <Button size="sm" onClick={() => void conectar(prov!.provedor)} disabled={!!esperando}>
                    {esperando === prov!.provedor ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />} Conectar
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setAberta(aberta === r ? null : r)}><KeyRound className="size-3.5" /> Configurar app</Button>
                )}
              </div>
              {minhas.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {minhas.map((c) => (
                    <li key={c.id} className="rounded-lg border border-border px-2.5 py-1.5">
                      <div className="flex items-center gap-2 text-sm">
                        {c.status === "conectada" ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <AlertTriangle className="size-4 shrink-0 text-warning" />}
                        <span className="min-w-0 flex-1 truncate">{c.nome}{c.usuario && <span className="text-muted-foreground"> @{c.usuario.replace(/^@/, "")}</span>}</span>
                        {c.status !== "conectada" && <Tag tone="warn">{c.status === "expirada" ? "reconectar" : "erro"}</Tag>}
                        {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-muted-foreground"><ExternalLink className="size-3.5" /></a>}
                        <button title="Testar" className="text-muted-foreground hover:text-foreground" onClick={async () => {
                          try { const t = await marketing.testarConta(c.id); toast.success(t.detail); } catch (e) { toast.error(erroMsg(e)); }
                          void carregar();
                        }}><PlugZap className="size-3.5" /></button>
                        <button title="Desconectar" className="text-muted-foreground hover:text-destructive" onClick={async () => { await marketing.removerConta(c.id); void carregar(); onChanged(); }}><Trash2 className="size-3.5" /></button>
                      </div>
                      {c.mensagem && <p className="mt-0.5 pl-6 text-[11px] text-warning">{c.mensagem}</p>}
                      <ConfigConta conta={c} onDone={() => void carregar()} />
                    </li>
                  ))}
                </ul>
              )}
              {r === "discord" && <div className="mt-3"><DiscordForm onDone={() => { void carregar(); onChanged(); }} /></div>}
              <details className="mt-2" open={aberta === r}>
                <summary className="cursor-pointer text-[11px] text-muted-foreground" onClick={(e) => { e.preventDefault(); setAberta(aberta === r ? null : r); }}>
                  O que precisa{temApp ? " · app configurado" : ""}
                </summary>
                {aberta === r && (
                  <div className="mt-2 space-y-2">
                    <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">{REQUISITOS[r].map((x) => <li key={x}>{x}</li>)}</ul>
                    {prov && <AppForm prov={prov} redirect={apps.redirect_uri} onSaved={() => void carregar()} />}
                    {r !== "discord" && <ManualForm rede={r} onDone={() => { void carregar(); onChanged(); }} />}
                  </div>
                )}
              </details>
            </div>
          );
        })}
      </div>
      {esperando && (
        <Dialog open onOpenChange={(o) => !o && setEsperando(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Autorize na janela da rede</DialogTitle>
              <DialogDescription>Quando terminar, a conta aparece aqui sozinha.</DialogDescription>
            </DialogHeader>
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Esperando…</p>
            <Campo label=""><Button variant="ghost" size="sm" onClick={() => setEsperando(null)}>Parar de esperar</Button></Campo>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
