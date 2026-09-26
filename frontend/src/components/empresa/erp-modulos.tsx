// frontend/src/components/empresa/erp-modulos.tsx
//
// Módulos do ERP no conceito do SAP Business One: Parceiros de negócio,
// Itens (serviço/material), Contratos de serviço, Financeiro, RH, Fiscal e
// Contabilidade — todos com CRUD (ErpCrud) e ligados entre si: o contrato
// aponta pro parceiro, pro projeto do CRM, pro centro de custo e pro setor;
// fatura, baixa de estoque e NF (rascunho) saem do próprio contrato.
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  FileText,
  Loader2,
  PackageMinus,
  Pause,
  Play,
  Plus,
  Receipt,
  Square,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Metric } from "@/components/empresa/shared";
import {
  ConfirmDialog,
  ErpCrud,
  ErpFormDialog,
  type ColumnDef,
  type FieldDef,
} from "@/components/empresa/erp-crud";
import { brl, dataBR, relationOptions, type Option } from "@/components/empresa/erp-utils";
import {
  contratoAcao,
  contratoBaixarMaterial,
  contratoDeProjeto,
  contratoGerarFaturas,
  contratoGerarNotaFiscal,
  contratoParcelas,
  erpCreate,
  erpDelete,
  erpList,
  erpUpdate,
  getContrato,
  getDadosEmpresa,
  getProntidaoNotaFiscal,
  listProjetosAguardandoContrato,
  saveDadosEmpresa,
  type BalancetePeriodo,
  type ContratoAcao,
  type ContratoServico,
  type ContratoStatus,
  type DadosEmpresa,
  type Funcionario,
  type ItemContrato,
  type ItemEstoque,
  type LancamentoFinanceiro,
  type LinhaDRE,
  type NotaFiscal,
  type ObrigacaoFiscal,
  type ParcelaPrevista,
  type ParceiroNegocio,
  type ProjetoAguardandoContrato,
  type ProntidaoNotaFiscal,
} from "@/lib/api";

// ─── Selos ───────────────────────────────────────────────────────────────────

type Tone = "muted" | "success" | "warning" | "danger" | "info";

const TONE: Record<Tone, string> = {
  muted: "border-border bg-secondary text-muted-foreground",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

export function Pill({ tone = "muted", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

const CONTRATO_TONE: Record<ContratoStatus, Tone> = {
  rascunho: "muted",
  ativo: "success",
  suspenso: "warning",
  encerrado: "info",
  cancelado: "danger",
};

const LANC_TONE: Record<LancamentoFinanceiro["status"], Tone> = {
  pendente: "warning",
  pago: "success",
  vencido: "danger",
  cancelado: "muted",
};

const NF_TONE: Record<NotaFiscal["status"], Tone> = {
  rascunho: "muted",
  pendente: "warning",
  autorizada: "success",
  cancelada: "danger",
  denegada: "danger",
};

// ─── Opções ──────────────────────────────────────────────────────────────────

const opts = (pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));

const UFS = opts(
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO"
    .split(" ")
    .map((u) => [u, u]),
);

// ─── Parceiros de negócio ────────────────────────────────────────────────────

const PARCEIRO_FIELDS: FieldDef[] = [
  { name: "tipo", label: "Tipo", type: "select", required: true,
    options: opts([["cliente", "Cliente"], ["fornecedor", "Fornecedor"], ["lead", "Lead"]]) },
  { name: "categoria", label: "Categoria", placeholder: "ex: Serviços, Construção" },
  { name: "nome", label: "Razão social / nome", required: true, wide: true },
  { name: "nome_fantasia", label: "Nome fantasia" },
  { name: "cpf_cnpj", label: "CPF / CNPJ", help: "CPF é dado pessoal: aparece mascarado depois de salvo." },
  { name: "inscricao_estadual", label: "Inscrição estadual" },
  { name: "inscricao_municipal", label: "Inscrição municipal" },
  { name: "email", label: "E-mail", type: "email" },
  { name: "telefone", label: "Telefone" },
  { name: "cep", label: "CEP" },
  { name: "logradouro", label: "Logradouro" },
  { name: "numero", label: "Número" },
  { name: "complemento", label: "Complemento" },
  { name: "bairro", label: "Bairro" },
  { name: "municipio", label: "Município" },
  { name: "uf", label: "UF", type: "select", options: UFS },
  { name: "codigo_municipio_ibge", label: "Código IBGE do município", help: "7 dígitos — exigido na NFS-e do tomador." },
  { name: "observacoes", label: "Observações", type: "textarea" },
];

const TIPO_TONE: Record<ParceiroNegocio["tipo"], Tone> = { cliente: "success", fornecedor: "info", lead: "muted" };

const PARCEIRO_COLS: ColumnDef<ParceiroNegocio>[] = [
  { key: "codigo", label: "Código", className: "font-mono text-xs" },
  {
    key: "nome",
    label: "Nome",
    render: (p) => (
      <div>
        <p className="font-medium">{p.nome}</p>
        {p.nome_fantasia && <p className="text-xs text-muted-foreground">{p.nome_fantasia}</p>}
      </div>
    ),
  },
  { key: "tipo", label: "Tipo", render: (p) => <Pill tone={TIPO_TONE[p.tipo]}>{p.tipo_display}</Pill> },
  { key: "cpf_cnpj", label: "CPF/CNPJ", className: "font-mono text-xs" },
  { key: "cidade", label: "Cidade", render: (p) => (p.municipio ? `${p.municipio}/${p.uf}` : "—") },
  { key: "contato", label: "Contato", render: (p) => p.email || p.telefone || "—" },
];

export function TabParceiros() {
  return (
    <ErpCrud<ParceiroNegocio>
      resource="parceiros"
      title="Parceiros de negócio"
      description="Clientes, fornecedores e leads num cadastro só — todo contrato, fatura e nota aponta pra um parceiro."
      singular="parceiro"
      fields={PARCEIRO_FIELDS}
      columns={PARCEIRO_COLS}
      defaults={{ tipo: "cliente" }}
      filters={[
        { label: "Todos", params: {} },
        { label: "Clientes", params: { tipo: "cliente" } },
        { label: "Fornecedores", params: { tipo: "fornecedor" } },
        { label: "Leads", params: { tipo: "lead" } },
      ]}
      invalidates={["parceiros", "clientes", "fornecedores"]}
    />
  );
}

// ─── Itens (serviço / material) ──────────────────────────────────────────────

const ITEM_FIELDS: FieldDef[] = [
  { name: "tipo_item", label: "Tipo", type: "select", required: true,
    options: opts([["material", "Material (controla estoque)"], ["servico", "Serviço (sem estoque)"]]) },
  { name: "codigo", label: "Código", required: true },
  { name: "nome", label: "Descrição", required: true, wide: true },
  { name: "categoria", label: "Categoria" },
  { name: "unidade", label: "Unidade", type: "select",
    options: opts([["un", "Unidade"], ["kg", "Kg"], ["m", "Metro"], ["l", "Litro"], ["cx", "Caixa"], ["pc", "Peça"],
      ["h", "Hora"], ["mes", "Mês"], ["sv", "Serviço"]]) },
  { name: "preco_venda", label: "Preço de venda", type: "money", help: "Sugerido ao adicionar o item num contrato." },
  { name: "custo_unitario", label: "Custo unitário", type: "money", hidden: (f) => f.tipo_item === "servico" },
  { name: "quantidade", label: "Saldo inicial", type: "number", hidden: (f) => f.tipo_item === "servico",
    help: "Depois de criado, o saldo muda só por movimentação." },
  { name: "quantidade_minima", label: "Estoque mínimo", type: "number", hidden: (f) => f.tipo_item === "servico" },
  { name: "localizacao", label: "Localização", hidden: (f) => f.tipo_item === "servico" },
  { name: "fornecedor", label: "Fornecedor padrão", type: "relation", relation: "fornecedores",
    hidden: (f) => f.tipo_item === "servico" },
  { name: "ncm", label: "NCM", hidden: (f) => f.tipo_item === "servico", help: "8 dígitos — exigido na NF-e." },
  { name: "codigo_servico", label: "Código do serviço (LC 116)", hidden: (f) => f.tipo_item !== "servico",
    help: "ex: 01.07 — vai na NFS-e." },
];

export function ItensCrud({ onMovimentar, onChanged }: { onMovimentar: (i: ItemEstoque) => void; onChanged?: () => void }) {
  return (
    <ErpCrud<ItemEstoque>
      resource="estoque"
      title="Cadastro de itens"
      description="Material controla estoque; serviço não tem saldo e leva o código da LC 116 pra NFS-e."
      singular="item"
      fields={ITEM_FIELDS}
      defaults={{ tipo_item: "material", unidade: "un", quantidade: 0, quantidade_minima: 0 }}
      filters={[
        { label: "Todos", params: {} },
        { label: "Materiais", params: { tipo_item: "material" } },
        { label: "Serviços", params: { tipo_item: "servico" } },
      ]}
      invalidates={["itens"]}
      onChanged={onChanged}
      columns={[
        { key: "codigo", label: "Código", className: "font-mono text-xs" },
        {
          key: "nome",
          label: "Item",
          render: (i) => (
            <div>
              <p className="font-medium">{i.nome}</p>
              <p className="text-xs text-muted-foreground">{i.categoria || "—"}</p>
            </div>
          ),
        },
        { key: "tipo", label: "Tipo", render: (i) => <Pill tone={i.tipo_item === "servico" ? "info" : "muted"}>{i.tipo_item_display}</Pill> },
        {
          key: "saldo",
          label: "Saldo",
          align: "right",
          render: (i) =>
            i.tipo_item === "servico" ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span className={i.abaixo_minimo ? "font-semibold text-warning" : ""} title={`mínimo ${i.quantidade_minima}`}>
                {i.quantidade} {i.unidade}
                {i.abaixo_minimo && <AlertTriangle className="ml-1 inline size-3.5" />}
              </span>
            ),
        },
        { key: "preco", label: "Preço", align: "right", render: (i) => brl(i.preco_venda) },
        { key: "fiscal", label: "Fiscal", className: "font-mono text-xs", render: (i) => (i.tipo_item === "servico" ? i.codigo_servico : i.ncm) || "—" },
      ]}
      rowActions={(i) =>
        i.tipo_item === "material" ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onMovimentar(i)}>
            Movimentar
          </Button>
        ) : null
      }
    />
  );
}

// ─── Financeiro ──────────────────────────────────────────────────────────────

const LANCAMENTO_FIELDS: FieldDef[] = [
  { name: "tipo", label: "Tipo", type: "select", required: true, options: opts([["receita", "A receber"], ["despesa", "A pagar"]]) },
  { name: "status", label: "Status", type: "select", required: true,
    options: opts([["pendente", "Pendente"], ["pago", "Pago"], ["vencido", "Vencido"], ["cancelado", "Cancelado"]]) },
  { name: "descricao", label: "Descrição", required: true, wide: true },
  { name: "valor", label: "Valor", type: "money", required: true },
  { name: "vencimento", label: "Vencimento", type: "date", required: true },
  { name: "parceiro", label: "Parceiro", type: "relation", relation: "parceiros" },
  { name: "categoria", label: "Categoria", type: "select",
    options: opts([["operacional", "Operacional"], ["pessoal", "Pessoal"], ["impostos", "Impostos"], ["servicos", "Serviços"],
      ["vendas", "Vendas"], ["investimento", "Investimento"], ["outro", "Outro"]]) },
  { name: "projeto", label: "Projeto (CRM)", type: "relation", relation: "projetos" },
  { name: "centro_custo", label: "Centro de custo", type: "relation", relation: "centros_custo" },
  { name: "setor", label: "Setor", type: "relation", relation: "setores" },
  { name: "numero_documento", label: "Nº documento" },
  { name: "data_pagamento", label: "Data do pagamento", type: "date", hidden: (f) => f.status !== "pago" },
];

const ORIGEM_LABEL: Record<LancamentoFinanceiro["origem"], string> = { manual: "manual", contrato: "contrato", compra: "compra" };

export function LancamentosCrud({ onChanged }: { onChanged?: () => void }) {
  return (
    <ErpCrud<LancamentoFinanceiro>
      resource="financeiro"
      title="Contas a receber e a pagar"
      description="Faturas de contrato e pedidos de compra entregues entram aqui sozinhos; o resto é lançamento manual."
      singular="lançamento"
      fields={LANCAMENTO_FIELDS}
      defaults={{ tipo: "receita", status: "pendente", categoria: "servicos" }}
      baseParams={{ ordering: "vencimento" }}
      filters={[
        { label: "A receber", params: { tipo: "receita" } },
        { label: "A pagar", params: { tipo: "despesa" } },
        { label: "Em aberto", params: { status: "pendente" } },
        { label: "Todos", params: {} },
      ]}
      onChanged={onChanged}
      columns={[
        {
          key: "descricao",
          label: "Descrição",
          render: (l) => (
            <div>
              <p className="font-medium">{l.descricao}</p>
              <p className="text-xs text-muted-foreground">
                {[l.parceiro_nome || l.cliente || l.fornecedor_nome, l.projeto_titulo, l.centro_custo_nome, l.setor_nome]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </p>
            </div>
          ),
        },
        { key: "origem", label: "Origem", render: (l) => <Pill tone={l.origem === "manual" ? "muted" : "info"}>{ORIGEM_LABEL[l.origem] ?? l.origem}</Pill> },
        { key: "vencimento", label: "Vencimento", render: (l) => dataBR(l.vencimento) },
        {
          key: "valor",
          label: "Valor",
          align: "right",
          render: (l) => <span className={l.tipo === "despesa" ? "text-destructive" : ""}>{l.tipo === "despesa" ? "− " : ""}{brl(l.valor)}</span>,
        },
        { key: "status", label: "Status", render: (l) => <Pill tone={LANC_TONE[l.status]}>{l.status}</Pill> },
      ]}
      rowActions={(l, reload) =>
        l.status === "pendente" || l.status === "vencido" ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={async () => {
              await erpUpdate("financeiro", l.id, { status: "pago" });
              toast.success(l.tipo === "receita" ? "Recebimento registrado." : "Pagamento registrado.");
              reload();
            }}
          >
            {l.tipo === "receita" ? "Receber" : "Pagar"}
          </Button>
        ) : null
      }
    />
  );
}

// ─── RH ──────────────────────────────────────────────────────────────────────

const FUNCIONARIO_FIELDS: FieldDef[] = [
  { name: "nome", label: "Nome", required: true, wide: true },
  { name: "cargo", label: "Cargo", required: true },
  { name: "setor", label: "Setor", type: "relation", relation: "setores", help: "Mesmos setores do organograma." },
  { name: "centro_custo", label: "Centro de custo", type: "relation", relation: "centros_custo" },
  { name: "departamento", label: "Departamento", help: "Vazio = nome do setor." },
  { name: "salario", label: "Salário", type: "money" },
  { name: "status", label: "Status", type: "select", required: true,
    options: opts([["ativo", "Ativo"], ["ferias", "Férias"], ["afastado", "Afastado"], ["desligado", "Desligado"]]) },
  { name: "data_admissao", label: "Admissão", type: "date", required: true },
  { name: "data_demissao", label: "Demissão", type: "date" },
  { name: "email", label: "E-mail", type: "email" },
  { name: "cpf", label: "CPF", help: "Dado pessoal: aparece mascarado depois de salvo." },
];

export function FuncionariosCrud({ onChanged }: { onChanged?: () => void }) {
  return (
    <ErpCrud<Funcionario>
      resource="funcionarios"
      title="Colaboradores"
      description="Cada pessoa num setor da empresa e num centro de custo."
      singular="colaborador"
      fields={FUNCIONARIO_FIELDS}
      defaults={{ status: "ativo", data_admissao: new Date().toISOString().slice(0, 10) }}
      filters={[
        { label: "Ativos", params: { status: "ativo" } },
        { label: "Todos", params: {} },
      ]}
      onChanged={onChanged}
      columns={[
        { key: "nome", label: "Nome", render: (f) => <span className="font-medium">{f.nome}</span> },
        { key: "cargo", label: "Cargo" },
        { key: "setor", label: "Setor", render: (f) => f.setor_nome || f.departamento || "—" },
        { key: "cc", label: "Centro de custo", render: (f) => f.centro_custo_nome || "—" },
        { key: "admissao", label: "Admissão", render: (f) => dataBR(f.data_admissao) },
        { key: "salario", label: "Salário", align: "right", render: (f) => brl(f.salario) },
        { key: "status", label: "Status", render: (f) => <Pill tone={f.status === "ativo" ? "success" : f.status === "desligado" ? "danger" : "warning"}>{f.status}</Pill> },
      ]}
    />
  );
}

// ─── Fiscal ──────────────────────────────────────────────────────────────────

const NF_FIELDS: FieldDef[] = [
  { name: "tipo", label: "Tipo", type: "select", required: true, options: opts([["nfse", "NFS-e (serviço)"], ["nfe", "NF-e (produto)"]]) },
  { name: "status", label: "Status", type: "select", required: true,
    options: opts([["rascunho", "Rascunho"], ["pendente", "Pendente"], ["autorizada", "Autorizada"], ["cancelada", "Cancelada"], ["denegada", "Denegada"]]) },
  { name: "numero", label: "Número", required: true },
  { name: "serie", label: "Série" },
  { name: "parceiro", label: "Tomador / destinatário", type: "relation", relation: "clientes" },
  { name: "emissao", label: "Emissão", type: "date" },
  { name: "valor", label: "Valor", type: "money", required: true },
  { name: "codigo_servico", label: "Código do serviço", hidden: (f) => f.tipo === "nfe" },
  { name: "cfop", label: "CFOP", hidden: (f) => f.tipo === "nfse" },
  { name: "aliquota_iss", label: "Alíquota ISS (%)", type: "number", hidden: (f) => f.tipo === "nfe" },
  { name: "valor_iss", label: "Valor ISS", type: "money", hidden: (f) => f.tipo === "nfe" },
  { name: "chave_acesso", label: "Chave de acesso / código de verificação", wide: true },
  { name: "discriminacao", label: "Discriminação", type: "textarea" },
];

export function NotasFiscaisCrud({ reloadKey }: { reloadKey?: number }) {
  return (
    <ErpCrud<NotaFiscal>
      resource="notas-fiscais"
      title="Notas fiscais"
      description="Rascunho = montada no ERP a partir do contrato, ainda não transmitida. O número e a chave da nota autorizada entram aqui."
      singular="nota fiscal"
      feminino
      fields={NF_FIELDS}
      defaults={{ tipo: "nfse", status: "pendente" }}
      reloadKey={reloadKey}
      filters={[
        { label: "Todas", params: {} },
        { label: "Rascunhos", params: { status: "rascunho" } },
        { label: "Autorizadas", params: { status: "autorizada" } },
      ]}
      columns={[
        { key: "numero", label: "Número", className: "font-mono text-xs" },
        { key: "tipo", label: "Tipo", render: (n) => n.tipo_display },
        {
          key: "cliente",
          label: "Tomador",
          render: (n) => (
            <div>
              <p>{n.cliente || "—"}</p>
              {n.contrato_numero && <p className="text-xs text-muted-foreground">{n.contrato_numero}</p>}
            </div>
          ),
        },
        { key: "emissao", label: "Emissão", render: (n) => dataBR(n.emissao) },
        { key: "valor", label: "Valor", align: "right", render: (n) => brl(n.valor) },
        { key: "status", label: "Status", render: (n) => <Pill tone={NF_TONE[n.status]}>{n.status}</Pill> },
      ]}
    />
  );
}

const OBRIGACAO_FIELDS: FieldDef[] = [
  { name: "nome", label: "Obrigação", required: true, wide: true, placeholder: "ex: DAS, ISS, DCTFWeb" },
  { name: "orgao", label: "Órgão" },
  { name: "competencia", label: "Competência", placeholder: "AAAA-MM" },
  { name: "vencimento", label: "Vencimento", type: "date", required: true },
  { name: "status", label: "Status", type: "select", required: true,
    options: opts([["pendente", "Pendente"], ["agendada", "Agendada"], ["entregue", "Entregue"], ["vencida", "Vencida"]]) },
];

export function ObrigacoesCrud() {
  return (
    <ErpCrud<ObrigacaoFiscal>
      resource="obrigacoes-fiscais"
      title="Obrigações fiscais"
      singular="obrigação"
      feminino
      fields={OBRIGACAO_FIELDS}
      defaults={{ status: "pendente" }}
      baseParams={{ ordering: "vencimento" }}
      columns={[
        { key: "nome", label: "Obrigação", render: (o) => <span className="font-medium">{o.nome}</span> },
        { key: "orgao", label: "Órgão" },
        { key: "competencia", label: "Competência" },
        { key: "vencimento", label: "Vencimento", render: (o) => dataBR(o.vencimento) },
        {
          key: "status",
          label: "Status",
          render: (o) => (
            <Pill tone={o.status === "entregue" ? "success" : o.status === "vencida" ? "danger" : "warning"}>{o.status}</Pill>
          ),
        },
      ]}
    />
  );
}

// ─── Contabilidade ───────────────────────────────────────────────────────────

const DRE_FIELDS: FieldDef[] = [
  { name: "competencia", label: "Competência", required: true, placeholder: "AAAA-MM" },
  { name: "ordem", label: "Ordem", type: "number" },
  { name: "conta", label: "Conta", required: true, wide: true },
  { name: "tipo", label: "Tipo", type: "select", required: true,
    options: opts([["receita", "Receita"], ["deducao", "Dedução"], ["subtotal", "Subtotal"], ["custo", "Custo"],
      ["despesa", "Despesa"], ["imposto", "Imposto"], ["resultado", "Resultado"]]) },
  { name: "valor_atual", label: "Valor atual", type: "money", required: true },
  { name: "valor_anterior", label: "Valor anterior", type: "money" },
];

export function DreCrud({ onChanged }: { onChanged?: () => void }) {
  return (
    <ErpCrud<LinhaDRE>
      resource="linhas-dre"
      title="Linhas da DRE"
      singular="linha"
      feminino
      fields={DRE_FIELDS}
      defaults={{ tipo: "receita", ordem: 0, competencia: new Date().toISOString().slice(0, 7) }}
      baseParams={{ ordering: "competencia,ordem" }}
      onChanged={onChanged}
      columns={[
        { key: "competencia", label: "Competência" },
        { key: "ordem", label: "#", className: "text-muted-foreground" },
        { key: "conta", label: "Conta", render: (l) => <span className="font-medium">{l.conta}</span> },
        { key: "tipo", label: "Tipo" },
        { key: "valor_atual", label: "Atual", align: "right", render: (l) => brl(l.valor_atual) },
        { key: "valor_anterior", label: "Anterior", align: "right", render: (l) => brl(l.valor_anterior) },
      ]}
    />
  );
}

const BALANCETE_FIELDS: FieldDef[] = [
  { name: "competencia", label: "Competência", required: true, placeholder: "AAAA-MM" },
  { name: "ativo_total", label: "Ativo total", type: "money", required: true },
  { name: "passivo_total", label: "Passivo total", type: "money", required: true },
  { name: "patrimonio_liquido", label: "Patrimônio líquido", type: "money", required: true },
];

export function BalanceteCrud({ onChanged }: { onChanged?: () => void }) {
  return (
    <ErpCrud<BalancetePeriodo>
      resource="balancete"
      title="Balancete por competência"
      singular="balancete"
      fields={BALANCETE_FIELDS}
      defaults={{ competencia: new Date().toISOString().slice(0, 7) }}
      onChanged={onChanged}
      columns={[
        { key: "competencia", label: "Competência", render: (b) => <span className="font-medium">{b.competencia}</span> },
        { key: "ativo_total", label: "Ativo", align: "right", render: (b) => brl(b.ativo_total) },
        { key: "passivo_total", label: "Passivo", align: "right", render: (b) => brl(b.passivo_total) },
        { key: "patrimonio_liquido", label: "PL", align: "right", render: (b) => brl(b.patrimonio_liquido) },
      ]}
    />
  );
}

// ─── Fiscal: prontidão da NF + dados da empresa ──────────────────────────────

export const EMPRESA_FIELDS: FieldDef[] = [
  { name: "razao_social", label: "Razão social", wide: true },
  { name: "nome_fantasia", label: "Nome fantasia" },
  { name: "cnpj", label: "CNPJ" },
  { name: "inscricao_municipal", label: "Inscrição municipal" },
  { name: "inscricao_estadual", label: "Inscrição estadual" },
  { name: "regime_tributario", label: "Regime tributário", type: "select",
    options: opts([["mei", "MEI"], ["simples", "Simples Nacional"], ["presumido", "Lucro Presumido"], ["real", "Lucro Real"]]) },
  { name: "email_fiscal", label: "E-mail fiscal", type: "email" },
  { name: "cep", label: "CEP" },
  { name: "logradouro", label: "Logradouro" },
  { name: "numero", label: "Número" },
  { name: "bairro", label: "Bairro" },
  { name: "municipio", label: "Município" },
  { name: "uf", label: "UF", type: "select", options: UFS },
  { name: "codigo_municipio_ibge", label: "Código IBGE do município" },
  { name: "codigo_servico_padrao", label: "Código de serviço padrão (LC 116)" },
  { name: "aliquota_iss_padrao", label: "Alíquota de ISS padrão (%)", type: "number" },
  { name: "serie_nfse", label: "Série da NFS-e" },
];

export function PainelNotaFiscal() {
  const [prontidao, setProntidao] = useState<ProntidaoNotaFiscal | null>(null);
  const [empresa, setEmpresa] = useState<DadosEmpresa | null>(null);
  const [editar, setEditar] = useState(false);

  const load = useCallback(() => {
    getProntidaoNotaFiscal().then(setProntidao).catch(() => setProntidao(null));
    getDadosEmpresa().then(setEmpresa).catch(() => setEmpresa(null));
  }, []);
  useEffect(load, [load]);

  const ok = prontidao?.itens.filter((i) => i.ok).length ?? 0;
  const total = prontidao?.itens.length ?? 0;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-display text-base font-semibold tracking-tight">
            <Receipt className="size-4" /> Emissão de nota fiscal — o que falta
          </h3>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
            O ERP já monta a NFS-e do contrato como rascunho. Transmitir pra prefeitura/Emissor Nacional precisa de
            certificado digital e de um emissor integrado — ainda não implementado (docs/NOTA_FISCAL.md).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {prontidao && <Pill tone={prontidao.pronto ? "success" : "warning"}>{ok}/{total} prontos</Pill>}
          <Button size="sm" variant="outline" onClick={() => setEditar(true)} disabled={!empresa}>
            Dados da empresa
          </Button>
        </div>
      </div>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {prontidao?.itens.map((i) => (
          <li key={i.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-secondary/60">
            {i.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning" />
            )}
            <span>
              <span className={i.ok ? "" : "font-medium"}>{i.label}</span>
              {i.detalhe && <span className="block text-xs text-muted-foreground">{i.detalhe}</span>}
            </span>
          </li>
        ))}
      </ul>
      {empresa && (
        <ErpFormDialog
          open={editar}
          onOpenChange={setEditar}
          title="Dados da empresa emitente"
          description="O que a NFS-e exige do prestador. Fica um por empresa (tenant)."
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

// ─── Contratos de serviço ────────────────────────────────────────────────────

const PERIODICIDADE = opts([["unica", "Parcela única"], ["mensal", "Mensal"], ["trimestral", "Trimestral"], ["anual", "Anual"]]);

const CONTRATO_FIELDS: FieldDef[] = [
  { name: "nome_projeto", label: "Nome do projeto", required: true, wide: true },
  { name: "descricao", label: "Breve descrição do projeto", type: "textarea" },
  { name: "parceiro", label: "Cliente", type: "relation", relation: "clientes", required: true },
  { name: "projeto", label: "Projeto de origem (CRM)", type: "relation", relation: "projetos" },
  { name: "data_inicio", label: "Início", type: "date", required: true },
  { name: "data_fim", label: "Fim", type: "date", required: true },
  { name: "valor_total", label: "Valor do contrato", type: "money",
    help: "Com linhas de serviço/material, o valor passa a ser a soma delas." },
  { name: "com_material", label: "Contrato com material", type: "checkbox" },
  { name: "periodicidade", label: "Faturamento", type: "select", options: PERIODICIDADE, required: true },
  { name: "dia_vencimento", label: "Dia de vencimento", type: "number", help: "1 a 28." },
  { name: "centro_custo", label: "Centro de custo", type: "relation", relation: "centros_custo" },
  { name: "setor", label: "Setor responsável", type: "relation", relation: "setores" },
  { name: "responsavel", label: "Responsável" },
  { name: "observacoes", label: "Observações", type: "textarea" },
];

const hoje = () => new Date().toISOString().slice(0, 10);

function vigencia(c: ContratoServico) {
  return `${dataBR(c.data_inicio)} → ${dataBR(c.data_fim)}`;
}

function ProjetosPendentes({ onCriado }: { onCriado: (c: ContratoServico) => void }) {
  const [projetos, setProjetos] = useState<ProjetoAguardandoContrato[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => {
    listProjetosAguardandoContrato().then(setProjetos).catch(() => setProjetos([]));
  }, []);
  useEffect(load, [load]);

  if (!projetos?.length) return null;
  return (
    <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
      <p className="text-sm font-semibold">
        {projetos.length} projeto{projetos.length > 1 ? "s" : ""} do CRM aguardando contrato
      </p>
      <p className="text-xs text-muted-foreground">
        Marcados como “será contrato” no CRM. O contrato nasce em rascunho com nome, descrição, datas e valor do projeto.
      </p>
      <ul className="mt-3 space-y-1.5">
        {projetos.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.titulo}</p>
              <p className="text-xs text-muted-foreground">
                {[p.empresa, p.valor != null ? brl(p.valor) : null, p.data_inicio ? `${dataBR(p.data_inicio)} → ${dataBR(p.data_fim_previsto)}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {p.contrato_com_material && <Pill tone="info">com material</Pill>}
            <Button
              size="sm"
              disabled={busy === p.id}
              onClick={async () => {
                setBusy(p.id);
                try {
                  const c = await contratoDeProjeto(p.id);
                  toast.success(`Contrato ${c.numero} criado.`);
                  load();
                  onCriado(c);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Não foi possível criar o contrato.");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === p.id ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Criar contrato
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TabContratos() {
  const [aberto, setAberto] = useState<ContratoServico | null>(null);
  const [reload, setReload] = useState(0);
  const [resumo, setResumo] = useState<ContratoServico[]>([]);

  const refresh = useCallback(() => {
    setReload((n) => n + 1);
    erpList<ContratoServico>("contratos").then((r) => setResumo(r.results)).catch(() => {});
  }, []);
  useEffect(() => {
    erpList<ContratoServico>("contratos").then((r) => setResumo(r.results)).catch(() => {});
  }, []);

  const ativos = resumo.filter((c) => c.status === "ativo");
  const em30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const vencendo = ativos.filter((c) => c.data_fim <= em30).length;
  const aReceber = ativos.reduce((s, c) => s + (parseFloat(c.valor_total) - c.recebido), 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Contratos ativos" value={String(ativos.length)} icon={<FileText className="size-4" />} tone="success" />
        <Metric label="Valor em vigor" value={brl(ativos.reduce((s, c) => s + parseFloat(c.valor_total), 0))} icon={<Wallet className="size-4" />} />
        <Metric label="Falta receber" value={brl(aReceber)} icon={<Receipt className="size-4" />} />
        <Metric label="Vencem em 30 dias" value={String(vencendo)} icon={<AlertTriangle className="size-4" />} tone={vencendo ? "warning" : "default"} />
      </div>

      <ProjetosPendentes
        onCriado={(c) => {
          refresh();
          setAberto(c);
        }}
      />

      <ErpCrud<ContratoServico>
        resource="contratos"
        title="Contratos de serviço"
        description="Com ou sem material. Clique num contrato pra ver linhas, parcelas, faturas e notas."
        singular="contrato"
        fields={CONTRATO_FIELDS}
        defaults={{ data_inicio: hoje(), periodicidade: "mensal", dia_vencimento: 10, com_material: false }}
        reloadKey={reload}
        onChanged={refresh}
        onRowClick={setAberto}
        canDelete={(c) => c.status !== "ativo" && c.status !== "suspenso"}
        filters={[
          { label: "Todos", params: {} },
          { label: "Ativos", params: { status: "ativo" } },
          { label: "Rascunhos", params: { status: "rascunho" } },
          { label: "Com material", params: { com_material: "true" } },
        ]}
        columns={[
          { key: "numero", label: "Número", className: "font-mono text-xs" },
          {
            key: "nome_projeto",
            label: "Projeto",
            render: (c) => (
              <div className="max-w-[320px]">
                <p className="truncate font-medium">{c.nome_projeto}</p>
                <p className="truncate text-xs text-muted-foreground">{c.descricao || "—"}</p>
              </div>
            ),
          },
          { key: "cliente", label: "Cliente", render: (c) => c.parceiro_nome },
          { key: "vigencia", label: "Vigência", render: vigencia, className: "whitespace-nowrap text-xs" },
          { key: "valor", label: "Valor", align: "right", render: (c) => brl(c.valor_total) },
          {
            key: "status",
            label: "Status",
            render: (c) => (
              <div className="flex flex-wrap gap-1">
                <Pill tone={CONTRATO_TONE[c.status]}>{c.status_display}</Pill>
                {c.com_material && <Pill tone="info">material</Pill>}
              </div>
            ),
          },
        ]}
      />

      {aberto && (
        <ContratoDetalhe
          contratoId={aberto.id}
          onClose={() => setAberto(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

// ─── Detalhe do contrato ─────────────────────────────────────────────────────

const ACOES: Record<ContratoStatus, { acao: ContratoAcao; label: string; icon: typeof Play; danger?: boolean }[]> = {
  rascunho: [
    { acao: "ativar", label: "Ativar", icon: Play },
    { acao: "cancelar", label: "Cancelar", icon: Ban, danger: true },
  ],
  ativo: [
    { acao: "suspender", label: "Suspender", icon: Pause },
    { acao: "encerrar", label: "Encerrar", icon: Square },
    { acao: "cancelar", label: "Cancelar", icon: Ban, danger: true },
  ],
  suspenso: [
    { acao: "ativar", label: "Reativar", icon: Play },
    { acao: "encerrar", label: "Encerrar", icon: Square },
    { acao: "cancelar", label: "Cancelar", icon: Ban, danger: true },
  ],
  encerrado: [],
  cancelado: [],
};

function NovaLinha({ contrato, onSaved }: { contrato: ContratoServico; onSaved: () => void }) {
  const [itens, setItens] = useState<Option[]>([]);
  const [item, setItem] = useState("");
  const [tipo, setTipo] = useState<"servico" | "material">("servico");
  const [descricao, setDescricao] = useState("");
  const [qtd, setQtd] = useState("1");
  const [valor, setValor] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    relationOptions("itens").then(setItens).catch(() => setItens([]));
  }, []);

  const cls = "h-8 rounded-md border border-input bg-background px-2 text-sm";
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border p-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await erpCreate("contratos-itens", {
            contrato: contrato.id,
            item: item ? Number(item) : null,
            tipo,
            descricao,
            quantidade: qtd || "1",
            ...(valor ? { valor_unitario: valor } : {}),
          });
          setItem("");
          setDescricao("");
          setQtd("1");
          setValor("");
          onSaved();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Não foi possível adicionar a linha.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <select className={`${cls} min-w-[200px] flex-1`} value={item} onChange={(e) => setItem(e.target.value)} aria-label="Item do cadastro">
        <option value="">Linha avulsa (sem item)</option>
        {itens.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {!item && (
        <>
          <select className={cls} value={tipo} onChange={(e) => setTipo(e.target.value as "servico" | "material")} aria-label="Tipo da linha">
            <option value="servico">Serviço</option>
            <option value="material">Material</option>
          </select>
          <Input className="h-8 min-w-[160px] flex-1" placeholder="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </>
      )}
      <Input className="h-8 w-20" type="number" step="any" min="0" placeholder="Qtd" value={qtd} onChange={(e) => setQtd(e.target.value)} aria-label="Quantidade" />
      <Input className="h-8 w-28" type="number" step="0.01" min="0" placeholder={item ? "Preço do item" : "Valor unit."} value={valor} onChange={(e) => setValor(e.target.value)} aria-label="Valor unitário" />
      <Button size="sm" type="submit" disabled={busy || (!item && !descricao)}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Linha
      </Button>
    </form>
  );
}

function ContratoDetalhe({
  contratoId,
  onClose,
  onChanged,
}: {
  contratoId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [c, setC] = useState<ContratoServico | null>(null);
  const [parcelas, setParcelas] = useState<ParcelaPrevista[]>([]);
  const [faturas, setFaturas] = useState<LancamentoFinanceiro[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<ItemContrato | null>(null);

  const recarregar = useCallback(async () => {
    try {
      const [contrato, fat, parc] = await Promise.all([
        getContrato(contratoId),
        erpList<LancamentoFinanceiro>("financeiro", { contrato: String(contratoId), ordering: "vencimento" }),
        contratoParcelas(contratoId).catch(() => [] as ParcelaPrevista[]),
      ]);
      setC(contrato);
      setFaturas(fat.results);
      setParcelas(parc);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar o contrato.");
    }
  }, [contratoId]);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await recarregar();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível concluir.");
    } finally {
      setBusy(null);
    }
  };

  const editavel = c && (c.status === "rascunho" || c.status === "suspenso");
  const pendenteMaterial = c?.itens.some((i) => i.tipo === "material" && parseFloat(i.quantidade_baixada) < parseFloat(i.quantidade));
  const nfPorFatura = new Map(c?.notas_fiscais.map((n) => [n.numero, n]) ?? []);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        {!c ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{c.numero}</span>
                <Pill tone={CONTRATO_TONE[c.status]}>{c.status_display}</Pill>
                {c.com_material && <Pill tone="info">com material</Pill>}
              </div>
              <DialogTitle className="text-xl">{c.nome_projeto}</DialogTitle>
              <DialogDescription className="whitespace-pre-line">{c.descricao || "Sem descrição."}</DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-secondary/40 p-3 text-sm sm:grid-cols-4">
              <Info label="Cliente" value={c.parceiro_nome} />
              <Info label="Vigência" value={vigencia(c)} />
              <Info label="Valor" value={brl(c.valor_total)} />
              <Info label="Faturamento" value={`${PERIODICIDADE.find((p) => p.value === c.periodicidade)?.label} · dia ${c.dia_vencimento}`} />
              <Info label="Projeto (CRM)" value={c.projeto_titulo || "—"} />
              <Info label="Centro de custo" value={c.centro_custo_nome || "—"} />
              <Info label="Setor" value={c.setor_nome || "—"} />
              <Info label="Recebido / faturado" value={`${brl(c.recebido)} / ${brl(c.faturado)}`} />
            </dl>

            <div className="flex flex-wrap gap-2">
              {ACOES[c.status].map((a) => (
                <Button
                  key={a.acao}
                  size="sm"
                  variant={a.danger ? "outline" : a.acao === "ativar" ? "default" : "outline"}
                  className={a.danger ? "text-destructive hover:text-destructive" : ""}
                  disabled={busy !== null}
                  onClick={() => run(a.acao, () => contratoAcao(c.id, a.acao), `Contrato: ${a.label.toLowerCase()} feito.`)}
                >
                  {busy === a.acao ? <Loader2 className="size-4 animate-spin" /> : <a.icon className="size-4" />}
                  {a.label}
                </Button>
              ))}
              {c.status === "ativo" && (
                <>
                  <Button size="sm" variant="outline" disabled={busy !== null}
                    onClick={() => run("faturas", async () => {
                      const r = await contratoGerarFaturas(c.id);
                      if (!r.criadas.length) throw new Error("Todas as parcelas já foram faturadas.");
                    }, "Faturas geradas no financeiro.")}>
                    {busy === "faturas" ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                    Gerar faturas
                  </Button>
                  {c.com_material && (
                    <Button size="sm" variant="outline" disabled={busy !== null || !pendenteMaterial}
                      title={pendenteMaterial ? "Saída do estoque do material do contrato" : "Nenhum material pendente"}
                      onClick={() => run("material", () => contratoBaixarMaterial(c.id), "Material baixado do estoque.")}>
                      {busy === "material" ? <Loader2 className="size-4 animate-spin" /> : <PackageMinus className="size-4" />}
                      Baixar material
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* Linhas */}
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Serviços e materiais</h4>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2">Linha</th>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2 text-right">Qtd</th>
                      <th className="px-3 py-2 text-right">Unitário</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="w-px px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {c.itens.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                          Sem linhas — o valor do contrato é o digitado ({brl(c.valor_total)}).
                        </td>
                      </tr>
                    ) : (
                      c.itens.map((i) => (
                        <tr key={i.id} className="border-b border-border last:border-0">
                          <td className="px-3 py-2">
                            <p className="font-medium">{i.descricao}</p>
                            {i.item_codigo && <p className="font-mono text-[11px] text-muted-foreground">{i.item_codigo}</p>}
                          </td>
                          <td className="px-3 py-2">
                            <Pill tone={i.tipo === "material" ? "info" : "muted"}>{i.tipo === "material" ? "material" : "serviço"}</Pill>
                            {i.tipo === "material" && parseFloat(i.quantidade_baixada) > 0 && (
                              <span className="ml-1 text-[11px] text-muted-foreground">baixado {parseFloat(i.quantidade_baixada)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{parseFloat(i.quantidade)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{brl(i.valor_unitario)}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{brl(i.valor_total)}</td>
                          <td className="px-2 py-1 text-right">
                            {editavel && parseFloat(i.quantidade_baixada) === 0 && (
                              <Button variant="ghost" size="icon" className="size-7 hover:text-destructive" title="Remover linha" onClick={() => setRemovendo(i)}>
                                <Trash2 className="size-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {(c.status === "rascunho" || c.status === "ativo" || c.status === "suspenso") && (
                <NovaLinha contrato={c} onSaved={() => { recarregar(); onChanged(); }} />
              )}
            </section>

            {/* Parcelas e faturas */}
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">
                Parcelas {faturas.length ? `· ${faturas.length} faturada${faturas.length > 1 ? "s" : ""}` : "previstas"}
              </h4>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2">Parcela</th>
                      <th className="px-3 py-2">Vencimento</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                      <th className="px-3 py-2">Fatura</th>
                      <th className="px-3 py-2">Nota fiscal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parcelas.map((p) => {
                      const ref = `${c.numero}#${p.parcela}`;
                      const fatura = faturas.find((f) => f.referencia_origem === ref);
                      const nf = nfPorFatura.get(`RASC-${ref}`);
                      return (
                        <tr key={p.parcela} className="border-b border-border last:border-0">
                          <td className="px-3 py-2">{p.parcela}/{p.total_parcelas}</td>
                          <td className="px-3 py-2">{dataBR(fatura?.vencimento ?? p.vencimento)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{brl(fatura?.valor ?? p.valor)}</td>
                          <td className="px-3 py-2">
                            {fatura ? <Pill tone={LANC_TONE[fatura.status]}>{fatura.status}</Pill> : <span className="text-xs text-muted-foreground">não faturada</span>}
                          </td>
                          <td className="px-3 py-2">
                            {nf ? (
                              <Pill tone={NF_TONE[nf.status]}>{nf.status}</Pill>
                            ) : fatura ? (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy !== null}
                                onClick={() => run(`nf-${fatura.id}`, () => contratoGerarNotaFiscal(c.id, fatura.id), "Nota fiscal montada (rascunho).")}>
                                {busy === `nf-${fatura.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Receipt className="size-3.5" />}
                                Gerar NF
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                “Gerar NF” monta a NFS-e com os dados do contrato e da empresa, como rascunho — a transmissão depende de um
                emissor integrado (Fiscal → o que falta).
              </p>
            </section>
          </>
        )}
      </DialogContent>
      {removendo && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRemovendo(null)}
          title="Remover linha?"
          description={`“${removendo.descricao}” sai do contrato e o valor é recalculado.`}
          confirmLabel="Remover"
          onConfirm={async () => {
            await erpDelete("contratos-itens", removendo.id);
            setRemovendo(null);
            await recarregar();
            onChanged();
          }}
        />
      )}
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium" title={value}>{value}</dd>
    </div>
  );
}
