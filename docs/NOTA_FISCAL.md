# Emissão de nota fiscal: dá pra fazer? O que precisa?

**Dá, sim.** Hoje o ERP deste boilerplate já **monta** a nota, mas ainda
**não transmite**: falta ligar um emissor. Este documento diz o que já existe,
o que falta e qual caminho seguir.

> Regras fiscais mudam por município e por regime tributário, e 2026 é o
> ano de transição da Reforma Tributária. Confirme os detalhes com o contador
> da empresa antes de emitir em produção.

## 1. O que já está pronto

| Peça | Onde | O que faz |
|---|---|---|
| Dados da empresa emitente | `erp.DadosEmpresa`, `GET/PUT /api/v1/erp/empresa/` | CNPJ, inscrições, regime tributário, endereço, código IBGE, código de serviço e alíquota de ISS padrão, série |
| Tomador (cliente) | `erp.ParceiroNegocio` | CPF/CNPJ, IE/IM, endereço completo e código IBGE do município |
| Item de serviço | `erp.ItemEstoque` com `tipo_item="servico"` | código do serviço da LC 116 (`codigo_servico`) e preço |
| Item de material | `erp.ItemEstoque` com `tipo_item="material"` | NCM (exigido na NF-e) |
| Nota em rascunho | `POST /api/v1/erp/contratos/{id}/gerar-nota-fiscal/` | monta a NFS-e do contrato (ou de uma fatura dele): tomador, valor, discriminação, código de serviço, ISS. Fica `status="rascunho"` |
| O que falta | `GET /api/v1/erp/fiscal/prontidao/` (ERP → Fiscal) | confere o banco e lista cada requisito que falta; nunca chama serviço externo |

## 2. O que falta pra emitir de verdade

### Fora do sistema (a empresa providencia)

1. **Certificado digital A1 (e-CNPJ)**, arquivo `.pfx` com senha, válido por
   1 ano. O A3 (token/cartão) não serve pra servidor: precisa de alguém
   plugando o token.
2. **Habilitação pra emitir**:
   - **NFS-e (serviço)**: adesão ao **Emissor Nacional da NFS-e** (padrão
     nacional, gov.br/nfse) ou credenciamento no sistema próprio da
     prefeitura, se o município ainda usar um. Com a Reforma Tributária
     (LC 214/2025), o padrão nacional virou o caminho de referência.
     Confirme como está o seu município.
   - **NF-e (produto, modelo 55)**: credenciamento na **SEFAZ do estado**
     e inscrição estadual.
3. **Dados tributários com o contador**: regime (MEI/Simples/Presumido/Real),
   código de tributação de cada serviço (item da LC 116 e o código nacional),
   alíquota de ISS e retenções. Na NF-e, CFOP, CST/CSOSN e ICMS de cada
   produto. Em 2026 a nota também passa a destacar **IBS/CBS** (fase de teste
   da Reforma).

### Dentro do sistema (desenvolvimento)

4. **Integração com um emissor.** É o item "Integração com o emissor" da
   prontidão, sempre pendente até isso existir.
5. **Ciclo de vida da nota**: `rascunho → pendente (enviada) → autorizada |
   rejeitada`, cancelamento (dentro do prazo do município ou da SEFAZ) e
   carta de correção na NF-e.
6. **Guarda do XML autorizado por 5 anos**, e o PDF (DANFSe/DANFE) pra
   mandar ao cliente.
7. **Ambiente de homologação** pra testar sem valor fiscal antes de ligar a
   produção.

## 3. Dois caminhos de integração

| | A. Direto no governo | B. Provedor de API (**recomendado**) |
|---|---|---|
| Como | Emissor Nacional (DPS em XML assinado, mTLS com o certificado) e webservices SOAP da SEFAZ pra NF-e | REST/JSON de um provedor (ex.: Focus NFe, NFE.io, PlugNotas, Nuvem Fiscal, eNotas) que assina, transmite, devolve XML/PDF e avisa por webhook |
| Esforço | alto: assinatura XMLDSig, schemas por versão, contingência, cada prefeitura fora do padrão nacional é um caso | baixo: um cliente HTTP e um webhook |
| Custo | sem mensalidade, com muito mais manutenção | cobrança por nota ou por mês |
| Municípios fora do padrão nacional | um trabalho de integração por prefeitura | o provedor cobre |

**Recomendação:** o caminho B, no mesmo padrão do app `integrations` que já
existe pro GitHub:

- credencial do provedor em `integrations.ServiceCredential` (criptografada,
  por tenant, configurável por `configure_service_credential`, nunca no código);
- `integrations/nfse.py` com o cliente httpx (`emitir`, `consultar`, `cancelar`);
- task Celery que envia o rascunho, passa a nota a `pendente` e grava o
  `chave_acesso` e o número quando o webhook do provedor responder `autorizada`;
- o certificado A1 vai pro provedor (upload no painel ou na API dele); o
  boilerplate não guarda o `.pfx`.

## 4. Contrato com material

A nota de um contrato de serviço é uma **NFS-e**. Se o contrato também
**vende material**, o material costuma precisar de **NF-e** separada (ICMS),
exceto quando o material é aplicado no próprio serviço e a lei municipal
permite incluí-lo na NFS-e (ex.: construção civil, item 7.02 da LC 116).
Hoje o rascunho gerado é sempre NFS-e com o valor da fatura. Decidir
NFS-e + NF-e pro material é regra de negócio a confirmar com o contador
antes de ligar a transmissão.
