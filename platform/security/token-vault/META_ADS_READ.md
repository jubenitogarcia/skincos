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
(`meta_ads_publish.<action>`) e o mesmo `graphRequest` (timeout e registro de
`rate_usage`). Nenhuma delas está em `MUTATING_ACTIONS`.

O gateway anuncia a capacidade em `GET /v1/meta-ads-publish/config`, na chave
nova `capabilities.read_only` (`revision: "meta_ads_read_v1"`). Um cliente só
deve usar os parâmetros abaixo depois de ver essa chave: um Worker antigo
ignora parâmetros desconhecidos e responde no formato antigo.

Cada operação lê **uma página** da Graph. Havendo mais dados, a resposta traz
`paging: { has_next: true, after: "<cursor opaco>" }` e o chamador repete a
operação (com outra `operation_key`) enviando `after`. URLs de paginação da
Graph nunca saem do Worker.

### Proteções de cota (valem para todas as leituras deste módulo)

- **Uma chamada à Graph por operação.** O gateway não repete leitura: timeout,
  erro de rede, 5xx ou limite de chamadas voltam ao chamador na primeira
  falha. O cliente também não deve repetir às cegas.
- **Recusa durante publicação.** Se a conta teve um `POST` de publicação nos
  últimos segundos (lease do limitador de mutações em
  `meta_ads_publish_locks`), a leitura falha com
  `meta_ads_read_publish_in_progress` (409) sem chamar a Graph.
- **Recusa com cota alta.** Depois de cada leitura o gateway mede
  `x-business-use-case-usage`, `x-ad-account-usage`, `x-app-usage` e
  `x-fb-ads-insights-throttle`. Com 80% ou mais, ou se a Graph recusar por
  limite de chamadas, ele grava uma guarda por conta (10 min a partir de 80%,
  30 min a partir de 95% ou em throttle, até 60 min se a Graph informar o
  tempo de recuperação). Enquanto a guarda vale, toda leitura falha com
  `meta_ads_read_rate_guard` (429) sem chamar a Graph. A operação que disparou
  a guarda devolve `rate_usage.read_guard` e `warning`/`pause_recommended`.
- **Falha fechada.** Se o estado da guarda não puder ser lido no D1, a leitura
  falha com `meta_ads_read_guard_unavailable` (503).
- **Leitura nunca é ambígua.** Uma falha de leitura deixa a operação como
  `failed` e não muda o estado do run para `reconciliation_required`.
- **Um run por lote pequeno.** `PATCH /runs/:id` devolve o resultado de todas
  as operações do run; o cliente deve usar um run de diagnóstico para poucas
  páginas (o exportador troca de run a cada 8 operações) e nunca usar as
  leituras dentro de um run de publicação.

A guarda usa uma linha própria por conta na tabela de locks que já existe
(`graph-read-guard:<conta>`); não há migration.

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
`ARCHIVED` e `DELETED`), `limit` (1–100, padrão 50) ou `after`, a ação passa
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

Levantamento de 26/11/2026, revisto no mesmo dia depois da leitura do código
implantado. Classificação ao final.

### 2.1 Como o Worker é versionado e promovido hoje

- Um único Worker, `skincos-token-vault`, na rota
  `api.skincos.com.br/internal/token-vault/*`, com um banco D1; staging é o
  ambiente `env.staging` do mesmo `wrangler.toml`.
- O caminho escrito no repositório é `.github/workflows/deploy-token-vault.yml`
  (`workflow_dispatch` com um SHA da `main`). Nenhum job `release` de staging
  ou produção desse workflow terminou com sucesso, e o GitHub Actions deixou
  de ser executor autorizado. Em 26/11/2026 os jobs do Actions deste
  repositório nem iniciam (conta bloqueada por cobrança), o que também explica
  os checks vermelhos dos PRs.
- Conclusão: **hoje não existe caminho de promoção governado e validado até
  produção** para este Worker. Merge na `main` não implanta nada.

### 2.2 O que está em produção

O bundle implantado foi lido em 26/11/2026 e comparado com o histórico:

- **Não é a `main`.** A `main` declara `WORKFLOW_CONTRACT_REVISION =
  meta_destination_contract_v20_tracking_reconciliation` desde 13/08/2026
  (#1415). Produção declara **v18**
  (`meta_destination_contract_v18_live_campaign_cta`).
- **Não é o pai de #1415.** Produção tem só quatro módulos (`meta-ads-publish`,
  `social-publish`, `index`, `compat-entry`); não tem `analytics-readonly`,
  `analytics-staging-bootstrap`, `bounded-body` nem `token-crypto`.
- **É o commit `24f17440` (29/07/2026) mais um patch que nunca entrou no
  git:** o limitador de mutações da Graph
  (`meta_graph_account_mutation_pacing_v1`: `reserveGraphMutationSlot`,
  `finishGraphMutationSlot`, `graphRateStateFailure`, um `graphRequest` que
  serializa os `POST` por conta com 35 s de intervalo, o throttle
  613/4841018 e o `Retry-After` sem truncamento). O patch foi aplicado direto
  no bundle.
- O branch `codex/token-vault-meta-ads-leitura-prod` versiona essa fonte. O
  primeiro commit dele reconstrói o patch na fonte e é **equivalente ao
  implantado, declaração por declaração (207 de 207)**, conferido com
  `scripts/compare-worker-bundle.mjs`.

Consequências:

- implantar a `main` **ou** qualquer base que não tenha o limitador remove a
  proteção de rate limit das publicações;
- a `main` (v20) não tem o limitador: ele precisa ser portado antes de
  qualquer promoção futura do v20.

### 2.3 Consumidores do Worker

| Consumidor | Estado | Rotas |
|---|---|---|
| n8n "Meta Ads – Publish" | inativo, execução manual | `/v1/meta-ads-publish/config`, `/inventory`, `/runs`, `/runs/:id/...` |
| n8n "Token Manager" | ativo | `/v1/token-metadata`, `/v1/tokens/:id` |
| n8n "Livia" | ativo | `/v1/social-publish/operations`, `/v1/token-metadata` |
| Scripts do Orb | sob demanda | preflights da Livia, leitura do contrato de conversão, exportação do histórico |
| Influencer Intelligence | staging (shadow) | `/v1/analytics/operations` (não existe em produção) |

Todos compartilham o mesmo Worker: **qualquer deploy troca o código de todos
ao mesmo tempo**. É esse o raio de impacto, não o tamanho do diff.

### 2.4 Efeito desta mudança, isolada

| Pergunta | Resposta |
|---|---|
| `WORKFLOW_CONTRACT_REVISION` muda? | Não. |
| A capacidade em `GET /config` muda? | Ganha a chave `capabilities.read_only`. As chaves existentes ficam idênticas. |
| O nó do Orb falha fechado? | Não. O nó publicado compara a revisão (v18) e lê `video_upload`; não exige igualdade do objeto inteiro. Produção não emite `capabilities.tracking` e o nó tolera a ausência dessa chave e de `objective_route_actions`. |
| Ações existentes mudam? | Não. Sem os parâmetros novos o pedido não entra no módulo. Há teste fixando as três requisições antigas. Nenhum workflow do n8n envia `limit`, `after`, `effective_status` ou `view` nessas ações. |
| Código compartilhado alterado? | Sobre produção, cinco declarações: `ALLOWED_ACTIONS` (+1 ação), `getConfig` (+1 chave), `performOperation` (desvio), `graphRequest` (opção `maxAttempts`, usada só pelas leituras) e `extractRateUsage` (grava mais um header; não entra no cálculo usado pela publicação). |
| Migration? | Nenhuma. Usa `meta_ads_publish_operations` e `meta_ads_publish_locks`, que existem desde a `0002`. |
| Binding, secret ou rota nova? | Nenhum. |
| Escrita na Meta? | Nenhuma; só `GET`. As leituras não disputam o slot do limitador (ele só vale para `POST`). |

Riscos próprios das leituras, com mitigação:

- **Cota da Graph compartilhada com o Publish.** `get_campaign`/`get_adset`
  caem no mesmo balde da publicação; insights têm cota própria. Mitigação: as
  proteções da seção 1 (uma chamada por operação, recusa durante publicação,
  guarda a partir de 80%) e o exportador, que para na primeira recusa, aviso
  ou timeout.
- **Crescimento do journal.** Cada operação grava o resultado (até 1 MB) no
  D1. Uma exportação completa são dezenas de operações, poucos MB.
- **Resposta grande ao fechar o run.** Mitigado no cliente: poucas operações
  por run.
- **Conteúdo do journal.** Passa a conter gasto e nomes de campanha/anúncio da
  própria conta; nada demográfico, nenhum token.

### 2.5 Onde está o risco de derrubar serviço

O código das leituras não derruba nada. O risco está em **o que mais vai junto
no deploy**:

| Caminho | Efeito |
|---|---|
| Merge do PR na `main` | Nenhum em produção: merge não implanta. |
| Promover a `main` (v20) | **Derruba o Meta Ads – Publish**: `GET /config` passa a anunciar v20 e o nó publicado (v18) falha fechado; exige as migrations `0003`–`0006` e o bootstrap da autoridade de configuração; remove o limitador de mutações. Livia e Token Manager entram no mesmo deploy sem validação. Não promover. |
| Promover `codex/token-vault-meta-ads-leitura-v18` (backport antigo) | Remove o limitador de mutações e acrescenta rotas de analytics nunca promovidas. **Descartado.** |
| Promover `codex/token-vault-meta-ads-leitura-prod` | Produção + as cinco declarações acima + o módulo novo. É o único candidato. |

### 2.6 Janela de indisponibilidade

A troca de versão de um Worker é atômica: a versão nova assume em segundos e
os pedidos em andamento terminam na anterior. Não há alteração no D1. O risco
é funcional (contrato, bindings), não de tempo fora do ar.

### 2.7 Promoção (caminho único)

Candidato: branch `codex/token-vault-meta-ads-leitura-prod`. Executa quem
tiver credencial Cloudflare com permissão de editar o Worker, autorizado pelo
dono. Os comandos rodam em `platform/security/token-vault` do checkout desse
branch.

Pré-condições:

- nenhuma execução do Meta Ads – Publish e nenhuma publicação da Livia em
  andamento (o deploy é atômico, mas o aceite precisa de um sistema parado);
- `wrangler whoami` responde com a conta certa;
- suíte do gateway verde no branch (`meta-ads-read`, `meta-ads-publish`,
  `index`, `social-publish`, `compat-entry`).

Passos:

1. **Anotar a versão ativa.** `wrangler deployments status --name
   skincos-token-vault` e guardar o ID da versão com 100% do tráfego
   (`<VERSAO_ATUAL>`).
2. **Guardar o bundle atual** em local privado e conferir que ele continua
   igual ao que foi analisado: baixar o código do Worker e rodar, no commit
   de base do branch (o que versiona a fonte de produção),
   `node scripts/compare-worker-bundle.mjs --esbuild <esbuild> --deployed
   <bundle>`. Resultado obrigatório: `EQUIVALENTE`. Se não for, alguém
   alterou produção depois de 26/11: parar.
3. **Comparar bindings e variáveis.** `wrangler versions view <VERSAO_ATUAL>
   --name skincos-token-vault` contra o `wrangler.toml` do branch: binding D1
   `TOKEN_VAULT_DB`, variáveis, `compatibility_date` e flags. Qualquer
   variável que exista em produção e não no arquivo precisa entrar no arquivo
   (ou usar `keep_vars = true`) antes do upload. Secrets são herdados. Se
   houver diferença não explicada: parar.
4. **Gerar o candidato sem enviar** e provar que ele é "produção + só o
   esperado": `wrangler deploy --dry-run --outdir <dir>` e depois
   `node scripts/compare-worker-bundle.mjs --esbuild <esbuild> --deployed
   <bundle> --entry <dir>/compat-entry.js --allow-file
   scripts/meta-ads-read-v1.allow` (a lista traz as cinco declarações da
   seção 2.4 e as do módulo novo). Resultado obrigatório: `SÓ AS DIFERENÇAS
   ESPERADAS`.
5. **Subir a versão sem tráfego.** `wrangler versions upload` e guardar o ID
   (`<VERSAO_NOVA>`). Nada muda para os clientes.
6. **Colocar a versão nova a 0%.** `wrangler versions deploy
   <VERSAO_ATUAL>@100% <VERSAO_NOVA>@0% -y`.
7. **Conferir a versão nova pela rota canônica**, com o header
   `Cloudflare-Workers-Version-Overrides: skincos-token-vault="<VERSAO_NOVA>"`:
   `GET /v1/meta-ads-publish/config` devolve o mesmo status de antes, v18,
   as mesmas chaves e mais `read_only`; `GET /health` responde. Sem o
   header, a resposta continua sem `read_only`.
8. **Direcionar 100%.** `wrangler versions deploy <VERSAO_NOVA>@100% -y`.
9. **Aceite**, nesta ordem: `GET /config` sem header mostra `read_only`;
   preflight do Meta Ads – Publish verde; preflight de token da Livia verde;
   Token Manager lê `/v1/token-metadata`; uma leitura `get_insights` de nível
   `account` num run de diagnóstico devolve dados e `rate_usage`.

Falta para executar: credencial Cloudflare com permissão sobre o Worker,
executor autorizado pelo dono e os passos 2 e 3 (só possíveis com a
credencial).

### 2.8 Rollback

- **Gatilho:** qualquer item do aceite falhar, `GET /config` mudar de status
  ou de revisão, ou erro novo na Livia ou no Token Manager.
- **Ação:** `wrangler versions deploy <VERSAO_ATUAL>@100% -y` (ou
  `wrangler rollback <VERSAO_ATUAL>`). Efeito em segundos. Não há D1, secret
  ou rota para desfazer.
- **Conferir depois:** `GET /config` sem `read_only`, v18; preflights verdes.
- Clientes: quem usa as leituras confere `capabilities.read_only` antes; sem a
  chave, o exportador volta sozinho ao modo antigo.
- Linhas do journal e a linha de guarda em `meta_ads_publish_locks` gravadas
  pelas leituras são inertes para a versão anterior.

### 2.9 Classificação

- Mudança de código: **PASS** — aditiva, sem alteração de contrato ou de
  migration, com as ações existentes fixadas por teste.
- Promoção: **BLOQUEADA até haver credencial, executor e os passos 2 e 3** —
  nunca pela `main` nem pelo backport antigo; só pelo branch `-prod`.
- Pendência separada: portar o limitador de mutações para a `main` antes de
  qualquer promoção do v20.
