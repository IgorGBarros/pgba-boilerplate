// frontend/src/components/empresa/juridico.tsx
//
// Setor Jurídico — inspirado nos sistemas jurídicos profissionais (contencioso
// com número CNJ e captura de andamentos, agenda de prazos em dias úteis,
// gestão de contratos, GED com modelos e assinatura eletrônica), adaptado à
// plataforma. Cada aba vive em components/empresa/juridico/.
import { useEffect, useState } from "react";
import { ArrowLeft, CalendarClock, FileSignature, FileText, Gauge, Landmark, Plug, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CredentialCard } from "@/components/admin/shared";
import { listServiceCredentials, type ServiceCredentialInfo } from "@/lib/api";
import { PainelTab, ProcessosTab } from "@/components/empresa/juridico/processos";
import { ContratosTab, PrazosTab } from "@/components/empresa/juridico/agenda";
import { AssinaturasTab, DocumentosTab } from "@/components/empresa/juridico/documentos";

const TABS = [
  { id: "painel", label: "Painel", icon: Gauge },
  { id: "processos", label: "Processos", icon: Scale },
  { id: "prazos", label: "Prazos", icon: CalendarClock },
  { id: "contratos", label: "Contratos", icon: Landmark },
  { id: "documentos", label: "Documentos", icon: FileText },
  { id: "assinaturas", label: "Assinaturas", icon: FileSignature },
] as const;
type Tab = (typeof TABS)[number]["id"];
const TAB_KEY = "pgba_juridico_tab";

function DataJudDialog({ onClose }: { onClose: () => void }) {
  const [cred, setCred] = useState<ServiceCredentialInfo | undefined>();
  const load = () => listServiceCredentials().then((l) => setCred(l.find((c) => c.provider === "datajud"))).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Captura de andamentos — DataJud (CNJ)</DialogTitle>
          <DialogDescription>
            API pública e gratuita do CNJ com as movimentações de todos os tribunais. A chave pública fica na wiki do DataJud
            (datajud-wiki.cnj.jus.br → API Pública → Acesso) e muda de tempos em tempos.
          </DialogDescription>
        </DialogHeader>
        <CredentialCard provider="datajud" current={cred} title="Chave da API pública" tokenLabel="APIKey"
          tokenPlaceholder="cole a chave publicada pelo CNJ" onChanged={() => void load()}
          tokenHelp="Só dados públicos (processo em segredo de justiça não aparece). Não substitui a intimação oficial." />
      </DialogContent>
    </Dialog>
  );
}

export function JuridicoView({ onBack }: { onBack: () => void }) {
  const [tab, setTabState] = useState<Tab>(() => {
    try { return (sessionStorage.getItem(TAB_KEY) as Tab) || "painel"; } catch { return "painel"; }
  });
  const [reload, setReload] = useState(0);
  const [datajud, setDatajud] = useState(false);
  const setTab = (t: string) => {
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* aba privada */ }
    setTabState(t as Tab);
  };
  const changed = () => setReload((r) => r + 1);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-gradient-to-r from-secondary via-violet-500/10 to-transparent px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onBack} className="grid size-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-secondary" title="Voltar">
            <ArrowLeft className="size-4" />
          </button>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary"><Scale className="size-5" /></span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold">Jurídico</h2>
            <p className="text-xs text-muted-foreground">Contencioso, prazos, contratos, documentos e assinatura eletrônica</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDatajud(true)}><Plug className="size-3.5" /> Integração DataJud</Button>
          </div>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-secondary p-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${tab === t.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "painel" && <PainelTab key={reload} onGo={setTab} />}
      {tab === "processos" && <ProcessosTab reloadKey={reload} onChanged={changed} />}
      {tab === "prazos" && <PrazosTab onChanged={changed} />}
      {tab === "contratos" && <ContratosTab onChanged={changed} />}
      {tab === "documentos" && <DocumentosTab onChanged={changed} />}
      {tab === "assinaturas" && <AssinaturasTab onChanged={changed} />}
      {datajud && <DataJudDialog onClose={() => setDatajud(false)} />}
    </div>
  );
}
