// Tipos locais de display (subset dos tipos de api.ts adaptados para UI).
// Não contém mais dados mock — os componentes buscam via api.ts.

export type AgentStatus = "working" | "idle" | "paused";
export type DocType = "PDF" | "Documento" | "Imagem" | "Planilha";

export type Project = {
  id: string;
  name: string;
  path: string;
  kind: "motor" | "template" | "projeto";
  state: "ativo" | "rascunho" | "arquivado";
  sector: string;
  updated: string;
  children?: Project[];
};

export const projectTree: Project[] = [
  {
    id: "motor",
    name: "Motor Principal",
    path: "/pgba-boilerplate",
    kind: "motor",
    state: "ativo",
    sector: "Desenvolvimento",
    updated: "hoje",
    children: [
      {
        id: "template-ws",
        name: "Template Workspace",
        path: "/pgba-boilerplate/template",
        kind: "template",
        state: "ativo",
        sector: "Desenvolvimento",
        updated: "ontem",
        children: [
          {
            id: "proj-crm",
            name: "CRM Cliente A",
            path: "/projects/crm-cliente-a",
            kind: "projeto",
            state: "ativo",
            sector: "Comercial",
            updated: "há 2 dias",
          },
          {
            id: "proj-juridico",
            name: "Jurídico Cliente B",
            path: "/projects/juridico-cliente-b",
            kind: "projeto",
            state: "rascunho",
            sector: "Jurídico",
            updated: "há 5 dias",
          },
        ],
      },
      {
        id: "proj-saude",
        name: "Saúde Cliente C",
        path: "/projects/saude-cliente-c",
        kind: "projeto",
        state: "arquivado",
        sector: "Saúde",
        updated: "há 30 dias",
      },
    ],
  },
];

export const aiModels: string[] = [
  "gpt-6-astra",
  "claude-opus-5",
  "gemini-2.5-pro",
  "kimi-k2",
  "llama-3.3-70b",
  "mistral-large",
  "ollama/llama3",
];
