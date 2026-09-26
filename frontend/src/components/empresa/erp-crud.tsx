// frontend/src/components/empresa/erp-crud.tsx
//
// CRUD genérico dos cadastros do ERP. Todo recurso do ERP é um ModelViewSet
// com o mesmo contrato (lista paginada, POST, PATCH, DELETE = exclusão
// lógica), então cada aba só descreve campos e colunas — a tabela, a busca,
// o formulário (com erro por campo vindo do DRF) e a confirmação de exclusão
// são os mesmos. Relações (parceiro, setor, centro de custo, projeto do CRM,
// item) carregam as opções do próprio backend, já filtradas pelo tenant.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, erpCreate, erpDelete, erpList, erpUpdate, type ErpResource } from "@/lib/api";
import {
  invalidateRelations,
  relationOptions,
  type Option,
  type RelationKey,
} from "@/components/empresa/erp-utils";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "email" | "number" | "money" | "date" | "select" | "textarea" | "checkbox" | "relation";
  options?: Option[];
  relation?: RelationKey;
  required?: boolean;
  placeholder?: string;
  help?: string;
  /** Ocupa as duas colunas do formulário. */
  wide?: boolean;
  /** Esconde o campo conforme o que já foi preenchido (ex: NCM só pra material). */
  hidden?: (form: Record<string, unknown>) => boolean;
}

export interface ColumnDef<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  align?: "right";
  className?: string;
}

export interface FilterChip {
  label: string;
  params: Record<string, string>;
}

function useRelations(fields: FieldDef[], open: boolean) {
  const [opts, setOpts] = useState<Partial<Record<RelationKey, Option[]>>>({});
  useEffect(() => {
    if (!open) return;
    const keys = [...new Set(fields.filter((f) => f.relation).map((f) => f.relation!))];
    keys.forEach((k) =>
      relationOptions(k)
        .then((o) => setOpts((prev) => ({ ...prev, [k]: o })))
        .catch(() => setOpts((prev) => ({ ...prev, [k]: [] }))),
    );
  }, [fields, open]);
  return opts;
}

// ─── Formulário ──────────────────────────────────────────────────────────────

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

function toFormValue(field: FieldDef, value: unknown): unknown {
  if (field.type === "checkbox") return Boolean(value);
  if (value === null || value === undefined) return "";
  return field.type === "relation" ? String(value) : value;
}

function toPayload(fields: FieldDef[], form: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = form[f.name];
    if (f.type === "checkbox") out[f.name] = Boolean(v);
    else if (f.type === "relation") out[f.name] = v === "" || v === undefined ? null : Number(v);
    else if (f.type === "date") out[f.name] = v === "" ? null : v;
    else if (f.type === "number" || f.type === "money") out[f.name] = v === "" || v === undefined ? null : v;
    else out[f.name] = v ?? "";
  }
  return out;
}

export function ErpFormDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  initial,
  onSubmit,
  submitLabel = "Salvar",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  fields: FieldDef[];
  initial: Record<string, unknown>;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  submitLabel?: string;
}) {
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const relations = useRelations(fields, open);

  useEffect(() => {
    if (!open) return;
    const f: Record<string, unknown> = {};
    for (const field of fields) f[field.name] = toFormValue(field, initial[field.name]);
    setForm(f);
    setErrors({});
  }, [open, fields, initial]);

  const set = (name: string, value: unknown) => setForm((prev) => ({ ...prev, [name]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const visible = fields.filter((f) => !f.hidden?.(form));
    const missing = visible.filter((f) => f.required && (form[f.name] === "" || form[f.name] === undefined));
    if (missing.length) {
      setErrors(Object.fromEntries(missing.map((f) => [f.name, "Obrigatório."])));
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      await onSubmit(toPayload(visible, form));
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.body ?? {})) {
          const msg = Array.isArray(v) ? String(v[0]) : typeof v === "string" ? v : "";
          if (msg && fields.some((f) => f.name === k)) fieldErrors[k] = msg;
        }
        setErrors(fieldErrors);
        if (!Object.keys(fieldErrors).length) toast.error(err.message);
      } else {
        toast.error("Não foi possível salvar.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields
            .filter((f) => !f.hidden?.(form))
            .map((f) => {
              const id = `erp-${f.name}`;
              const value = form[f.name];
              const wide = f.wide || f.type === "textarea";
              return (
                <div key={f.name} className={`space-y-1 ${wide ? "sm:col-span-2" : ""}`}>
                  {f.type === "checkbox" ? (
                    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 pt-5 text-sm">
                      <input
                        id={id}
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) => set(f.name, e.target.checked)}
                        className="size-4 accent-primary"
                      />
                      {f.label}
                    </label>
                  ) : (
                    <Label htmlFor={id} className="text-xs text-muted-foreground">
                      {f.label}
                      {f.required && <span className="text-destructive"> *</span>}
                    </Label>
                  )}
                  {f.type === "textarea" && (
                    <Textarea
                      id={id}
                      rows={3}
                      value={String(value ?? "")}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.name, e.target.value)}
                    />
                  )}
                  {(f.type === "select" || f.type === "relation") && (
                    <select
                      id={id}
                      className={selectCls}
                      value={String(value ?? "")}
                      onChange={(e) => set(f.name, e.target.value)}
                      disabled={f.type === "relation" && !relations[f.relation!]}
                    >
                      <option value="">{f.type === "relation" && !relations[f.relation!] ? "Carregando…" : "—"}</option>
                      {(f.type === "select" ? f.options : relations[f.relation!])?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {(!f.type || ["text", "email", "number", "money", "date"].includes(f.type)) && (
                    <Input
                      id={id}
                      type={f.type === "money" ? "number" : f.type ?? "text"}
                      step={f.type === "money" ? "0.01" : f.type === "number" ? "any" : undefined}
                      value={String(value ?? "")}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.name, e.target.value)}
                    />
                  )}
                  {errors[f.name] ? (
                    <p className="text-xs text-destructive">{errors[f.name]}</p>
                  ) : (
                    f.help && <p className="text-[11px] text-muted-foreground">{f.help}</p>
                  )}
                </div>
              );
            })}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Excluir",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Não foi possível excluir.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tabela + CRUD ───────────────────────────────────────────────────────────

export function ErpCrud<T extends { id: number }>({
  resource,
  title,
  description,
  singular,
  fields,
  columns,
  defaults = {},
  filters = [],
  baseParams = {},
  rowActions,
  headerExtra,
  onRowClick,
  onChanged,
  invalidates = [],
  canDelete = () => true,
  reloadKey = 0,
  emptyText = "Nenhum registro ainda.",
  feminino = false,
}: {
  resource: ErpResource;
  title: string;
  description?: string;
  singular: string;
  /** "Nova nota fiscal" / "criada" em vez de "Novo…" / "criado". */
  feminino?: boolean;
  fields: FieldDef[];
  columns: ColumnDef<T>[];
  defaults?: Record<string, unknown>;
  filters?: FilterChip[];
  baseParams?: Record<string, string>;
  rowActions?: (row: T, reload: () => void) => ReactNode;
  headerExtra?: ReactNode;
  onRowClick?: (row: T) => void;
  onChanged?: () => void;
  invalidates?: RelationKey[];
  canDelete?: (row: T) => boolean;
  reloadKey?: number;
  emptyText?: string;
}) {
  const novo = feminino ? "Nova" : "Novo";
  const [rows, setRows] = useState<T[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filterIdx, setFilterIdx] = useState(0);
  const [editing, setEditing] = useState<T | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<T | null>(null);

  // Chave pelo CONTEÚDO: baseParams/filters chegam como literais novos a cada
  // render do pai (e `filters = []` é um array novo a cada render daqui) —
  // comparar por identidade refazia a busca em loop.
  const paramsKey = JSON.stringify({
    ...baseParams,
    ...(filters[filterIdx]?.params ?? {}),
    ...(query ? { search: query } : {}),
  });
  const params = useMemo(() => JSON.parse(paramsKey) as Record<string, string>, [paramsKey]);

  const load = useCallback(() => {
    setLoading(true);
    erpList<T>(resource, params)
      .then(({ results, count }) => {
        setRows(results);
        setCount(count);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Erro ao carregar."))
      .finally(() => setLoading(false));
  }, [resource, params]);

  useEffect(load, [load, reloadKey]);

  // Busca no servidor com um respiro de 300ms
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const changed = () => {
    invalidateRelations(...invalidates);
    load();
    onChanged?.();
  };

  const initial = useMemo(
    () => (editing ? (editing as unknown as Record<string, unknown>) : defaults),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editing, formOpen],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold tracking-tight">{title}</h3>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerExtra}
          <Button variant="ghost" size="icon" title="Recarregar" onClick={load}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" /> {novo} {singular}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar…" className="h-8 pl-8" />
        </div>
        {filters.map((f, i) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setFilterIdx(i)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              i === filterIdx
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {count > rows.length ? `mostrando ${rows.length} de ${count}` : `${count} registro${count === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              {columns.map((c) => (
                <th key={c.key} className={`px-3 py-2 font-semibold ${c.align === "right" ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
              <th className="w-px px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-5 animate-spin" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-10 text-center text-muted-foreground">
                  {query ? "Nada encontrado para essa busca." : emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`group border-b border-border last:border-0 hover:bg-secondary/60 ${
                    onRowClick ? "cursor-pointer" : ""
                  }`}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2 align-middle ${c.align === "right" ? "text-right tabular-nums" : ""} ${
                        c.className ?? ""
                      }`}
                    >
                      {c.render
                        ? c.render(row)
                        : String((row as unknown as Record<string, unknown>)[c.key] ?? "") || "—"}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-0.5">
                      {rowActions?.(row, changed)}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        title="Editar"
                        onClick={() => {
                          setEditing(row);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      {canDelete(row) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 hover:text-destructive"
                          title="Excluir"
                          onClick={() => setDeleting(row)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ErpFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? `Editar ${singular}` : `${novo} ${singular}`}
        fields={fields}
        initial={initial}
        onSubmit={async (payload) => {
          if (editing) await erpUpdate(resource, editing.id, payload);
          else await erpCreate(resource, payload);
          toast.success(
            editing ? "Alterações salvas." : `${singular[0].toUpperCase()}${singular.slice(1)} ${feminino ? "criada" : "criado"}.`,
          );
          changed();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Excluir ${feminino ? "esta" : "este"} ${singular}?`}
        description="Sai das listas, mas não é apagado de verdade: o registro e o histórico continuam no banco (exclusão lógica)."
        onConfirm={async () => {
          await erpDelete(resource, deleting!.id);
          toast.success("Excluído.");
          changed();
        }}
      />
    </div>
  );
}
