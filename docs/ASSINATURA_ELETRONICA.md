# Assinatura eletrônica — o que existe, o que vale e como evoluir

## Base legal (Brasil)

| Lei | O que diz |
|---|---|
| MP 2.200-2/2001, art. 10, § 2º | Documento assinado por **qualquer meio de comprovação de autoria e integridade aceito pelas partes** é válido entre elas — é o que dá validade às plataformas tipo DocuSign/Clicksign entre particulares. |
| Lei 14.063/2020 | Três níveis: **simples** (identifica quem assina), **avançada** (vinculada ao signatário de forma única, com controle exclusivo dele e detecção de alteração) e **qualificada** (certificado ICP-Brasil). |
| CPC art. 411, II | Documento é autêntico quando a autoria é identificada por meio legal de certificação, inclusive eletrônico. |

Na prática: **contratos entre empresas e com clientes/fornecedores podem ser assinados em plataforma eletrônica**. Exigem ICP-Brasil (qualificada) alguns atos específicos — por exemplo, certos registros em cartório/junta e documentos que a própria lei ou o órgão receptor exija com certificado digital. Na dúvida sobre um documento, consulte quem vai recebê-lo.

## O que o sistema já faz (provedor "interno")

`backend_api/Api/juridico/assinatura.py` — assinatura eletrônica **simples/avançada**, sem custo por documento:

1. O documento (PDF enviado ou gerado de modelo) é **congelado** em PDF e recebe um **SHA-256**.
2. Cada signatário recebe um **link pessoal** (token aleatório de 256 bits; no banco fica só o hash + uma cópia cifrada pra reenviar).
3. Para assinar: nome digitado igual ao do convite, **CPF** (se o remetente informou), **código de 6 dígitos por e-mail** (opcional, recomendado — prova acesso à caixa), aceite expresso. Guarda **data/hora, IP e navegador**.
4. Ordem de assinatura opcional; prazo de validade; recusa com motivo.
5. **Trilha de auditoria encadeada por hash**: cada evento guarda o hash do anterior — alterar ou apagar um evento quebra a corrente (`trilha_integra`).
6. Ao final, **PDF assinado = original + "manifesto de assinaturas"** (hash do original, quem, quando, como, IP, trilha) e SHA-256 da via final.
7. **Verificação pública** em `/verificar`: qualquer pessoa envia o PDF e confere se é autêntico (mesmo hash) e quem assinou.

Para o código por e-mail funcionar, a **caixa de e-mail do setor Jurídico** (ou a padrão da empresa) precisa estar configurada em Painel administrativo → E-mails. Sem ela, o sistema gera os links pra você mandar por outro canal (e a assinatura fica sem a prova do e-mail — registrado no manifesto).

## E o gov.br?

- A **API de assinatura gov.br** (ITI) é oferecida para **órgãos e entidades da administração pública** que aderem ao serviço — empresa privada não consegue integrar direto.
- Mas **qualquer pessoa** com conta gov.br prata/ouro pode assinar um PDF de graça em **assinador.iti.br** (assinatura avançada). Fluxo possível hoje: baixe o PDF em Jurídico → Documentos, a pessoa assina no gov.br e você envia o PDF assinado de volta como nova versão. A validade pode ser conferida em **validar.iti.gov.br**. O sistema não valida essa assinatura sozinho (ainda).

## Provedores externos (quando precisar de mais)

| Provedor | Tipo | Destaque | Custo |
|---|---|---|---|
| **DocuSign** | SaaS global | referência de mercado, API madura | pago |
| **Clicksign** | SaaS brasileiro | muito usado no Brasil, API e webhooks, suporte a ICP-Brasil | pago (tem sandbox) |
| **ZapSign** | SaaS brasileiro | simples, bom custo, API, assinatura por WhatsApp | pago (tem sandbox) |
| **D4Sign** | SaaS brasileiro | foco jurídico/compliance, ICP-Brasil | pago |
| **Autentique** | SaaS brasileiro | API GraphQL, costuma ter plano gratuito limitado | confirmar plano |
| **DocuSeal** | código aberto (AGPL) | alternativa ao DocuSign que roda na sua VPS (ex.: Oracle grátis) | grátis self-hosted |
| **Documenso** | código aberto (AGPL) | idem, com assinatura por certificado | grátis self-hosted |

Recomendação: **comece com o provedor interno** (já pronto, sem custo) para contratos com clientes e fornecedores. Se precisar de ICP-Brasil ou de uma marca reconhecida pelo outro lado, integre **Clicksign ou ZapSign** (brasileiros, com sandbox pra testar). Se quiser algo externo e gratuito, **DocuSeal** na VPS da Oracle.

A integração externa entra no mesmo modelo: `SolicitacaoAssinatura.provedor` / `provedor_ref` já existem. Falta só o adaptador do provedor escolhido — para não inventar endpoint, ele deve ser escrito com a documentação e uma chave de sandbox do provedor em mãos.
