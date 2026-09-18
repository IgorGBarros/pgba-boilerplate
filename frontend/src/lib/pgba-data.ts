export type AgentStatus = "working" | "idle" | "paused";
export type TaskStatus = "backlog" | "execucao" | "revisao" | "concluido";
export type TaskPriority = "alta" | "media" | "baixa";
export type DocType = "PDF" | "Documento" | "Imagem" | "Planilha";
export type ProjectState = "ativo" | "rascunho" | "arquivado";
export type ProjectKind = "motor" | "projeto" | "grupo";

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  rag: boolean;
  model: string;
  skills: string;
}

export interface Sector {
  id: string;
  name: string;
  description: string;
  icon: "commercial" | "purchasing" | "finance" | "dev" | "ops";
  rag: boolean;
  docs: number;
  agents: Agent[];
}

export interface Task {
  id: string;
  status: TaskStatus;
  priority: TaskPriority;
  title: string;
  sector: string;
  agent: string;
  project: string;
}

export interface KnowledgeDoc {
  id: string;
  type: DocType;
  name: string;
  sector: string;
  size: string;
  indexed: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  state: ProjectState;
  kind: ProjectKind;
  sector?: string;
  updated: string;
  children?: Project[];
}

export const aiModels: string[] = [
  "gpt-6-astra",
  "claude-opus-5",
  "gemini-2.5-pro",
  "kimi-k2",
  "llama-3.3-70b",
  "mistral-large",
  "ollama/llama3",
];

export const sectors: Sector[] = [
  {
    id: "commercial",
    name: "Comercial",
    description: "Geração de leads, follow-ups e propostas comerciais automatizadas.",
    icon: "commercial",
    rag: true,
    docs: 14,
    agents: [
      {
        id: "ag-c1",
        name: "Agente SDR",
        role: "Prospecção e qualificação",
        status: "working",
        rag: true,
        model: "gpt-6-astra",
        skills:
          "# SDR\n\n## Responsabilidades\n- Prospectar leads inbound e outbound\n- Qualificar oportunidades via ICP\n\n## Regras\n- Nunca enviar proposta sem aprovação humana.\n",
      },
      {
        id: "ag-c2",
        name: "Agente CRM",
        role: "Gestão de pipeline",
        status: "idle",
        rag: true,
        model: "claude-opus-5",
        skills:
          "# CRM\n\n## Responsabilidades\n- Atualizar estágios no CRM\n- Gerar relatórios de funil\n",
      },
    ],
  },
  {
    id: "purchasing",
    name: "Compras",
    description: "Cotações, pedidos de compra e gestão de fornecedores.",
    icon: "purchasing",
    rag: true,
    docs: 8,
    agents: [
      {
        id: "ag-p1",
        name: "Agente Compras",
        role: "Cotação e pedidos",
        status: "idle",
        rag: true,
        model: "gemini-2.5-pro",
        skills:
          "# Compras\n\n## Responsabilidades\n- Comparar cotações de fornecedores\n- Emitir ordens de compra\n",
      },
    ],
  },
  {
    id: "finance",
    name: "Controladoria",
    description: "Conciliação, fluxo de caixa e relatórios financeiros.",
    icon: "finance",
    rag: false,
    docs: 0,
    agents: [
      {
        id: "ag-f1",
        name: "Agente Conciliação",
        role: "Conciliação bancária",
        status: "paused",
        rag: false,
        model: "kimi-k2",
        skills:
          "# Conciliação\n\n## Responsabilidades\n- Conciliar extratos bancários\n- Sinalizar divergências\n",
      },
    ],
  },
  {
    id: "dev",
    name: "Desenvolvimento",
    description: "Geração de código, revisão de PRs e deploys do boilerplate.",
    icon: "dev",
    rag: true,
    docs: 22,
    agents: [
      {
        id: "ag-d1",
        name: "Orq. de Desenvolvimento",
        role: "Setor Orchestrator",
        status: "working",
        rag: true,
        model: "claude-opus-5",
        skills:
          "# Orquestrador de Desenvolvimento\n\n## Responsabilidades\n- Coordenar AI Backend e AI Frontend\n- Delegar tarefas de código e review\n\n## Regras\n- Nunca mergear sem CI verde.\n",
      },
      {
        id: "ag-d2",
        name: "AI Backend",
        role: "Django / Python",
        status: "idle",
        rag: true,
        model: "claude-opus-5",
        skills: "# AI Backend\n\n## Responsabilidades\n- Implementar endpoints REST\n- Escrever migrations e testes\n",
      },
      {
        id: "ag-d3",
        name: "AI Frontend",
        role: "React / TypeScript",
        status: "idle",
        rag: true,
        model: "claude-opus-5",
        skills: "# AI Frontend\n\n## Responsabilidades\n- Gerar componentes React\n- Validar typecheck e lint\n",
      },
    ],
  },
  {
    id: "ops",
    name: "Operações",
    description: "Suporte técnico, monitoramento de infra e SLAs.",
    icon: "ops",
    rag: false,
    docs: 0,
    agents: [
      {
        id: "ag-o1",
        name: "Agente Suporte",
        role: "Helpdesk N1/N2",
        status: "idle",
        rag: false,
        model: "llama-3.3-70b",
        skills: "# Suporte\n\n## Responsabilidades\n- Triagem de tickets\n- Escalonamento para humano quando necessário\n",
      },
    ],
  },
];

export const tasks: Task[] = [
  {
    id: "T-001",
    status: "execucao",
    priority: "alta",
    title: "Implementar endpoint de métricas de agentes",
    sector: "Desenvolvimento",
    agent: "AI Backend",
    project: "pgba-core",
  },
  {
    id: "T-002",
    status: "backlog",
    priority: "media",
    title: "Criar tela de listagem de fornecedores",
    sector: "Compras",
    agent: "Agente Compras",
    project: "pgba-core",
  },
  {
    id: "T-003",
    status: "revisao",
    priority: "alta",
    title: "Revisar conciliação do mês de agosto",
    sector: "Controladoria",
    agent: "Agente Conciliação",
    project: "pgba-core",
  },
  {
    id: "T-004",
    status: "concluido",
    priority: "baixa",
    title: "Atualizar documentação de RAG do setor Comercial",
    sector: "Comercial",
    agent: "Agente CRM",
    project: "pgba-core",
  },
  {
    id: "T-005",
    status: "backlog",
    priority: "alta",
    title: "Configurar política de autonomia para Agente SDR",
    sector: "Comercial",
    agent: "Orquestrador-Geral",
    project: "pgba-core",
  },
  {
    id: "T-006",
    status: "execucao",
    priority: "media",
    title: "Gerar componentes da visão 3D — Fase 2",
    sector: "Desenvolvimento",
    agent: "AI Frontend",
    project: "pgba-core",
  },
];

export const knowledgeDocs: KnowledgeDoc[] = [
  { id: "kd-1", type: "PDF", name: "Playbook Comercial 2025.pdf", sector: "Comercial", size: "2.4 MB", indexed: true },
  { id: "kd-2", type: "Documento", name: "ICP e Persona.docx", sector: "Comercial", size: "480 KB", indexed: true },
  { id: "kd-3", type: "Planilha", name: "Pipeline Q3.xlsx", sector: "Comercial", size: "1.1 MB", indexed: false },
  { id: "kd-4", type: "PDF", name: "Catálogo de Fornecedores.pdf", sector: "Compras", size: "5.2 MB", indexed: true },
  { id: "kd-5", type: "Planilha", name: "Tabela de Preços.xlsx", sector: "Compras", size: "890 KB", indexed: true },
  { id: "kd-6", type: "PDF", name: "CLAUDE.md — Regras do Boilerplate.pdf", sector: "Desenvolvimento", size: "320 KB", indexed: true },
  { id: "kd-7", type: "Documento", name: "Arquitetura de Referência.docx", sector: "Desenvolvimento", size: "740 KB", indexed: true },
  { id: "kd-8", type: "PDF", name: "API.md — Contratos de Endpoints.pdf", sector: "Desenvolvimento", size: "210 KB", indexed: false },
];

export const projectTree: Project[] = [
  {
    id: "motor",
    name: "Motor Principal",
    path: "~/pgba-core",
    state: "ativo",
    kind: "motor",
    updated: "agora",
    children: [
      {
        id: "ws-1",
        name: "workspace",
        path: "~/pgba-core/workspace",
        state: "ativo",
        kind: "grupo",
        updated: "2 h",
        children: [
          { id: "proj-1", name: "site-comercial", path: "~/pgba-core/workspace/site-comercial", state: "ativo", kind: "projeto", sector: "Comercial", updated: "23 h" },
          { id: "proj-2", name: "app-fornecedores", path: "~/pgba-core/workspace/app-fornecedores", state: "rascunho", kind: "projeto", sector: "Compras", updated: "2 d" },
        ],
      },
    ],
  },
];
