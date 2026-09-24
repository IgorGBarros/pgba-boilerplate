# Agency Skills

Cada arquivo `.md` neste diretório é a **skill** de um agente criado por
`seed_company.py`. O conteúdo é o que vai no campo `Agent.instructions`
no banco de dados — usado por `ask_as_agent()` como `agent_instructions`
no prompt do `orchestration`.

## Agentes e seus arquivos

| Agente                          | Arquivo                              | Setor                   | Access Level         |
|---------------------------------|--------------------------------------|-------------------------|----------------------|
| CEO Virtual                     | `ceo-virtual.md`                     | —                       | ceo                  |
| AI Controller                   | `ai-controller.md`                   | —                       | general_orchestrator |
| Orquestrador de Desenvolvimento | `orquestrador-desenvolvimento.md`    | Desenvolvimento         | sector_orchestrator  |
| AI Backend                      | `ai-backend.md`                      | Desenvolvimento         | operational          |
| AI Frontend                     | `ai-frontend.md`                     | Desenvolvimento         | operational          |
| AI Vendedor                     | `ai-vendedor.md`                     | Comercial               | operational          |
| AI Planejador                   | `ai-planejador.md`                   | Operações               | operational          |
| AI Comprador                    | `ai-comprador.md`                    | Compras                 | operational          |
| AI Financeiro                   | `ai-financeiro.md`                   | Financeiro              | operational          |
| AI Controladoria                | `ai-controladoria.md`                | Controladoria           | operational          |
| AI RH                           | `ai-rh.md`                           | RH                      | operational          |
| AI TI                           | `ai-ti.md`                           | TI                      | operational          |
| AI Jurídico                     | `ai-juridico.md`                     | Jurídico                | operational          |
| AI Inteligência de Mercado      | `ai-inteligencia-mercado.md`         | Inteligência de Mercado | operational          |

## Como carregar no banco

Após rodar `seed_company.py`, cole o conteúdo de cada `.md` no campo
`instructions` do agente correspondente via Django admin
(`/admin/agency/agent/`) ou via shell:

```python
from agency.models import Agent
import pathlib

SKILLS_DIR = pathlib.Path("agency/skills")

AGENT_SKILL_MAP = {
    "CEO Virtual":                      "ceo-virtual.md",
    "AI Controller":                    "ai-controller.md",
    "Orquestrador de Desenvolvimento":  "orquestrador-desenvolvimento.md",
    "AI Backend":                       "ai-backend.md",
    "AI Frontend":                      "ai-frontend.md",
    "AI Vendedor":                      "ai-vendedor.md",
    "AI Planejador":                    "ai-planejador.md",
    "AI Comprador":                     "ai-comprador.md",
    "AI Financeiro":                    "ai-financeiro.md",
    "AI Controladoria":                 "ai-controladoria.md",
    "AI RH":                            "ai-rh.md",
    "AI TI":                            "ai-ti.md",
    "AI Jurídico":                      "ai-juridico.md",
    "AI Inteligência de Mercado":       "ai-inteligencia-mercado.md",
}

for name, fname in AGENT_SKILL_MAP.items():
    content = (SKILLS_DIR / fname).read_text()
    updated = Agent.objects.filter(name=name).update(instructions=content)
    print(f"{'OK' if updated else 'NÃO ENCONTRADO'}: {name}")
```

Execute no diretório `backend_api/Api/`:
```bash
python manage.py shell < agency/skills/load_skills.py
# ou cole o bloco acima direto no shell interativo
```

## Formato do frontmatter

O bloco `---` no topo de cada arquivo é documentação — não é processado
automaticamente. Quando carregar no banco, o conteúdo inteiro (incluindo
o frontmatter) vai para `instructions`, e o `orchestration` injeta tudo
no prompt do agente. Se preferir omitir o frontmatter, remova antes de
inserir — o restante já é suficiente para orientar o modelo.

## Adicionando um agente novo

1. Crie o agente no banco (via admin ou `seed_company.py`).
2. Crie o arquivo `<slug>.md` aqui seguindo o mesmo padrão.
3. Carregue no campo `instructions` via shell ou admin.
4. Registre as funções de orchestration relevantes em
   `orchestration/registry.py` (se ainda não existirem).
