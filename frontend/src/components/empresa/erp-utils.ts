// frontend/src/components/empresa/erp-utils.ts
// Funções (não-componentes) do CRUD do ERP: opções de relação com cache e
// formatação. Ficam fora dos .tsx pra não quebrar o fast refresh do Vite.
import {
  erpList,
  listCentrosCusto,
  listProjects,
  listSectors,
  type ItemEstoque,
  type ParceiroNegocio,
} from "@/lib/api";

export type Option = { value: string; label: string };

export type RelationKey =
  | "parceiros"
  | "clientes"
  | "fornecedores"
  | "setores"
  | "centros_custo"
  | "projetos"
  | "itens"
  | "processos_juridicos"
  | "contratos_juridicos";

// ─── Opções de relação (cache por sessão da tela) ────────────────────────────

const relationCache = new Map<RelationKey, Promise<Option[]>>();

function parceiroLabel(p: ParceiroNegocio) {
  return `${p.codigo} — ${p.nome}`;
}

async function loadRelation(key: RelationKey): Promise<Option[]> {
  switch (key) {
    case "parceiros":
    case "clientes":
    case "fornecedores": {
      const tipo: Record<string, string> =
        key === "clientes" ? { tipo: "cliente" } : key === "fornecedores" ? { tipo: "fornecedor" } : {};
      const { results } = await erpList<ParceiroNegocio>("parceiros", { ordering: "nome", ...tipo });
      return results.map((p) => ({ value: String(p.id), label: parceiroLabel(p) }));
    }
    case "setores":
      return (await listSectors()).map((s) => ({ value: String(s.id), label: s.name }));
    case "centros_custo":
      return (await listCentrosCusto()).map((c) => ({
        value: String(c.id),
        label: c.codigo ? `${c.codigo} — ${c.nome}` : c.nome,
      }));
    case "projetos":
      return (await listProjects()).map((p) => ({ value: String(p.id), label: p.titulo }));
    case "itens": {
      const { results } = await erpList<ItemEstoque>("estoque", { ordering: "nome" });
      return results.map((i) => ({
        value: String(i.id),
        label: `${i.codigo} — ${i.nome} (${i.tipo_item === "servico" ? "serviço" : "material"})`,
      }));
    }
    case "processos_juridicos": {
      const { results } = await erpList<{ id: number; titulo: string; numero_cnj: string }>("juridico/processos", { ordering: "-created_at" });
      return results.map((p) => ({ value: String(p.id), label: p.numero_cnj ? `${p.numero_cnj} — ${p.titulo}` : p.titulo }));
    }
    case "contratos_juridicos": {
      const { results } = await erpList<{ id: number; titulo: string; partes: string }>("juridico/contratos", { ordering: "-created_at" });
      return results.map((c) => ({ value: String(c.id), label: `${c.titulo} — ${c.partes}` }));
    }
  }
}

export function relationOptions(key: RelationKey, refresh = false): Promise<Option[]> {
  if (refresh || !relationCache.has(key)) {
    relationCache.set(
      key,
      loadRelation(key).catch((err) => {
        relationCache.delete(key);
        throw err;
      }),
    );
  }
  return relationCache.get(key)!;
}

/** Depois de criar/editar um parceiro, item etc., os selects de outras abas recarregam. */
export function invalidateRelations(...keys: RelationKey[]) {
  (keys.length ? keys : [...relationCache.keys()]).forEach((k) => relationCache.delete(k));
}

// ─── Formatação ──────────────────────────────────────────────────────────────

export function brl(v: number | string | null | undefined) {
  const n = typeof v === "string" ? parseFloat(v) : v ?? 0;
  return (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function dataBR(v: string | null | undefined) {
  if (!v) return "—";
  const [y, m, d] = v.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

