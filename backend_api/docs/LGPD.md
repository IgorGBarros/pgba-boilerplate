# LGPD — Conformidade

## Princípio geral

LGPD é tratada como requisito de design, não como camada adicionada
depois. Três mecanismos cobrem a maior parte das obrigações da lei desde
o `core` do boilerplate — o que falta é sempre específico do domínio da
vertical (ex: quais campos exatos são sensíveis no seu caso).

## 1. Mascaramento e criptografia (`core/utils/lgpd.py`)

- `mask_cpf`, `mask_email`, `mask_phone`: mascaramento para **exibição**
  (logs, telas de suporte, exports parciais). Nunca reversível — não use
  para armazenamento, só para mostrar algo como `***.456.***-78`.
- `encrypt_field(value, field_name)` / `decrypt_field(encrypted, field_name)`:
  criptografia simétrica (Fernet, `settings.ENCRYPTION_KEY`) para
  **armazenamento** de dado sensível que precisa ser recuperável (ex: CPF
  que será usado depois numa integração fiscal).
  - Comportamento importante: em `DEBUG=True`, essas funções retornam um
    **hash SHA-256 irreversível** em vez de cifrar de verdade — ou seja,
    dado criptografado em ambiente de desenvolvimento não pode ser
    decifrado nem em dev. Isso é intencional (evita que dado real de
    produção seja restaurado num ambiente de dev com criptografia fraca),
    mas significa que testar o fluxo de decrypt precisa ser feito com
    `DEBUG=False` e uma `ENCRYPTION_KEY` real.

## 2. Consentimento (`core.models.ConsentRecord`)

Modelo multi-tenant que registra a manifestação de vontade do titular,
alinhado ao Art. 8º (consentimento) e Art. 12º (anonimização) da LGPD:

- `purpose_flags`: lista aberta de finalidades (JSON, não enum fixo no
  banco) — cada projeto define as suas. Sugestão de finalidades-base:
  `essential`, `authentication`, `service_delivery`, `legal_compliance`,
  `analytics`, `marketing`, `ai_features`, `ai_training`,
  `data_commercialization` (dado agregado/anonimizado vendido a terceiros).
- `term_version`: versionamento do termo aceito — permite saber
  exatamente qual texto o titular concordou.
- `revoke(purpose=None)`: revoga tudo ou só uma finalidade específica.
- `ip_hash`: SHA-256 do IP + salt (`LGPD_IP_SALT`) — nunca IP em texto puro.
- `ConsentRecord.has_consent_for_purpose(tenant_id, user_ou_email, purpose)`:
  a checagem central. **Toda vertical deve chamar isso antes de usar dado
  do titular para qualquer finalidade além da operação essencial do
  serviço** — por exemplo, antes de incluir os dados de um usuário em
  treino de IA, ou antes de agregar suas vendas num produto de dados
  comercializado a terceiros.

## 3. RAG e dado pessoal (`ingestion`)

`ingestion.Document`/`DocumentChunk` são construídos para conhecimento
institucional (documentação, políticas, notas do Obsidian), não para
dado pessoal de titulares. Duas implicações práticas:

- **Não sincronize notas do Obsidian com PII** (dados de clientes,
  funcionários específicos) a menos que isso seja explicitamente o
  propósito da fonte e o consentimento correspondente exista.
- Notas marcadas `private: true` no frontmatter nunca são indexadas —
  use isso como primeira linha de defesa para qualquer nota que não deva
  virar contexto de IA.

Se o projeto precisar indexar dado pessoal de propósito (ex: um
"assistente" que responde sobre o histórico de um cliente específico),
trate isso como uma vertical própria com seu próprio modelo de
consentimento, não como uma `KnowledgeSource` genérica.

## 4. IA e minimização de dado

`harness.guardrails` reduz um risco específico de LGPD que é fácil de
esquecer: um LLM mal configurado pode "vazar" informação de um contexto
para outro. As garantias aqui:

- `tenant_id` nunca passa pelo LLM (nem como entrada nem como algo que o
  modelo "decide") — ver `orchestration.registry.execute`.
- Toda busca vetorial (`ingestion.semantic_search`) é filtrada por
  `tenant_id` no nível da query, não como um filtro aplicado depois.
- `QueryLog` audita toda pergunta/resposta estruturada — em caso de
  incidente, é possível reconstruir exatamente o que a IA viu e respondeu.

## 5. Direitos do titular — como implementar

A lei garante ao titular acesso, correção, portabilidade e eliminação dos
seus dados (Art. 18). O boilerplate fornece as peças, mas a orquestração
completa de um fluxo de "exportar meus dados" ou "excluir minha conta" é
responsabilidade do projeto, combinando:

- Filtrar por `tenant_id` + identificador do titular em todos os models
  relevantes (mixins garantem que `tenant_id` sempre existe).
- `core.utils.lgpd.export_personal_data(user_id, fields)` já dá o ponto
  de partida do direito de acesso/portabilidade: monta um dict com os
  campos pedidos, mascarando CPF/e-mail/telefone automaticamente. Cobre
  só `CustomUser` — para dado de uma vertical, escreva o equivalente
  seguindo o mesmo padrão (nunca devolver PII sem mascarar, a menos que
  o próprio titular esteja pedindo explicitamente o dado bruto).
- Usar `SoftDeleteMixin.hard_delete()` para os models que precisam de
  remoção física de fato no atendimento a um pedido de eliminação —
  soft delete sozinho não cumpre o direito ao apagamento.
- Revogar os `ConsentRecord` associados (`revoke()`).
- Se o titular tiver documentos indexados em `ingestion` (caso de uso
  explícito de PII, ver seção 3), remover os `Document`/`DocumentChunk`
  correspondentes — a exclusão do `Document` já cascade-deleta os chunks.

## 6. O que NÃO está incluso e precisa de decisão do projeto

- Base legal específica por finalidade (o boilerplate registra o
  consentimento, mas não decide se a finalidade X precisa de
  consentimento explícito ou se outra base legal do Art. 7º se aplica).
- Política de retenção de dado (por quanto tempo manter cada tipo de
  registro) — configure rotinas de expurgo por projeto.
- Nomeação de DPO (Encarregado) e canal de atendimento a titulares —
  processo organizacional, não código.
- Relatório de Impacto à Proteção de Dados (RIPD), quando exigido.
