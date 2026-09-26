# Setor de TI — observabilidade e helpdesk

Empresa → Módulos → **TI · Helpdesk** (ou o cartão do setor TI no organograma).
Backend: `observabilidade/` (medir, verificar, incidentes) + `helpdesk/` (time de
TI, chamados, IA). Página pública: **`/status`**.

## O que responde "por que o sistema caiu?"

```
toda requisição /api/  ─┐
toda chamada de IA      ├─► métricas por minuto (Metrica: api | ia | http)
toda saída HTTP externa ┘
todo ERROR do log  ─────► EventoErro (agrupado, PII mascarada)

a cada minuto (Celery beat → verificar_task):
   plataforma: banco · Redis · workers · agendador · disco · config · erros · API 5xx
   cada empresa: IA de cada setor · conectores · MCP · e-mails · redes sociais · agentes
        │
        ▼
   EstadoComponente (+ Amostra = histórico de 7 dias)
        │ falhou 2x seguidas
        ▼
   Incidente ──sinal──► helpdesk: abre chamado (Task do DBA/SRE/Integrações)
        │                          └─► IA escreve o diagnóstico com fatos [F#]
        │ voltou ao normal
        ▼
   Incidente resolvido ──► chamado "aguardando": uma pessoa confirma e resolve
```

### Banco fora do ar

Com o Postgres fora, nada pode ser gravado nele. A verificação do banco explica
a causa em português (`observabilidade/banco.py#explicar`: conexão recusada,
host não resolve, senha, banco inexistente, conexões esgotadas, disco cheio,
em recuperação, timeout, SSL) e a queda fica **anotada no Redis**
(`pgba:obs:queda_banco`, com início, erro e causa). Quando o banco volta, o
incidente é gravado com o horário real do início e o time de TI recebe o
chamado com o diagnóstico (pós-mortem). A página `/status` e
`GET /api/v1/observabilidade/saude/` testam na hora — funcionam com o banco fora.

No terminal, sem precisar da tela:

```bash
python manage.py diagnostico
```

## Time de TI (`helpdesk/equipe.py`)

| Agente | Cuida de |
|---|---|
| Head de TI (orquestrador) | distribui, acompanha SLA, revisa diagnóstico |
| SRE / Observabilidade | fila, workers, agendador, disco, API com 5xx |
| DBA | banco: conexão, senha, disco, conexões, locks, migrações |
| Analista de Suporte | atende pessoas de todos os setores |
| Analista de Integrações | APIs, conectores, MCP, IA dos setores, redes, e-mail |
| Segurança da Informação | acesso, credencial exposta, LGPD |

Montar: botão **Montar time de TI** (aba Time), `POST /api/v1/helpdesk/equipe/`
ou `python manage.py seed_ti --tenant <uuid>`. Skills em `agency/skills/`.
Todo agente nasce **observador**: diagnostica e sugere, nunca executa comando
em servidor nem responde sem uma pessoa.

## Chamados = Tasks

- Abrir chamado (tela, `POST helpdesk/tickets/`, a função de IA
  `ti_abrir_chamado` pra agente de qualquer setor, ou incidente) → atribui o
  agente pela categoria (banco → DBA, sistema/rede → SRE, integração/IA →
  Integrações, acesso → Segurança, resto → Suporte) e cria uma
  `agency.Task` (`task_type="chamado"`). SLA: crítica 4h, alta 8h, média 24h,
  baixa 72h (`prazo_sla`).
- **Atender com IA** (`atender-ia/`): o agente lê o chamado + o estado do sistema
  (fatos `[F#]`) e sugere resposta, passos e perguntas. É rascunho: nada é enviado.
- **Responder** (pessoa) marca a 1ª resposta; **Resolver** exige a solução e
  **aprova a Task**. Aprovar/rejeitar a Task no quadro de tarefas também move o
  chamado (resolvido / volta pra fila). Reabrir cria uma Task nova.

## IA sem alucinação

Os fatos são montados em Python (`helpdesk/fatos.py`) e numerados; a IA só
redige e cita `[F#]`. Citação a fato inexistente é removida e devolvida em
`citacoes_invalidas`. Isolamento: fatos de uma empresa só vêm dela + da
plataforma; mensagem de erro do log não entra (só logger, origem, tipo,
contagem); incidente da plataforma vai pro chamado de todas as empresas com
time de TI **sem** detalhe técnico (IP interno mascarado, `detalhe` só pra
equipe da plataforma).

## Quem vê o quê

| | Empresa | Equipe da plataforma (`is_staff`) |
|---|---|---|
| Componentes da empresa | tudo | tudo |
| Componentes da plataforma | nome, estado, causa, ação | + detalhe técnico e dados |
| Métricas de API e IA | só as dela | todas |
| Saídas HTTP por host | — | sim |
| Erros do log | — | sim |

## Endpoints

`/api/v1/observabilidade/`: `saude/` (público, throttle `status_publico`),
`painel/`, `verificar/` (POST), `incidentes/`, `incidentes/<id>/` (GET com
amostras; POST = "estou olhando"), `metricas/?tipo=api|ia|http&horas=`, `erros/`.

`/api/v1/helpdesk/`: `tickets/` (+ `interacoes/`, `atender-ia/`, `responder/`,
`comentar/`, `resolver/`, `reabrir/`, `fechar/`, `atribuir/`, `prioridade/`),
`painel/`, `equipe/`, `agentes/?horas=` (observabilidade de todos os agentes),
`incidentes/<id>/diagnosticar/`, `equipamentos/`.

## Adicionar uma verificação

Quem conhece o assunto registra (a observabilidade não sabe o que é setor):

```python
from observabilidade.registro import Resultado, registrar_verificacao

@registrar_verificacao("minha_integracao", intervalo=300)
def verificar(tenant_id) -> list[Resultado]:
    return [Resultado("minha.chave", "conector", "Minha integração", "ok", "respondeu")]
```

Importe o módulo no `apps.py.ready()` da vertical (ex.: `marketing/verificacoes.py`).

## Produção

Precisa do **Celery beat** (serviço `celery_beat` do docker-compose) — sem ele,
nada é verificado sozinho e o próprio agendador aparece "sem batimento".
Métricas ficam 30 dias; amostras, 7 dias.
