# Token Vault — rotas por objetivo do Meta Ads (`objroute_v1`)

Rotas que o "Meta Ads – Publish" usa nas Fases 2 e 3 do roteamento por objetivo:
criar campanha e conjunto **pausados**, listar o que espera aprovação e ativar depois
da aprovação do operador. Toda a proteção real de gasto fica aqui; o workflow é só a
primeira barreira.

**Tudo nasce desligado.** Com `META_ADS_OBJECTIVE_ROUTES_MODE` diferente de `on` (o
padrão do `wrangler.toml` é `off`), as rotas respondem `409 objective_routes_disabled`
sem ler nem mudar nada, a capacidade não é anunciada em `/config`, o inventário fica
igual e o monitor agendado não faz nada.

Código: `src/meta-ads-objective-routes.js` (módulo próprio, com as primitivas do
gateway injetadas), ligado em `src/meta-ads-publish.js` e `src/index.js`. Banco:
`migrations/0007_meta_ads_objective_routes.sql`. Testes:
`tests/meta-ads-objective-routes.test.js`.

## 1. Rotas

Todas em `/internal/token-vault/v1/meta-ads-objective-routes`, com o bearer `admin` ou
operacional (o mesmo do gateway de publicação). A política é só do `admin`.

| Rota | Ação (`action`) | O que faz |
|---|---|---|
| `POST /requests` | `ensure_objective_route` | Cria campanha + conjunto `PAUSED` para uma `route_key` e abre a pendência de aprovação. Idempotente. |
| `POST /pending` | `list_pending_objective_routes` | Pendências abertas, com estado, vagas e verba da unidade, e as decisões ainda não avisadas. |
| `POST /pending` | `ack_objective_route_notification` | Marca `notified_at` do pedido (`kind: "request"`) ou da decisão (`kind: "decision"`). |
| `POST /decisions` | `decide_objective_route` | Registra `APPROVE`, `REJECT` ou `BLOCK`. Só `APPROVE` pode ativar, e só depois de o Vault refazer a conta. |
| `POST /monitor` | `monitor_objective_routes` | O mesmo passo do gatilho agendado, sob demanda. |
| `GET` / `PUT /policy` | — | Lê ou grava a política de uma unidade (só `admin`). |

### 1.1 Criar a rota pausada

Entrada: `{action, idempotency_key, request}`, com `request` no formato
`meta_ads.objective_route_request.v1` e `idempotency_key` igual a `request.route_key`
(`objroute_v1:<UNIDADE>:<OBJETIVO>`).

O pedido é conferido campo a campo contra o catálogo do próprio Vault (objetivo,
otimização, cobrança, destino, `promoted_object`, limite de frequência, nomes, `PAUSED`
nos três níveis, ABO, `is_adset_budget_sharing_enabled: false`, diário em centavos).
Qualquer diferença devolve `400 objective_route_request_invalid` com `detail.field`. O
que vai para a Graph é montado pelo Vault, não copiado do pedido.

| Objetivo | Campanha | Conjunto |
|---|---|---|
| `TRAFFIC_SITE_AGENDAMENTO` | `OUTCOME_TRAFFIC` | `LANDING_PAGE_VIEWS`, `WEBSITE`, sem `promoted_object` |
| `AWARENESS` | `OUTCOME_AWARENESS` | `REACH`, sem `destination_type`, `promoted_object.page_id`, `frequency_control_specs` (2 em 7 dias) |
| `ENGAGEMENT_VIDEO` | `OUTCOME_ENGAGEMENT` | `THRUPLAY`, `ON_VIDEO`, sem `promoted_object` |

`LEADS_WHATSAPP` usa o conjunto já configurado (`409 objective_route_uses_current_route`).
`LEADS_FORM` e `CONVERSION_SITE_AGENDAMENTO` seguem desligados
(`409 objective_route_objective_disabled`).

Saída: `{ok, route_key, approval_code, status, new_request, campaign_id, adset_id,
campaign_status, adset_status, created_at, expires_at}`.

- O `approval_code` do pedido é ignorado. O Vault sorteia 4 caracteres (crypto, sem I, L,
  O, 0 e 1), únicos entre as pendências abertas e sem repetir código dos últimos 30 dias.
- `new_request` é `true` só na chamada que abriu a pendência. Repetir o pedido devolve o
  mesmo código com `new_request: false` e não chama a Graph.
- A validade é de 24 h a partir da abertura da pendência.
- **Criação parcial.** Se a criação parar no meio, a resposta é
  `502 objective_route_creation_incomplete` e o registro fica em `CREATING`. A chamada
  seguinte com a mesma `route_key` procura a campanha e o conjunto pelo nome antes de
  criar, então nunca duplica, mesmo quando a Meta criou e a resposta se perdeu.
- Campanha ou conjunto com o nome da rota que **não** esteja `PAUSED` nunca é tocado
  (`objective_route_existing_campaign_not_paused`). Dois objetos com o mesmo nome também
  recusam.
- Rota recusada, bloqueada, vencida ou pausada pelo monitor só pode ser pedida de novo
  depois de 7 dias (`409 objective_route_cooldown`, com `retry_after_seconds`). O pedido
  novo ganha código novo e reaproveita a campanha e o conjunto pausados.
- O teto do pedido é só conferido: maior que o da política do Vault devolve
  `409 objective_route_ceiling_above_vault_policy`.

### 1.2 Pendências

Cada item de `pending` traz `route_key`, `unit`, `objective`, `approval_code`, `status`,
`created_at`, `expires_at`, `last_decision_at`, `notified_at`, `daily_budget_brl`,
`campaign_status`, `adset_status`, `ad_ids`, `capacity {used, limit}` e
`budget_state {ceiling_monthly_brl, spend_mtd_brl, committed_daily_brl,
committed_next_daily_brl, days_remaining, as_of, next_ceiling_monthly_brl,
days_next_month, month_profile, invalid}`.

- A leitura da conta fica guardada por 15 minutos para esta lista. A decisão nunca usa
  esse cache.
- Se a leitura da conta falhar, a lista inteira falha (`ok: false`, 5xx). Devolver uma
  pendência sem o gasto do mês faria o workflow mandar um `BLOCK`, que é final.
- Com entrada inválida e determinística (moeda da conta diferente de BRL, listagem
  truncada, conjunto ativo sem orçamento legível), `spend_mtd_brl` e
  `committed_daily_brl` vêm `null` e `invalid` diz o motivo.
- `unnotified_decisions` lista as decisões dos últimos 14 dias sem `notified_at`:
  ativações cuja resposta se perdeu num timeout, vencimentos e pausas do monitor.

### 1.3 Decisão

Entrada: `{action, route_key, approval_code, decision, reply_message_id, reply_ts,
local_checks}`. Saída: `{ok, route_key, approval_code, outcome, new_decision, reasons,
budget}`, com `outcome` em `ACTIVATED | REJECTED | BLOCKED | ALREADY_DECIDED`.

- `REJECT` e `BLOCK` são aceitos como vêm, porque só fecham a rota. Os motivos de
  `local_checks.checks` entram no registro do `BLOCK` e nunca liberam nada.
- `APPROVE` não autoriza gasto. O Vault relê na Graph a campanha e o conjunto (os dois
  `PAUSED`, o diário igual ao do pedido), os anúncios do conjunto (até 50), o gasto do mês
  e os orçamentos da conta, e refaz a conta do teto. Se algo não passar, a rota vira
  `BLOCKED` com o motivo: `route_not_paused`, `adset_budget_changed`, `adset_ad_limit`,
  `ceiling_exceeded`, `next_month_ceiling_exceeded` ou `budget_inputs_invalid`.
- Se a leitura falhar, a resposta é `503 objective_route_budget_inputs_unavailable` e
  **nada muda**: a pendência continua aberta para a rodada seguinte.
- Passando, a ordem é campanha → conjunto → anúncios pausados do conjunto, com readback
  dos dois níveis.
- `ALREADY_DECIDED` traz `decided_outcome`, `decided_at` e `notified_at`.
- Resposta do operador fora da validade (`reply_ts` depois de `expires_at`, ou decisão
  mais de 30 minutos depois do vencimento) fecha a rota como vencida:
  `outcome: BLOCKED`, `reasons: ["approval_expired"]`. Resposta anterior ao pedido ou no
  futuro devolve `409 objective_route_reply_outside_validity` sem mudar o registro.
- O mesmo `reply_message_id` não decide duas rotas (`409 objective_route_reply_already_used`).
- **Ativação interrompida.** Timeout no meio da ativação devolve
  `502 objective_route_activation_incomplete` e deixa a rota em `ACTIVATING` (já contando
  no diário da unidade). A rodada seguinte confere o teto de novo e termina a ativação ou
  pausa tudo e bloqueia. Recusa definitiva da Meta pausa o que foi ativado e bloqueia
  (`activation_failed`).

## 2. Conta do teto

Mesma conta do trecho `obj-budget-check-v1` do workflow, com margem de 10%:

- mês corrente: `gasto do mês + (comprometido + novo) × dias restantes ≤ teto × 0,9`;
- virada: `(comprometido do mês seguinte + novo) × dias do mês seguinte ≤ teto seguinte × 0,9`.

De onde vem cada número:

- **Teto**: da política da unidade no Vault (`ceilings_monthly_brl.base` ou `.forte`,
  conforme `month_profiles` do mês). O teto do pedido não entra na conta.
- **Dias restantes**: contam hoje, em `America/Sao_Paulo`.
- **Gasto do mês**: Insights por conjunto, do dia 1 até hoje.
- **Comprometido**: tudo que pode gastar na unidade, com conjunto e campanha `ACTIVE`:
  diário do conjunto (ABO), orçamento da campanha (CBO, contado uma vez), vitalício
  rateado pelos dias até o fim, e as rotas `ACTIVATING`/`ACTIVATED` do Vault que a
  listagem ainda não mostra como ativas. O comprometido do mês seguinte deixa de fora os
  vitalícios que terminam neste mês.
- **Unidade de cada conjunto**: as duas unidades usam a mesma conta. O Vault reconhece
  os conjuntos da configuração do Publish, os da política (`adset_ids`) e os das próprias
  rotas. **Conjunto desconhecido conta para as duas unidades**, no gasto e no
  comprometido. Para tirar um conjunto da outra unidade da conta, inclua-o em `adset_ids`
  da unidade dele.
- A moeda da conta precisa ser BRL (os orçamentos da Graph vêm em centavos).

## 3. Guardas

- **`PAUSED` na criação, `ACTIVE` só na ativação.** Toda mutação passa por uma função
  única, que recusa criação com status diferente de `PAUSED` e só aceita `ACTIVE` com a
  autorização emitida pela conferência do teto daquela rota, há menos de 5 minutos.
- **Trava por unidade.** Criação, decisão e monitor da mesma unidade não rodam juntos
  (linha `objective-route-unit:<UNIDADE>` em `meta_ads_publish_locks`, 5 minutos). A
  segunda chamada recebe `409 objective_route_unit_busy` e, na rodada seguinte, já vê o
  diário da primeira.
- **Journal.** `meta_ads_objective_route_events` guarda o pedido e o resultado de cada
  mutação, além das mudanças de estado. As rotas também gravam na auditoria do Vault.
- **Idempotência.** Um registro vivo por `route_key` e um código por pendência aberta,
  garantidos por índice único no banco.
- **Uma tentativa por mutação.** O gateway não repete `POST`; a retomada reconcilia pelo
  estado lido.

## 4. Monitor contínuo

Gatilho agendado do Worker (`[triggers] crons`, a cada 30 minutos). Para cada unidade com
rota `ACTIVATED`, lê a conta e, se `gasto do mês + comprometido × dias restantes` passar
de `teto × 0,9`, pausa as rotas `objroute_v1` da unidade (conjunto e depois campanha) e
as marca `PAUSED_BY_MONITOR`. Os conjuntos que não são rota por objetivo não são tocados.
A pausa aparece em `unnotified_decisions`.

Se o monitor não conseguir medir (Graph fora, moeda errada, política ausente), ele
registra no journal e **não pausa**. Ver "Riscos".

## 5. Política por unidade

`PUT /policy`, só `admin`:

```json
{
  "unit": "<BSS|NH>",
  "token_id": "<id do token da unidade>",
  "enabled": true,
  "ceilings_monthly_brl": { "base": 0, "forte": 0 },
  "month_profiles": { "<AAAA-MM>": "forte" },
  "targeting": { "geo_locations": {} },
  "adset_ids": [],
  "objectives": ["TRAFFIC_SITE_AGENDAMENTO"]
}
```

- `token_id` precisa ser um token cuja configuração do Publish pertence à unidade.
- `targeting` é o público do conjunto novo (o `targeting_ref` do pedido). Fica só no Vault.
- `objectives` é opcional; sem ele valem os três objetivos criáveis.
- Sem política habilitada a unidade não cria nem ativa nada.
- Os tetos e o perfil do mês precisam ser os mesmos do `OBJECTIVE_BUDGET_POLICY` do
  workflow. Se o workflow pedir com um teto maior, o Vault recusa o pedido.

## 6. Contrato do workflow, capacidades e inventário

- `WORKFLOW_CONTRACT_REVISION` **não muda**. O workflow atual continua aceito.
- Com o modo `on` e a migration aplicada, `GET /config` ganha
  `capabilities.objective_route_actions = ["ensure_objective_route",
  "list_pending_objective_routes", "decide_objective_route"]` e
  `capabilities.objective_routes` (revisão, ações de aviso, objetivos, prazos). Com o modo
  `off` essas chaves não existem.
- No inventário, cada `placement_check` de um conjunto de rota ganha
  `objective_route_key`, `objective_route_outcome` (o estado da rota, por exemplo
  `ACTIVATED`) e `objective_route_campaign_id`. Os conjuntos das rotas `ACTIVATED` da
  conta entram nos `placement_checks` mesmo quando o chamador não os lista. Qualquer
  falha nessa etapa deixa o inventário como era.

## 7. Diferenças em relação ao que o workflow espera hoje

O workflow funciona sem mudança, mas vale ajustar:

- **Motivos novos** na resposta da decisão: `approval_expired`, `adset_budget_changed`,
  `activation_failed`, `pause_after_failure_unconfirmed`, `creation_abandoned`. O *Build
  Objective Decision Reply* mostra o código cru para os que não conhece.
- **Aviso reenviado.** O workflow ainda não chama `ack_objective_route_notification` nem lê
  `unnotified_decisions`. Até isso existir, um aviso perdido não é reenviado.
- **`PAUSED_BY_MONITOR`** não tem mensagem no workflow.
- O Vault exige `diário × 31 ≤ teto × 0,9` já no pedido (o workflow usa o teto cheio).
- `5xx` em `/decisions` significa "nada decidido, tente na próxima rodada". O workflow já
  trata assim.

## 8. Promoção e rollback

Este branch parte da `main`, que está em outro contrato do workflow que o Worker em
produção. **Ele não é o candidato a promover.** Antes de promover, o módulo e a ligação
precisam ir para a linha de produção, como foi feito com as leituras (ver
`META_ADS_READ.md`). O módulo é independente; a ligação no gateway são três pontos:
capacidades em `getConfig`, `placement_checks` em `getInventory` e o roteamento em
`index.js`/`compat-entry.js`.

Ordem, com o candidato certo em mãos:

1. **Migration 0007** (`d1 migrations apply`). É só aditiva e o Worker atual não usa as
   tabelas novas, então pode ir antes do Worker.
2. **Worker** com `META_ADS_OBJECTIVE_ROUTES_MODE = "off"`. Nada muda de comportamento;
   o deploy passa a registrar o gatilho agendado, que não faz nada com o modo `off`.
3. **Política** das duas unidades (`PUT /policy`), com os tetos e o público.
4. **Modo `on`** (novo deploy da variável). A capacidade passa a ser anunciada.
5. **Orb**: só então `CAMPAIGN_CREATE_MODE='paused'`, e depois a Fase 3
   (`OBJECTIVE_ACTIVATION_MODE='on'` e o gatilho de 10 minutos).

Inverter 4 e 5 não quebra nada: sem a capacidade o workflow não gera pedido.

**Rollback:** voltar o modo para `off`. As rotas param de aceitar pedidos e decisões.
Atenção: com o modo `off` o monitor também para, então **pause antes, no Gerenciador de
Anúncios, as rotas que estiverem ativas**, ou elas seguem gastando sem monitor. A
migration não precisa ser desfeita.

## 9. Riscos e limites

- **Limitador de mutações.** A `main` não tem o limitador de mutações da Graph que existe
  em produção. As rotas fazem poucas chamadas (2 `POST` na criação, 2 ou mais na
  ativação), mas não passam por ele nem pela guarda de cota das leituras.
- **Monitor cego não pausa.** Se a leitura da conta falhar por muito tempo, as rotas
  ativas seguem sem conferência. Não há alerta além do journal.
- **Conjunto desconhecido conta em dobro.** É o lado seguro, mas uma campanha manual
  grande pode bloquear ativações das duas unidades até entrar em `adset_ids`.
- **O teto vale para ativar, não para o gasto.** A Meta pode gastar acima do diário; a
  margem de 10% e o monitor cobrem isso, com atraso de até 30 minutos.
- **Aumento manual de orçamento** depois da ativação só é visto pelo monitor.
- **Listagens grandes.** Mais de 2.000 conjuntos ou 5.000 linhas de Insights no mês
  invalidam a conta (`budget_inputs_invalid`), em vez de contar pela metade.
- **Insights tem atraso.** O gasto do dia pode chegar com minutos de atraso.
- Não testado contra a Graph real nem em staging: o filtro `CONTAIN` por nome, o payload
  do conjunto por objetivo e o formato de `end_time` foram exercitados só com a conta
  falsa dos testes.
