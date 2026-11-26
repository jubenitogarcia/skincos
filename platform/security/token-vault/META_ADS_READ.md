# Token Vault — leituras históricas do Meta Ads (`meta_ads_read_v1`)

Leituras **somente Graph `GET`** acrescentadas ao gateway
`/v1/meta-ads-publish`. Fonte: [`src/meta-ads-read.js`](src/meta-ads-read.js),
ligado a `src/meta-ads-publish.js` por injeção. Testes:
[`tests/meta-ads-read.test.js`](tests/meta-ads-read.test.js).

Este documento tem duas partes: o contrato das leituras e a **análise de
impacto** para decidir como (e se) promover.

## 1. Contrato

Todas as leituras entram pelo mesmo endpoint das demais ações:
`POST /v1/meta-ads-publish/runs/:run_id/operations`, com o mesmo bearer
operacional (`TOKEN_VAULT_N8N_API_TOKEN`), a mesma allowlist de conta
(`account_id` precisa ser o da metadata do `token_id`), o mesmo journal
(`meta_ads_publish_operations`), a mesma auditoria
(`meta_ads_publish.<action>`) e o mesmo `graphRequest` (timeout, até 3
tentativas, registro de `rate_usage`). Nenhuma delas está em
`MUTATING_ACTIONS`.

O gateway anuncia a capacidade em `GET /v1/meta-ads-publish/config`, na chave
nova `capabilities.read_only` (`revision: "meta_ads_read_v1"`). Um cliente só
deve usar os parâmetros abaixo depois de ver essa chave: um Worker antigo
ignora parâmetros desconhecidos e responde no formato antigo.

Cada operação lê **uma página** da Graph. Havendo mais dados, a resposta traz
`paging: { has_next: true, after: "<cursor opaco>" }` e o chamador repete a
operação (com outra `operation_key`) enviando `after`. URLs de paginação da
Graph nunca saem do Worker.

### `get_insights` (ação nova)

| Parâmetro | Valores |
|---|---|
| `level` (obrigatório) | `account`, `campaign`, `adset`, `ad` |
| `period` | `lifetime` (padrão) ou `monthly` (`time_increment=monthly`) |
| `since` + `until` | `AAAA-MM-DD`, os dois juntos, até 37 meses; sem eles usa `date_preset=maximum` |
| `object_ids` | até 50 IDs numéricos do nível pedido (não vale para `account`) |
| `effective_status` | lista da allowlist de status (não vale para `account`); necessário para incluir `ARCHIVED`/`DELETED` |
| `breakdowns` | até 2 de `publisher_platform`, `platform_position`, `impression_device`, `device_platform` |
| `limit` | 1–200 (padrão 100) |
| `after` | cursor devolvido pela página anterior |

A consulta é sempre `act_<conta configurada>/insights`; os IDs só filtram
dentro da conta. Campos pedidos à Graph (lista fechada): identificação do
nível, `spend`, `impressions`, `reach`, `clicks`, `ctr`, `cpc`, `cpm`,
`frequency`, `inline_link_clicks`, `actions`, `cost_per_action_type`. A
resposta devolve números já convertidos e `actions`/`cost_per_action_type`
resumidos como `{ "<action_type>": <valor> }` (até 60 tipos, sem janelas de
atribuição). Não há recorte por idade, gênero, país, região ou qualquer dado
por pessoa, e a allowlist não pode ser ampliada pelo chamador.

### `list_ads` com filtro e paginação (opt-in)

Sem parâmetros novos, `list_ads` continua igual (até 2.000 anúncios, sem
filtro). Com qualquer um de `effective_status` (lista da allowlist, incluindo
`ARCHIVED` e `DELETED`), `limit` (1–200, padrão 100) ou `after`, a ação passa
ao modo paginado: uma página por operação, mesmos campos do inventário, mais
`paging` e `truncated`.

### `get_campaign` / `get_adset` com `view: "history"` (opt-in)

Sem `view`, as duas ações continuam iguais. Com `view: "history"`:

- campanha: `created_time`, `updated_time`, `start_time`, `stop_time`,
  `daily_budget`, `lifetime_budget`, `budget_remaining`, `spend_cap`,
  `bid_strategy`, `status`, `configured_status`, `effective_status`, além dos
  campos atuais;
- conjunto: `created_time`, `updated_time`, `start_time`, `end_time`,
  `daily_budget`, `lifetime_budget`, `budget_remaining`, estado e otimização —
  **sem** `targeting` e **sem** `promoted_object`.

O objeto só é devolvido se o `account_id` lido for o da conta configurada;
caso contrário a operação falha com `object_not_in_authorized_account` (403).
Orçamentos vêm na menor unidade da moeda (centavos), como na Graph.

## 2. Análise de impacto

Levantamento de 26/11/2026. Classificação ao final.

### 2.1 Como o Worker é versionado e promovido hoje

- Um único Worker, `skincos-token-vault`, na rota
  `api.skincos.com.br/internal/token-vault/*`, com um banco D1; staging é o
  ambiente `env.staging` do mesmo `wrangler.toml`.
- O caminho escrito no repositório é `.github/workflows/deploy-token-vault.yml`
  (Preview → Staging → Production, `workflow_dispatch` com um SHA da `main`,
  gate de promoção, lease, bookmark do D1, upload de versão imutável e
  readback).
- Histórico real desse workflow: 74 execuções, todas entre 14 e 20/08/2026.
  As 36 bem-sucedidas são só de Preview. **Nenhum job `release` (staging ou
  produção) terminou com sucesso**; a última tentativa de staging falhou no
  passo "Seal the isolated staging Meta Ads synthetic seed on the immutable
  candidate".
- A documentação operacional do Orb registra que o GitHub Actions deixou de
  ser executor autorizado e que a rota independente que o substitui ainda não
  foi validada ("não promova o Token Vault até a rota e os controles estarem
  validados").
- Conclusão: **hoje não existe caminho de promoção governado e validado até
  produção** para este Worker.

### 2.2 O que está em produção não é a `main`

- A `main` declara `WORKFLOW_CONTRACT_REVISION =
  meta_destination_contract_v20_tracking_reconciliation` desde 13/08/2026
  (#1415). São 26 commits do gateway depois da versão v18.
- Produção responde **v18** (`meta_destination_contract_v18_live_campaign_cta`):
  a última execução do Meta Ads – Publish (24/11/2026, sucesso) recebeu de
  `GET /config` exatamente essa revisão, sem `capabilities.tracking`, e o nó
  "Build Meta API Params From Vault" publicado no n8n confere v18.
- Portanto o v20 nunca chegou à produção, e as migrations `0003`–`0006` e o
  bootstrap da autoridade de configuração também não.

### 2.3 Consumidores do Worker

| Consumidor | Estado | Rotas |
|---|---|---|
| n8n "Meta Ads – Publish" | inativo, execução manual | `/v1/meta-ads-publish/config`, `/inventory`, `/runs`, `/runs/:id/...` |
| n8n "Token Manager" | ativo | `/v1/token-metadata`, `/v1/tokens/:id` |
| n8n "Livia" | ativo | `/v1/social-publish/operations`, `/v1/token-metadata` |
| Scripts do Orb | sob demanda | preflights da Livia, leitura do contrato de conversão, cliente do controle MCP, exportação do histórico |
| Influencer Intelligence | staging (shadow) | `/v1/analytics/operations` |

O Meta Ads – Publish tem ainda três nós desligados que apontam para
`/v1/meta-ads-objective-routes/*`, rotas que não existem no Worker. Não foi
encontrado consumidor direto do Token Vault no código do CRM além do módulo
Influencer Intelligence.

Todos compartilham o mesmo Worker: **qualquer deploy troca o código de todos
ao mesmo tempo**. É esse o raio de impacto, não o tamanho do diff.

### 2.4 Efeito desta mudança, isolada

| Pergunta | Resposta |
|---|---|
| `WORKFLOW_CONTRACT_REVISION` muda? | Não. |
| A capacidade em `GET /config` muda? | Ganha a chave `capabilities.read_only`. As chaves existentes ficam idênticas. |
| O nó do Orb falha fechado? | Não. Ele compara a revisão e confere chaves específicas (`video_upload`, `tracking`); não exige igualdade do objeto inteiro. Vale para o nó publicado (v18) e para o do repositório (v20). |
| Ações existentes mudam? | Não. Sem os parâmetros novos o pedido não entra no módulo; `/inventory` chama `listAds` direto e não passa pelo desvio. Há teste fixando as três requisições antigas. |
| Migration? | Nenhuma. Usa só `meta_ads_publish_operations` e `meta_ads_publish_locks`, que existem desde a `0002`. |
| Binding, secret ou rota nova? | Nenhum. |
| Escrita na Meta? | Nenhuma; só `GET`. |

Riscos próprios das leituras, com mitigação:

- **Cota da Graph compartilhada com o Publish.** Insights consomem a cota da
  conta de anúncios. Mitigação: uma página por operação, limite de 200 linhas,
  `rate_usage` gravado por operação (com `pause_recommended` a partir de 95%),
  cadência no cliente e não exportar durante uma publicação.
- **Crescimento do journal.** Cada operação grava o resultado (até 1 MB) no
  D1. Uma exportação completa são dezenas de operações, poucos MB.
- **Conteúdo do journal.** Passa a conter gasto e nomes de campanha/anúncio da
  própria conta; nada demográfico, nenhum token.

### 2.5 Onde está o risco de derrubar serviço

**Promover a `main` (com ou sem este PR) para produção derruba o Meta Ads –
Publish**, porque leva junto o salto v18 → v20:

1. `GET /config` passa a anunciar v20; o nó publicado espera v18 e falha
   fechado em toda execução.
2. O v20 exige autoridade de configuração `tracking_ready` e as migrations
   `0003`–`0006`; antes do bootstrap `GET /config` responde 409 e
   `POST /runs` recusa pedidos sem `tracking_binding_revision`.
3. O contrato v20 exige atualizar em conjunto os três nós do workflow, a
   definição canônica, o checkpoint e o preflight.

Livia e Token Manager usam rotas que os testes de compatibilidade cobrem, mas
entram no mesmo deploy e nunca foram validados em staging nessa versão.

### 2.6 Janela de indisponibilidade

Um deploy de Worker é atômico: a versão nova assume em segundos e os pedidos
em andamento terminam na versão anterior. Não há janela de indisponibilidade
nem alteração no D1 para esta mudança. O risco é funcional (contrato), não de
tempo fora do ar.

### 2.7 Caminhos de promoção

**A. Aditivo sobre o que está em produção (recomendado).** Branch
`codex/token-vault-meta-ads-leitura-v18`: o mesmo `src/meta-ads-read.js` e os
mesmos quatro pontos de ligação aplicados sobre a linha v18. Mantém v18, não
toca D1 e não exige mudança no Orb.

O branch já existe e foi construído sobre o último commit em que o gateway
ainda declara v18 (o pai de #1415). Nessa base, os testes do gateway passam
com o módulo aplicado (`meta-ads-read` 11/11, `meta-ads-publish` 26/26,
`index` 11/11, `social-publish` 6/6, `compat-entry` 3/3). **Não está
comprovado que a versão ativa do Worker corresponde a essa base**: a linha v18
vai de 28/07 a 13/08/2026 e a versão implantada não pôde ser lida deste host.
Por isso o passo 1 abaixo é obrigatório.

1. Registrar a versão ativa do Worker (ID da versão/deployment) e confirmar
   que o código em produção corresponde à base do branch. Se não corresponder,
   reaplicar o patch sobre a base correta; não promover.
2. Rodar `node --test tests/meta-ads-read.test.js` e a suíte do gateway na
   base.
3. Subir uma **versão** sem tráfego (`wrangler versions upload`, preservando
   bindings e variáveis) e conferir pela URL de preview da versão:
   `GET /config` com v18, as mesmas chaves de antes e `read_only` presente.
4. Direcionar 100% para a versão nova.
5. Aceite: `GET /config` na rota canônica; preflight do Meta Ads – Publish
   verde; preflight de token da Livia; uma leitura `get_insights` de nível
   `account` num run de diagnóstico.

Falta para executar: uma credencial Cloudflare com permissão de editar o
Worker, um executor autorizado (o governado não está validado; é decisão do
dono abrir essa exceção) e a confirmação da base do passo 1.

**B. Pela `main`, junto com o v20.** Só quando a promoção v20 estiver
validada de ponta a ponta (staging com fixture, Orb aplicado inativo na
mesma janela, preflight). Este PR passa a fazer parte dessa promoção sem
custo adicional. Não está disponível hoje.

### 2.8 Rollback

- Worker: voltar para a versão anotada no passo 1 (`wrangler rollback
  <versão>`), efeito em segundos. Não há D1, secret ou rota para desfazer.
- Clientes: quem usa as leituras confere `capabilities.read_only` antes; sem a
  chave, o exportador volta sozinho ao modo antigo.
- Linhas já gravadas no journal por leituras novas são inertes para a versão
  anterior (ela só as lê por `operation_key`).

### 2.9 Classificação

- Mudança de código: **PASS** — aditiva, sem alteração de contrato, de
  migration ou de comportamento das ações existentes.
- Promoção: **risco identificado, com mitigação** — não promover a `main`
  para produção por causa deste PR; usar o caminho A, ou aguardar o B.
