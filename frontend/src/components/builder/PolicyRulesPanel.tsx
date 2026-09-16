// frontend/src/components/builder/PolicyRulesPanel.tsx
import { useEffect, useState } from "react";
import { Plus, Trash2, ShieldCheck, Loader2, X } from "lucide-react";
import {
  listPolicyRules,
  createPolicyRule,
  updatePolicyRule,
  deletePolicyRule,
  listSectors,
  type PolicyRule,
  type PolicyRuleRisk,
  type Sector,
  type AgentAutonomyLevel,
  ApiError,
} from "@/lib/api";

const AUTONOMY_LABEL: Record<AgentAutonomyLevel, string> = {
  0: "Observer",
  1: "Recommender",
  2: "Supervised Executor",
  3: "Policy Executor",
  4: "Autonomous",
};

const RISK_COLOR: Record<PolicyRuleRisk, string> = {
  medium: "text-yellow-400 bg-yellow-500/10",
  high: "text-orange-400 bg-orange-500/10",
  critical: "text-red-400 bg-red-500/10",
};

/**
 * CRUD de PolicyRule — regra configurável de governança (§13). Antes só
 * dava pra configurar via Django admin ou chamada de API crua; sem
 * regra ativa cobrindo um risco, agency.policy.evaluate_policy() SEMPRE
 * exige aprovação humana (a regra é a exceção explícita, nunca o
 * padrão — ver comentário do model PolicyRule).
 */
export default function PolicyRulesPanel() {
  const [rules, setRules] = useState<PolicyRule[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [newRuleOpen, setNewRuleOpen] = useState(false);

  async function refresh() {
    try {
      const [rulesData, sectorsData] = await Promise.all([listPolicyRules(), listSectors()]);
      setRules(rulesData);
      setSectors(sectorsData);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar regras.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleToggle(rule: PolicyRule) {
    setBusyId(rule.id);
    try {
      const updated = await updatePolicyRule(rule.id, { isActive: !rule.is_active });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao atualizar regra.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(rule: PolicyRule) {
    setBusyId(rule.id);
    try {
      await deletePolicyRule(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao apagar regra.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2 p-6">
        {[0, 1].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-card border border-white/10 bg-surface-raised" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-200">Regras de política</h2>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-400">{rules.length}</span>
        </div>
        <button
          onClick={() => setNewRuleOpen(true)}
          className="flex items-center gap-1.5 rounded-card bg-brand-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-brand-500/30 transition hover:bg-brand-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Nova regra
        </button>
      </div>

      {error && <p className="rounded-card border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}

      {rules.length === 0 && !error && (
        <p className="rounded-card border border-dashed border-white/10 py-8 text-center text-sm text-slate-500">
          Nenhuma regra configurada — sem isso, nenhum agente com autonomia Policy Executor ou Autonomous consegue
          executar risco médio ou acima sozinho. Toda ação nesse nível fica pendente de aprovação humana até você
          criar uma regra.
        </p>
      )}

      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center gap-3 rounded-card border border-white/10 bg-surface-raised p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${RISK_COLOR[rule.risk]}`}>{rule.risk}</span>
              <span className="text-xs text-slate-300">
                {rule.sector_name ? `Setor: ${rule.sector_name}` : "Tenant inteiro"}
              </span>
              <span className="text-[10px] text-slate-500">min. autonomia: {AUTONOMY_LABEL[rule.min_autonomy_level]}</span>
              {!rule.is_active && <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] text-slate-400">inativa</span>}
            </div>
            {rule.description && <p className="mt-1.5 text-xs text-slate-400">{rule.description}</p>}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {busyId === rule.id ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
            ) : (
              <>
                <button
                  onClick={() => handleToggle(rule)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                    rule.is_active
                      ? "bg-green-500/15 text-green-400 hover:bg-green-500/25"
                      : "bg-white/5 text-slate-400 hover:bg-white/10"
                  }`}
                >
                  {rule.is_active ? "Ativa" : "Ativar"}
                </button>
                <button
                  onClick={() => handleDelete(rule)}
                  className="rounded-lg bg-red-500/15 p-1.5 text-red-400 transition hover:bg-red-500/25"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      {newRuleOpen && (
        <NewPolicyRuleModal sectors={sectors} onClose={() => setNewRuleOpen(false)} onCreated={(r) => setRules((prev) => [r, ...prev])} />
      )}
    </div>
  );
}

interface NewPolicyRuleModalProps {
  sectors: Sector[];
  onClose: () => void;
  onCreated: (rule: PolicyRule) => void;
}

function NewPolicyRuleModal({ sectors, onClose, onCreated }: NewPolicyRuleModalProps) {
  const [sectorId, setSectorId] = useState<number | "">("");
  const [risk, setRisk] = useState<PolicyRuleRisk>("medium");
  const [minAutonomy, setMinAutonomy] = useState<AgentAutonomyLevel>(3);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const rule = await createPolicyRule({
        sector: sectorId === "" ? null : sectorId,
        risk,
        minAutonomyLevel: minAutonomy,
        description: description.trim(),
      });
      onCreated(rule);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar regra.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-card border border-white/10 bg-surface-raised p-5"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Nova regra de política</h3>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Escopo</label>
          <select
            value={sectorId}
            onChange={(e) => setSectorId(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            <option value="">Tenant inteiro (qualquer setor)</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Risco liberado</label>
          <select
            value={risk}
            onChange={(e) => setRisk(e.target.value as PolicyRuleRisk)}
            className="w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            <option value="medium">Médio</option>
            <option value="high">Alto</option>
            <option value="critical">Crítico</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Autonomia mínima exigida</label>
          <select
            value={minAutonomy}
            onChange={(e) => setMinAutonomy(Number(e.target.value) as AgentAutonomyLevel)}
            className="w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            <option value={3}>Policy Executor (3)</option>
            <option value={4}>Autonomous (4)</option>
          </select>
          <p className="mt-1 text-[10px] text-slate-500">
            Só agentes com essa autonomia ou mais conseguem usar esta regra. Risco crítico nunca é liberado pra
            Policy Executor, mesmo com regra — só Autonomous.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Descrição (opcional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
            placeholder="Por que essa regra existe?"
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {loading ? "Criando..." : "Criar regra"}
        </button>
      </form>
    </div>
  );
}
