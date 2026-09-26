# Marketing — time de conteúdo, redes sociais e vídeo

Empresa → Módulos → **Marketing** (ou o cartão do setor Marketing no organograma).
Backend em `backend_api/Api/marketing/`, telas em `frontend/src/components/empresa/marketing*`.

O problema que isto resolve: publicar **com constância** sem depender de alguém
lembrar. O time de IA planeja, escreve, cria as imagens e corta os vídeos; uma
pessoa aprova (em lote, se quiser) e o agendador publica no horário.

## O time (qualquer ramo)

`python manage.py seed_marketing --tenant <uuid>` ou o botão **Montar time**:

| Agente | Nível | Faz |
|---|---|---|
| Head de Marketing | orquestrador do setor | coordena, revisa a fila, medeia pedidos de outros setores |
| Estrategista de Conteúdo | operacional | calendário: pilares, formatos, datas (`ia.planejar`) |
| Copywriter | operacional | texto de cada post, adaptado a cada rede (`ia.escrever_post`) |
| Designer de Criativos | operacional | texto dos criativos e carrosséis (`ia.texto_criativo`) |
| Editor de Vídeo | operacional | escolhe os trechos dos cortes, escreve roteiro (`ia.escolher_cortes`, `ia.roteiro`) |
| Social Media | operacional | rotina de publicação (skill) |
| Analista de Performance | operacional | o que funcionou (skill; sem métricas inventadas) |

Todos nascem **OBSERVER** e com a skill em `agency/skills/*.md`. O que serve pra
qualquer ramo é o **Perfil da marca** (`PerfilMarca`): ramo, público, tom,
pilares, diferenciais, o que nunca dizer, cores e logo — o briefing que todo
prompt recebe (`services.briefing`). `ramos.py` traz 15 pontos de partida, com o
aviso de publicidade do próprio ramo (CFM, OAB 205/2021, CVM, CDC, CRECI).

Toda chamada de IA: `harness.chat_completion` com a IA do setor
(`resolve_agent_llm`), `extract_json` + `validate_schema`, custo no agente
(`record_interaction`), agente aparece "trabalhando" no Escritório 3D. Saída fora
do formato = erro explícito. Conteúdo de fora (transcrição de vídeo, tema
digitado) entra marcado como `<dado>` e passa por `sanitize_user_input`. O
cérebro do setor (RAG escopado, `_rag_scope_for`) dá os fatos dos seus projetos.

## Publicar: sempre depois de uma pessoa aprovar

```
rascunho ──(IA escreve / pessoa edita)──► revisão ──(pessoa aprova)──► agendada
    agendada + horário chegou (beat a cada 60s) ──► publicando ──► publicada | parcial | erro
```

- `aprovar/` confere tudo antes (`services.conferir`): limite de caracteres de
  cada rede, mídia obrigatória (Instagram: imagem/vídeo; YouTube/TikTok: vídeo),
  `PUBLIC_API_URL` pro Instagram. Não passa = não aprova, com a lista do que falta.
- Editar algo já aprovado volta pra **revisão** (a aprovação vale pro que foi aprovado).
- Cada rede é um `Destino` com texto próprio (vazio = texto base + hashtags + link).
  Uma rede falhar não derruba as outras (`parcial`); "Tentar de novo" só repete as
  que falharam — o que saiu nunca sai duas vezes (`reivindicar` é atômico).
- Nenhuma função de IA publica. `marketing_rascunho_post` (agentes) só cria rascunho.

## As 8 redes

Toda chamada passa por `ingestion.connectors.safe_http` (anti-SSRF). Token e
refresh ficam cifrados (Fernet) em `ContaSocial`; client secret do app em
`AplicativoRede`. OAuth 2.0 com `state` aleatório de uso único e PKCE (X, Google)
guardado só no banco (`OAuthPendente`). Retorno:
`<PUBLIC_API_URL>/api/v1/marketing/oauth/callback/` — **cadastre esse endereço no app de cada rede**.

| Rede | Como conecta | O que publica | O que a rede exige (fora do nosso controle) |
|---|---|---|---|
| Instagram | app Meta (mesmo login do Facebook) | foto, carrossel (2–10), Reels, story | conta profissional ligada a página; App Review da Meta pra uso por terceiros; a Meta **busca a mídia por URL** → `PUBLIC_API_URL` |
| Facebook | app Meta | texto/link, fotos, vídeo na página | página (não perfil) |
| TikTok | app TikTok (Content Posting API) | vídeo | sem auditoria: vai pra caixa de entrada do app (`modo=rascunho`, padrão) ou privado |
| YouTube | app Google (YouTube Data API v3) | vídeo / Short (vertical ≤ 3 min) | app não verificado sobe privado; cota ≈ 6 uploads/dia |
| LinkedIn | app LinkedIn (OpenID + Share on LinkedIn) | texto, fotos, vídeo, link | página de empresa exige Community Management API |
| X | app X (OAuth 2.0) | texto (280), até 4 fotos ou 1 vídeo | plano da API com escrita |
| Discord | webhook do canal (sem app) | texto + arquivos (25 MB) | — |
| Twitch | app Twitch | anúncio no chat do canal | a Twitch não tem feed de posts |

Também dá pra colar um token gerado no portal da rede (sem renovação automática).
Versões: `META_GRAPH_VERSION` (padrão v23.0), `LINKEDIN_API_VERSION` (padrão: 2 meses atrás).

> **Não verificado contra as APIs reais** (sem apps/credenciais nesta sessão): o
> fluxo de cada rede está coberto por testes com a API simulada, seguindo a
> documentação pública. Na primeira conexão real de cada rede, confira o
> resultado de uma publicação de teste.

## Criativos

`criativos.py` (Pillow, sem serviço externo): 4 modelos (destaque, citação,
carrossel, oferta) × 6 formatos (1080², 1080×1350, 1080×1920, 1920×1080,
1200×627, capa 1280×720), com cores e logo da marca, texto que se ajusta à
caixa, fonte Montserrat (OFL, `marketing/fonts/`). A IA só escreve o texto.

## Vídeo

**Cortes de um vídeo longo** (`video.py` + `tasks.processar_cortes_task`):

1. baixa do YouTube/Twitch (`yt-dlp`, só esses hosts, até 3 h, 1080p) ou usa o arquivo enviado;
2. falas: legenda do próprio vídeo (VTT, com a repetição da legenda automática
   removida) ou Whisper (`harness.providers.transcribe`, Groq/OpenAI);
3. o Editor de Vídeo escolhe os trechos; `ia.ajustar_cortes` confere (dentro do
   vídeo, mín/máx, começa e termina em fala, sem sobrepor);
4. `ffmpeg` corta em 1080×1920 (vídeo inteiro com fundo desfocado, ou recorte do
   centro), legenda queimada em blocos curtos + gancho no topo (libass).

A pessoa **confirma que tem direito** sobre o vídeo (próprio ou autorizado) — cortar
conteúdo de terceiros viola direito autoral e os termos do YouTube. yt-dlp muda
junto com o YouTube: mantenha atualizado (e, se o YouTube pedir, instale um
runtime JS como o deno no servidor).

**Vídeo curto com IA — MoneyPrinterTurbo** (MIT, github.com/harry0703/MoneyPrinterTurbo):
roda como serviço à parte (`docker compose --profile marketing up -d moneyprinter`,
config em `docker/moneyprinter/config.toml`, chave grátis do Pexels). O PGBA manda
o roteiro e as palavras-chave prontos (`integrations/moneyprinter.py`: `POST
/api/v1/videos`, acompanha `GET /api/v1/tasks/{id}`, baixa o MP4) — o LLM do
MoneyPrinter não é usado. Nenhum código dele foi copiado. No painel: URL
`http://moneyprinter:8080` + `CONNECTORS_ALLOWED_PRIVATE_HOSTS=moneyprinter`.

## Produção — checklist

- [ ] `PUBLIC_API_URL` (https público do backend) e o endereço de retorno OAuth cadastrado em cada app
- [ ] `ENCRYPTION_KEY` (tokens e segredos)
- [ ] Celery worker + beat rodando (publicação agendada, cortes, vídeo IA)
- [ ] `ffmpeg` no backend (o Dockerfile instala) e disco pro temporário dos cortes (`MEDIA_ROOT/marketing_tmp`, apagado ao fim de cada job)
- [ ] Credencial Groq/OpenAI se for cortar vídeo sem legenda (Whisper)
- [ ] MoneyPrinterTurbo (opcional) com chave do Pexels
- [ ] Rota `/marketing-conectado` servida pelo frontend (SPA fallback)
