// frontend/src/components/empresa/marketing/marca.tsx — perfil da marca (o briefing do time)
import { useEffect, useState } from "react";
import { AlertTriangle, ImagePlus, Loader2, Trash2, Wand2, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { marketing, type PerfilMarca, type RamoPreset } from "@/lib/api";
import { Campo, erroMsg, selectCls, useBlobUrl } from "@/components/empresa/marketing/shared";

function Logo({ tem, versao, onChanged }: { tem: boolean; versao: string; onChanged: () => void }) {
  const url = useBlobUrl(tem ? `/api/v1/marketing/marca/logo/?v=${encodeURIComponent(versao)}` : null);
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-16 place-items-center overflow-hidden rounded-xl border border-border bg-secondary">
        {tem && url ? <img src={url} alt="logo" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="size-5 text-muted-foreground" />}
      </div>
      <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
        {tem ? "Trocar logo" : "Enviar logo"}
        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try { await marketing.enviarLogo(f); onChanged(); } catch (err) { toast.error(erroMsg(err)); }
        }} />
      </label>
      {tem && <Button variant="ghost" size="sm" onClick={async () => { await marketing.removerLogo(); onChanged(); }}><Trash2 className="size-3.5" /></Button>}
      <span className="text-[11px] text-muted-foreground">PNG com fundo transparente fica melhor nos criativos.</span>
    </div>
  );
}

export function MarcaTab({ onChanged }: { onChanged: () => void }) {
  const [m, setM] = useState<PerfilMarca | null>(null);
  const [ramos, setRamos] = useState<RamoPreset[]>([]);
  const [pilar, setPilar] = useState("");
  const [busy, setBusy] = useState(false);
  const carregar = () => marketing.marca().then(setM).catch(() => undefined);
  useEffect(() => { void carregar(); marketing.ramos().then(setRamos).catch(() => undefined); }, []);
  if (!m) return <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>;
  const set = <K extends keyof PerfilMarca>(k: K, v: PerfilMarca[K]) => setM({ ...m, [k]: v });
  const ramo = ramos.find((r) => r.chave === m.ramo);
  const salvar = async () => {
    setBusy(true);
    try {
      const dados: Partial<PerfilMarca> = { ...m };
      delete dados.tem_logo;
      delete dados.updated_at;
      setM(await marketing.salvarMarca(dados));
      toast.success("Perfil da marca salvo — o time usa isso em tudo que escreve.");
      onChanged();
    } catch (e) { toast.error(erroMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4 rounded-2xl border border-border bg-surface p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label="Nome da marca"><Input value={m.nome} onChange={(e) => set("nome", e.target.value)} /></Campo>
          <Campo label="Ramo" help="Qualquer ramo serve — o preset só sugere pilares e tom.">
            <div className="flex gap-2">
              <select className={selectCls} value={m.ramo} onChange={(e) => set("ramo", e.target.value)}>
                <option value="">Escolha…</option>
                {ramos.map((r) => <option key={r.chave} value={r.chave}>{r.nome}</option>)}
              </select>
              {ramo && (
                <Button type="button" size="sm" variant="outline" title="Aplicar pilares e tom sugeridos" onClick={() => setM({ ...m, pilares: ramo.pilares, tom_de_voz: m.tom_de_voz || ramo.tom })}>
                  <Wand2 className="size-3.5" />
                </Button>
              )}
            </div>
          </Campo>
        </div>
        {ramo?.aviso && <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" /> {ramo.aviso}</p>}
        <Campo label="O que a empresa faz (2–3 frases)"><Textarea rows={3} value={m.descricao} onChange={(e) => set("descricao", e.target.value)} /></Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label="Público"><Textarea rows={2} value={m.publico_alvo} onChange={(e) => set("publico_alvo", e.target.value)} placeholder="Quem compra, onde está, o que procura" /></Campo>
          <Campo label="Diferenciais"><Textarea rows={2} value={m.diferenciais} onChange={(e) => set("diferenciais", e.target.value)} /></Campo>
        </div>
        <Campo label="Tom de voz"><Input value={m.tom_de_voz} onChange={(e) => set("tom_de_voz", e.target.value)} placeholder="Ex.: próximo, direto, com humor leve" /></Campo>
        <Campo label="Pilares de conteúdo" help="Os temas que se revezam no calendário.">
          <div className="flex flex-wrap items-center gap-1.5">
            {m.pilares.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs">
                {p}<button type="button" onClick={() => set("pilares", m.pilares.filter((x) => x !== p))}><XIcon className="size-3" /></button>
              </span>
            ))}
            <Input className="h-8 w-48" value={pilar} onChange={(e) => setPilar(e.target.value)} placeholder="+ pilar (Enter)"
              onKeyDown={(e) => { if (e.key === "Enter" && pilar.trim()) { e.preventDefault(); set("pilares", [...m.pilares, pilar.trim()]); setPilar(""); } }} />
          </div>
        </Campo>
        <Campo label="Nunca dizer / prometer"><Textarea rows={2} value={m.evitar} onChange={(e) => set("evitar", e.target.value)} placeholder="Ex.: preço sem validade, “o melhor do Brasil”, garantia de resultado" /></Campo>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo label="Hashtags da marca"><Input value={m.hashtags} onChange={(e) => set("hashtags", e.target.value)} /></Campo>
          <Campo label="Chamada padrão (CTA)"><Input value={m.cta_padrao} onChange={(e) => set("cta_padrao", e.target.value)} /></Campo>
          <Campo label="Site"><Input value={m.site} onChange={(e) => set("site", e.target.value)} placeholder="https://" /></Campo>
        </div>
        <div className="flex justify-end"><Button onClick={() => void salvar()} disabled={busy}>{busy && <Loader2 className="size-3.5 animate-spin" />} Salvar perfil</Button></div>
      </div>
      <div className="space-y-3">
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm font-semibold">Identidade visual</p>
          <Logo tem={m.tem_logo} versao={m.updated_at} onChanged={() => void carregar()} />
          {(["cor_primaria", "cor_secundaria", "cor_texto"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="color" value={m[k]} onChange={(e) => set(k, e.target.value)} className="size-8 cursor-pointer rounded border border-border bg-transparent" />
              {{ cor_primaria: "Cor de destaque", cor_secundaria: "Cor de fundo", cor_texto: "Cor do texto" }[k]}
              <code className="ml-auto text-xs text-muted-foreground">{m[k]}</code>
            </label>
          ))}
          <div className="overflow-hidden rounded-xl p-4" style={{ background: `linear-gradient(135deg, ${m.cor_secundaria}, ${m.cor_secundaria} 55%, ${m.cor_primaria}55)` }}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: m.cor_primaria }}>{m.pilares[0] || "Pilar"}</p>
            <p className="font-display text-lg font-bold leading-tight" style={{ color: m.cor_texto }}>{m.nome || "Sua marca"}: o título do criativo aparece assim</p>
            <span className="mt-2 inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold text-white" style={{ backgroundColor: m.cor_primaria }}>{m.cta_padrao || "Saiba mais"}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">Salve o perfil pra usar as cores nos criativos.</p>
        </div>
      </div>
    </div>
  );
}
