// frontend/src/components/admin/AdminPanel.tsx
//
// Painel administrativo da empresa — um lugar só pra configurar o sistema:
// dados da empresa, IA, e-mails dos setores + caixa de saída, n8n, Hostinger,
// servidores (VPS), GitHub, conectores/MCP e aparência. Abre pela caixa
// "Empresa" do organograma ou pela engrenagem (lib/adminPanel.ts).
import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Building2,
  Github,
  Globe,
  Inbox,
  Mail,
  Palette,
  Plug,
  Server,
  Workflow,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import AIProvidersPanel from "@/components/builder/AIProvidersPanel";
import { AppearanceSettings } from "@/components/builder/SettingsModal";
import { ErpFormDialog } from "@/components/empresa/erp-crud";
import { EMPRESA_FIELDS, PainelNotaFiscal } from "@/components/empresa/erp-modulos";
import { EmailsSection } from "@/components/admin/EmailsSection";
import { OutboxSection } from "@/components/admin/OutboxSection";
import { N8nSection } from "@/components/admin/N8nSection";
import { GithubSection, HostingerSection, ServersSection } from "@/components/admin/InfraSections";
import { Badge, Card, SectionHeader } from "@/components/admin/shared";
import {
  getDadosEmpresa,
  getEmailOverview,
  listServiceCredentials,
  saveDadosEmpresa,
  type DadosEmpresa,
  type ServiceCredentialInfo,
} from "@/lib/api";
import { openEmpresaModule, useAdminPanelRequests, type AdminSection } from "@/lib/adminPanel";

const NAV: { id: AdminSection; label: string; icon: React.ElementType; group: string }[] = [
  { id: "empresa", label: "Empresa", icon: Building2, group: "Empresa" },
  { id: "ia", label: "Inteligência artificial", icon: Bot, group: "Empresa" },
  { id: "emails", label: "E-mails dos setores", icon: Mail, group: "Comunicação" },
  { id: "saida", label: "Caixa de saída", icon: Inbox, group: "Comunicação" },
  { id: "n8n", label: "Automações (n8n)", icon: Workflow, group: "Integrações" },
  { id: "hostinger", label: "Hostinger", icon: Globe, group: "Integrações" },
  { id: "servidores", label: "Servidores (VPS)", icon: Server, group: "Integrações" },
  { id: "github", label: "GitHub", icon: Github, group: "Integrações" },
  { id: "conectores", label: "Conectores e MCP", icon: Plug, group: "Integrações" },
  { id: "aparencia", label: "Aparência", icon: Palette, group: "Este navegador" },
];

function EmpresaSection() {
  const [empresa, setEmpresa] = useState<DadosEmpresa | null>(null);
  const [edit, setEdit] = useState(false);
  const load = useCallback(() => { getDadosEmpresa().then(setEmpresa).catch(() => setEmpresa(null)); }, []);
  useEffect(load, [load]);
  const row = (label: string, value: string | undefined) => (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value || "—"}</span>
    </div>
  );
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Dados da empresa"
        description="Razão social, CNPJ e endereço — usados na nota fiscal, nos e-mails de cotação e pedido e pelos agentes."
        actions={empresa && <Button size="sm" onClick={() => setEdit(true)}>Editar dados</Button>}
      />
      <Card>
        {empresa ? (
          <>
            {row("Razão social", empresa.razao_social)}
            {row("Nome fantasia", empresa.nome_fantasia)}
            {row("CNPJ", empresa.cnpj)}
            {row("Regime tributário", empresa.regime_tributario)}
            {row("Endereço", [empresa.logradouro, empresa.numero, empresa.bairro, empresa.municipio, empresa.uf].filter(Boolean).join(", "))}
            {row("E-mail fiscal", empresa.email_fiscal)}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
      </Card>
      <PainelNotaFiscal />
      {empresa && (
        <ErpFormDialog
          open={edit}
          onOpenChange={setEdit}
          title="Dados da empresa"
          description="Um cadastro por empresa (tenant)."
          fields={EMPRESA_FIELDS}
          initial={empresa as unknown as Record<string, unknown>}
          onSubmit={async (payload) => {
            await saveDadosEmpresa(payload as Partial<DadosEmpresa>);
            toast.success("Dados da empresa salvos.");
            load();
          }}
        />
      )}
    </div>
  );
}

function ConnectorsShortcut({ onGo }: { onGo: () => void }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Conectores e MCP"
        description="Fontes de dados dos agentes: REST, bancos SQL, Google Sheets, Notion, Slack, e-mail, webhooks, HubSpot, Salesforce e servidores MCP."
      />
      <Card className="space-y-3 text-sm">
        <p>
          <strong>Servidor MCP</strong>: conecte a URL do servidor (transporte HTTP), clique em <em>Descobrir ferramentas</em> e marque
          quais os agentes podem usar — cada uma com seu nível de risco. Ferramenta que escreve pede aprovação humana
          para agente sem autonomia (Policy Engine).
        </p>
        <p className="text-muted-foreground">Quem acessa cada conector é definido por setor, no painel do próprio conector (aba “Quem acessa”).</p>
        <Button onClick={onGo}><Plug className="size-3.5" /> Abrir Data Lake → Conectores</Button>
      </Card>
    </div>
  );
}

export function AdminPanelHost({ onNavigateEmpresa }: { onNavigateEmpresa: () => void }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<AdminSection>("empresa");
  const [creds, setCreds] = useState<ServiceCredentialInfo[]>([]);
  const [drafts, setDrafts] = useState(0);
  const [mailPending, setMailPending] = useState(0);

  const loadCreds = useCallback(() => { listServiceCredentials().then(setCreds).catch(() => setCreds([])); }, []);
  const loadCounters = useCallback(() => {
    getEmailOverview()
      .then((o) => {
        setDrafts(o.sectors.reduce((n, s) => n + s.drafts, 0));
        setMailPending(o.sectors.filter((s) => s.account?.status !== "ready").length);
      })
      .catch(() => undefined);
  }, []);

  const openAt = useCallback((s?: AdminSection) => {
    if (s) setSection(s);
    setOpen(true);
  }, []);
  useAdminPanelRequests(openAt);
  useEffect(() => {
    if (!open) return;
    loadCreds();
    loadCounters();
  }, [open, section, loadCreds, loadCounters]);

  const cred = (p: string) => creds.find((c) => c.provider === p);
  const configured = (p: string) => Boolean(cred(p)?.configured);
  const hint: Partial<Record<AdminSection, React.ReactNode>> = {
    emails: mailPending ? <Badge tone="warn">{mailPending}</Badge> : null,
    saida: drafts ? <Badge tone="info">{drafts}</Badge> : null,
    n8n: configured("n8n") ? <span className="size-1.5 rounded-full bg-success" /> : null,
    hostinger: configured("hostinger") ? <span className="size-1.5 rounded-full bg-success" /> : null,
    github: configured("github") ? <span className="size-1.5 rounded-full bg-success" /> : null,
  };

  let lastGroup = "";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(92vh,860px)] max-w-[min(1180px,96vw)] gap-0 overflow-hidden p-0 sm:max-w-[min(1180px,96vw)] [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">Painel administrativo</DialogTitle>
        <DialogDescription className="sr-only">Configurações da empresa, comunicação e integrações.</DialogDescription>
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-secondary/30 md:flex">
          <div className="border-b border-border px-4 py-4">
            <p className="font-display text-base font-semibold">Painel administrativo</p>
            <p className="text-xs text-muted-foreground">Configura tudo do sistema</p>
          </div>
          <nav className="flex-1 overflow-y-auto p-2">
            {NAV.map((item) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              const active = section === item.id;
              return (
                <div key={item.id}>
                  {header && <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{header}</p>}
                  <button
                    type="button"
                    onClick={() => setSection(item.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                      active ? "bg-surface font-medium text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-surface/60 hover:text-foreground"
                    }`}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {hint[item.id]}
                  </button>
                </div>
              );
            })}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <select
              value={section}
              onChange={(e) => setSection(e.target.value as AdminSection)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm md:hidden"
              aria-label="Seção"
            >
              {NAV.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
            <p className="hidden text-sm text-muted-foreground md:block">
              {NAV.find((n) => n.id === section)?.group} · <span className="text-foreground">{NAV.find((n) => n.id === section)?.label}</span>
            </p>
            <Button variant="ghost" size="icon" className="ml-auto size-8" onClick={() => setOpen(false)} title="Fechar">
              <X className="size-4" />
            </Button>
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {section === "empresa" && <EmpresaSection />}
            {section === "ia" && (
              <div className="space-y-4">
                <SectionHeader title="Inteligência artificial" description="Chaves dos provedores (cifradas). A IA de cada setor é escolhida na janela da sala, no Escritório 3D." />
                <Card><AIProvidersPanel /></Card>
              </div>
            )}
            {section === "emails" && <EmailsSection onOpenOutbox={() => setSection("saida")} />}
            {section === "saida" && <OutboxSection />}
            {section === "n8n" && <N8nSection credential={cred("n8n")} onCredentialsChanged={loadCreds} />}
            {section === "hostinger" && <HostingerSection credential={cred("hostinger")} onCredentialsChanged={loadCreds} />}
            {section === "servidores" && <ServersSection />}
            {section === "github" && <GithubSection credential={cred("github")} onCredentialsChanged={loadCreds} />}
            {section === "conectores" && (
              <ConnectorsShortcut onGo={() => { setOpen(false); onNavigateEmpresa(); openEmpresaModule("datalake"); }} />
            )}
            {section === "aparencia" && (
              <div className="space-y-4">
                <SectionHeader title="Aparência" description="Vale só para este navegador (também na engrenagem do topo)." />
                <Card><AppearanceSettings /></Card>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
