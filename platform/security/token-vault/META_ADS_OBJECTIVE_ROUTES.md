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
| `POST /pending` | `list_pending_objective_routes` | Pendências abertas, com estado, vagas e verba da unidade, as decisões ainda não avisadas, as rotas aprovadas que ainda não fecharam e a saúde do monitor. |
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
  criar. A busca lista os objetos sem filtro da Graph e compara o nome no Vault.
- **Criação sem resposta clara.** Depois de um timeout ou 5xx na criação, a Meta pode ter
  criado o objeto e a listagem ainda não o mostrar. Enquanto a busca pelo nome não achar,
  o Vault **não cria de novo por 30 minutos**: a resposta é
  `502 objective_route_creation_incomplete` com
  `detail.cause_code = "objective_route_create_unconfirmed"` e `retry_after_seconds`.
  Recusa definitiva da Meta (4xx) não abre essa espera.
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
- `in_progress` lista as rotas aprovadas que ainda não fecharam: `ACTIVATING` (ativação
  interrompida) e `PAUSE_PENDING` (fechada, com a pausa na Meta ainda sem confirmação).
  Cada item traz `route_key`, `unit`, `objective`, `approval_code`, `status`, `since`,
  `reasons`, `campaign_status` e `adset_status`. Não são pendências de aprovação: quem as
  resolve é o monitor, e a decisão final aparece depois em `unnotified_decisions`.
- `monitor` traz, por unidade, `last_run_at`, `last_ok_at`, `last_reason` e
  `consecutive_failures`. Maior que zero significa que a última rodada não conseguiu
  medir ou deixou rota sem resolver: as rotas ativas estão sem conferência de teto.

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
  no diário da unidade e já dentro da conferência de teto do monitor). **O monitor retoma
  sozinho**, sem depender do workflow: com a rota parada há mais de 10 minutos ele confere
  o teto de novo e termina a ativação, ou pausa tudo e bloqueia; parada há mais de 2 horas
  ele desiste, pausa e bloqueia (`activation_incomplete`). Repetir a decisão com o mesmo
  código faz a mesma retomada.
- **Recusa definitiva da Meta** pausa o que foi ativado e bloqueia (`activation_failed`).
- **Fechar exige pausa confirmada.** Uma rota que pode estar gastando só vira `BLOCKED` ou
  `PAUSED_BY_MONITOR` depois de o Vault **ler** o conjunto (ou a campanha) como `PAUSED`,
  `ARCHIVED` ou `DELETED`; a resposta do `POST` não basta. Sem a confirmação a rota fica
  em `PAUSE_PENDING`: continua viva, continua contando no comprometido da unidade, e o
  monitor repete a pausa a cada rodada até confirmar. A resposta da decisão, nesse caso,
  é `outcome: BLOCKED` com `pause_after_failure_unconfirmed` entre os motivos e
  `route_status: "PAUSE_PENDING"`. Um conjunto apagado no Gerenciador conta como parado
  quando a Graph não o lê e a listagem completa da conta não o mostra ativo.

## 2. Conta do teto

Mesma conta do trecho `obj-budget-check-v1` do workflow, com margem de 10%:

- mês corrente: `gasto do mês + (comprometido + novo) × dias restantes ≤ teto × 0,9`;
- virada: `(comprometido do mês seguinte + novo) × dias do mês seguinte ≤ teto seguinte × 0,9`.

De onde vem cada número:

- **Teto**: da política da unidade no Vault (`ceilings_monthly_brl.base` ou `.forte`,
  conforme `month_profiles` do mês). O teto do pedido não entra na conta.
- **Dias restantes**: contam hoje, em `America/Sao_Paulo`.
- **Gasto do mês**: Insights por conjunto, do dia 1 até hoje, mais o total da conta no
  mesmo período. O que as linhas por conjunto não explicam (conjunto arquivado ou apagado
  no mês) entra inteiro no gasto **das duas unidades**.
- **Fuso da conta**: o período de Insights segue o fuso da conta de anúncios. Se
  `timezone_name` não for `America/Sao_Paulo`, a conta do teto é inválida
  (`account_timezone_not_sao_paulo`) e nada é ativado.
- **Comprometido**: tudo que pode gastar na unidade, com conjunto e campanha `ACTIVE`:
  diário do conjunto (ABO), orçamento da campanha (CBO, contado uma vez), vitalício
  rateado pelos dias até o fim, e as rotas `ACTIVATING`/`ACTIVATED`/`PAUSE_PENDING` do
  Vault que a listagem ainda não mostra como ativas. O comprometido do mês seguinte deixa de fora os
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
  (linha `objective-route-unit:<UNIDADE>` em `meta_ads_publish_locks`, 5 minutos,
  renovada antes de cada mutação). A segunda chamada recebe
  `409 objective_route_unit_busy` e, na rodada seguinte, já vê o diário da primeira. Quem
  perde a trava no meio não faz a mutação seguinte (`objective_route_unit_lock_lost`).
- **Compare-and-set.** Toda gravação no registro da rota só vale se ele ainda está no
  estado que a chamada leu (`WHERE id = ? AND status = ?`). Quem perde a corrida recebe
  `409 objective_route_state_changed` e não muda nada. O vencimento varrido pela lista de
  pendências, que roda fora da trava, apenas cede a vez.
- **Journal.** `meta_ads_objective_route_events` guarda o pedido e o resultado de cada
  mutação, além das mudanças de estado. As rotas também gravam na auditoria do Vault.
- **Idempotência.** Um registro vivo por `route_key` (inclui `PAUSE_PENDING`) e um código
  por pendência aberta, garantidos por índice único no banco.
- **Uma tentativa por mutação.** O gateway não repete `POST`; a retomada reconcilia pelo
  estado lido.

## 4. Monitor contínuo

Gatilho agendado do Worker (`[triggers] crons`, a cada 30 minutos). Para cada unidade com
rota que pode estar gastando (`ACTIVATING`, `ACTIVATED` ou `PAUSE_PENDING`), sob a trava
da unidade:

1. **Pausas sem confirmação** (`PAUSE_PENDING`): repete a pausa e, com a leitura
   confirmando, grava o estado final que estava pendente (`BLOCKED` ou
   `PAUSED_BY_MONITOR`).
2. **Ativações interrompidas** (`ACTIVATING` há mais de 10 minutos): retoma com o teto
   conferido de novo; há mais de 2 horas, pausa e bloqueia.
3. **Teto**: lê a conta e, se `gasto do mês + comprometido × dias restantes` passar de
   `teto × 0,9`, pausa as rotas `objroute_v1` da unidade (conjunto e depois campanha),
   inclusive as que ainda estão em `ACTIVATING`, e as marca `PAUSED_BY_MONITOR`.

Os conjuntos que não são rota por objetivo não são tocados. Toda rota fechada pelo
monitor aparece em `unnotified_decisions`. O relatório do passo traz, por unidade,
`action`, `reason`, `paused_route_keys`, `recovered` e `unresolved_route_keys`.

Se o monitor não conseguir medir (Graph fora, moeda ou fuso errado, política ausente), ele
registra no journal, marca a falha em `monitor` (lista de pendências) e **não pausa**.
Ver "Riscos".

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
- No inventário, cada `placement_check` de um conjunto de rota **que o chamador listou
  em `adsets`** ganha `objective_route_key`, `objective_route_outcome` (o estado da rota,
  por exemplo `ACTIVATED`) e `objective_route_campaign_id`. O Vault **nunca acrescenta**
  conjuntos que o chamador não pediu: o nó "Validate Meta Placement Eligibility" do
  workflow exige de toda entrada os publishers do WhatsApp, e um conjunto de tráfego,
  vídeo ou alcance a mais bloquearia o lote inteiro do Publish. Para o workflow de hoje a
  resposta do inventário é idêntica com o modo `on` ou `off`. Qualquer falha nessa etapa
  deixa o inventário como era.

## 7. Diferenças em relação ao que o workflow espera hoje

O workflow funciona sem mudança, mas vale ajustar:

- **Motivos novos** na resposta da decisão: `approval_expired`, `adset_budget_changed`,
  `activation_failed`, `activation_incomplete`, `pause_after_failure_unconfirmed`,
  `creation_abandoned`, `budget_inputs_invalid` por fuso da conta. O *Build Objective
  Decision Reply* mostra o código cru para os que não conhece.
- **Rota nova no inventário.** Para o `enforce` usar uma rota ativada, o workflow precisa
  **listar o conjunto da rota em `adsets`** no pedido de inventário (o Vault não o
  acrescenta) e o "Validate Meta Placement Eligibility" precisa validar essa entrada pelo
  objetivo dela (sem exigir os publishers do WhatsApp quando há `objective_route_key`).
  Sem isso o `enforce` fica em `route_unverified` e a peça segue pela rota atual.
- **`in_progress` e `monitor`** são chaves novas da lista de pendências; o workflow ainda
  não as lê. Valem um aviso ao operador (rota sem fechar, monitor sem medir).
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

Ordem, com o candidato certo em mãos (Worker primeiro, Orb por último):

1. **Migration 0007, só ela.** A linha de produção só tem as migrations 0001 e 0002;
   `d1 migrations apply` a partir deste branch aplicaria também 0003 a 0006 no D1 de
   produção. Então: leve **só o arquivo 0007** para a linha de produção, confira antes o
   que já está aplicado (`wrangler d1 migrations list`) e aplique só ele. A 0007 depende
   apenas de `meta_ads_publish_locks` (0002), é só aditiva (cinco tabelas novas, nenhum
   `ALTER`) e usa `IF NOT EXISTS`, então repetir não quebra. O Worker atual não usa as
   tabelas novas: pode ir antes do Worker.
2. **Worker** com `META_ADS_OBJECTIVE_ROUTES_MODE = "off"`. Nada muda de comportamento;
   o deploy passa a registrar o gatilho agendado (produção e staging), que não faz
   nenhuma chamada com o modo `off`.
3. **Conferências com a Graph real, em staging**, antes de ligar: `timezone_name` da
   conta é `America/Sao_Paulo`; a listagem de campanhas sem filtro cabe em 2.000 itens;
   criação, ativação e pausa de uma rota de ponta a ponta.
4. **Política** das duas unidades (`PUT /policy`), com os tetos e o público.
5. **Modo `on`** (novo deploy da variável). A capacidade passa a ser anunciada e o
   monitor passa a rodar. O inventário do Publish não muda.
6. **Orb**, nesta ordem: (a) avisos de `unnotified_decisions`, `in_progress` e `monitor`
   e chamada de `ack_objective_route_notification`; (b) `CAMPAIGN_CREATE_MODE='paused'`;
   (c) Fase 3 (`OBJECTIVE_ACTIVATION_MODE='on'` e o gatilho de 10 minutos); (d) só para
   publicar nas rotas novas: listar o conjunto da rota no inventário e validar a entrada
   pelo objetivo (seção 7), e então o `enforce`.

Inverter 5 e 6 não quebra nada: sem a capacidade o workflow não gera pedido. O Orb nunca
vai antes do Worker com a migration aplicada.

**Rollback:** voltar o modo para `off`. As rotas param de aceitar pedidos e decisões.
Atenção: com o modo `off` o monitor também para, então **pause antes, no Gerenciador de
Anúncios, as rotas que estiverem ativas, em ativação ou com pausa pendente** (as listas
`in_progress` e as `ACTIVATED`), ou elas seguem gastando sem monitor. A migration não
precisa ser desfeita.

## 9. Riscos e limites

- **Limitador de mutações.** A `main` não tem o limitador de mutações da Graph que existe
  em produção. As rotas fazem poucas chamadas (2 `POST` na criação, 2 ou mais na
  ativação), mas não passam por ele nem pela guarda de cota das leituras.
- **Monitor cego não pausa.** Se a leitura da conta falhar por muito tempo, as rotas
  ativas seguem sem conferência. A falha fica no journal e em `monitor` na lista de
  pendências (`consecutive_failures`), mas ninguém é avisado até o workflow ler essa
  chave. Pausar por conta própria depois de N rodadas cegas é uma decisão em aberto.
- **Ativação interrompida gasta até a retomada.** Entre o timeout e a rodada do monitor
  que retoma ou pausa passam até ~40 minutos (10 de espera mais um ciclo de 30). Nesse
  tempo o conjunto pode gastar no ritmo do diário, que já está no comprometido.
- **Uma ativação pode fazer até 52 `POST`** (50 anúncios). Não há limitador nem teto de
  subrequisições por chamada do Worker; uma ativação cortada cai na retomada do monitor.
- **Ativação reativa todo anúncio `PAUSED` do conjunto**, inclusive um pausado à mão num
  conjunto reaproveitado depois do intervalo de 7 dias.
- **Conjunto reaproveitado** só tem nome, campanha, otimização e diário conferidos;
  público, lance e data de fim não.
- **Fuso da conta.** Se a conta real não estiver em `America/Sao_Paulo`, toda aprovação é
  bloqueada (final, com intervalo de 7 dias). Conferir antes de ligar (seção 8, passo 3).
- **Conjunto desconhecido conta em dobro.** É o lado seguro, mas uma campanha manual
  grande pode bloquear ativações das duas unidades até entrar em `adset_ids`.
- **O teto vale para ativar, não para o gasto.** A Meta pode gastar acima do diário; a
  margem de 10% e o monitor cobrem isso, com atraso de até 30 minutos.
- **Aumento manual de orçamento** depois da ativação só é visto pelo monitor.
- **Listagens grandes.** Mais de 2.000 conjuntos ou 5.000 linhas de Insights no mês
  invalidam a conta (`budget_inputs_invalid`), em vez de contar pela metade.
- **Insights tem atraso.** O gasto do dia pode chegar com minutos de atraso.
- Não testado contra a Graph real nem em staging: a listagem de campanhas sem filtro
  (se traz arquivadas por padrão e quantas páginas ocupa), o total de Insights por conta,
  o payload do conjunto por objetivo e o formato de `end_time` foram exercitados só com a
  conta falsa dos testes.
- **Aprovação humana não é verificável pelo Vault.** Qualquer portador do bearer
  operacional pode mandar `APPROVE` com o código que o próprio Vault devolve. A barreira
  dura de gasto é o teto, não a aprovação.
