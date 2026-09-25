# Templates do Vault Obsidian — Base de Conhecimento do Agente Comercial

Estes arquivos são a base de conhecimento que o **agente comercial de IA** usa para responder leads via WhatsApp/Telegram sem inventar preços ou prazos.

## Como usar

### 1. Copiar para o vault

Copie a pasta `Servicos/` inteira para dentro do seu vault Obsidian:

```
C:\Users\ig0r_\Documents\.pgba\obsidian-vault\Servicos\
```

A estrutura deve ficar assim no vault:
```
Servicos/
├── tabela-de-precos.md       ← MAIS IMPORTANTE: sempre mantenha atualizado
├── crm-comercial.md
├── sistema-gestao-estoque.md
├── plataforma-saas.md
├── landing-page-site.md
└── app-mobile.md
```

### 2. Configurar o KnowledgeSource no sistema

No painel do PGBA, em **Ingestão → Fontes de Conhecimento**, crie ou edite uma fonte do tipo Obsidian apontando para o seu vault. Se ainda não existe:

1. Acesse `/admin/ingestion/knowledgesource/`
2. Crie uma nova fonte:
   - Tipo: `obsidian`
   - Nome: `Base Comercial`
   - `vault_path`: caminho do vault (ex: `C:\Users\ig0r_\Documents\.pgba\obsidian-vault`)
   - `include_tags`: deixe vazio para indexar tudo, ou use `#comercial` para filtrar só as notas marcadas
3. Salve

### 3. Sincronizar (indexar os documentos)

Dentro do container Docker:

```bash
docker compose exec backend python manage.py sync_obsidian --source-id <ID_DA_FONTE>
```

Ou pelo Django admin: **Ingestão → Fontes de Conhecimento → selecionar a fonte → ação "Sincronizar"**.

Rode este comando sempre que adicionar ou editar notas no vault.

### 4. Verificar se funcionou

Acesse um lead no CRM e envie uma mensagem. O agente deve apresentar preços e prazos diretamente — sem pedir que o lead informe o orçamento.

---

## Personalizando os valores

Edite `tabela-de-precos.md` com os valores reais da sua empresa antes de sincronizar. Os arquivos de serviço individuais têm mais detalhe sobre cada produto — mantenha-os atualizados conforme o portfólio evolui.

**Adicionar um novo serviço**: crie um novo arquivo `.md` em `Servicos/` seguindo o mesmo padrão dos existentes, e rode o sync novamente.

---

## Boas práticas

- Nunca coloque `private: true` no frontmatter de notas que o agente deve usar
- Valores e prazos no `tabela-de-precos.md` têm prioridade — é o que o agente cita primeiro
- Mantenha os arquivos em português; o agente responde sempre em pt-BR
