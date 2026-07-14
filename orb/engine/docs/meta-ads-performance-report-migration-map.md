# Meta Ads Performance Report: Mapa de Migração

## Regra geral

- `entities`: contexto estrutural
- `metric_snapshots`: dado analítico principal
- `ingestion_audit`: metadado técnico e confiabilidade
- `raw_payloads`: replay e auditoria do bruto

## O que sai do modelo wide

Campos wide no formato:

- `campaign_last_7d_spend`
- `campaign_last_30d_clicks`
- `adset_last_24h_ctr`

Deixam de existir como colunas persistidas.

Agora viram linhas em `metric_snapshots` com:

- `entity_level`
- `metrics_window`
- `metric_name`
- `metric_value`

## O que virou entity

Campos estruturais/contextuais:

- `account_id`
- `campaign_id`
- `campaign_name`
- `adset_id`
- `adset_name`
- `ad_id`
- `ad_name`
- `creative_id`
- `creative_name`
- `page_id`
- `instagram_user_id`
- `campaign_objective`
- `optimization_goal`
- `destination_type`
- `bid_strategy`
- `billing_event`
- `buying_type`
- `status`
- `effective_status`
- `configured_status`

## O que virou snapshot

Métricas principais e diagnósticas:

- `spend`
- `reach`
- `impressions`
- `frequency`
- `clicks`
- `unique_clicks`
- `ctr`
- `unique_ctr`
- `cpc`
- `cpm`
- `cpp`
- `inline_link_clicks`
- `inline_link_click_ctr`
- `cost_per_inline_link_click`
- `unique_inline_link_clicks`
- `outbound_clicks`
- `outbound_clicks_ctr`
- `cost_per_outbound_click`
- `inline_post_engagement`
- `cost_per_inline_post_engagement`
- `social_spend`
- `instagram_profile_visits`
- `website_ctr`
- `purchase_roas_*`
- `website_purchase_roas_*`
- `video_*`
- ações e conversões normalizadas, por exemplo:
  - `conversation_started`
  - `first_reply`
  - `conversation_replied`
  - `messaging_depth_2`
  - `messaging_depth_3`
  - `messaging_depth_5`
  - `conversion_*`
  - `cost_per_*`
  - `cost_per_unique_*`

## O que virou auditoria

Sai da camada analítica principal e vai para `ingestion_audit`:

- `fetch_status_*`
- `row_count_*`
- `payload_hash`
- `raw_payload_reference`
- `processing_notes`
- warnings de consistência
- contagem de métricas com baixa confiança

## Duplicado x complementar

### Considerado duplicado

- mesma métrica semântica capturada por múltiplas variantes de origem para a mesma entidade/janela
- exemplos:
  - `spend` via `hourly` e `summary` em `last_24h`
  - `clicks` via `hourly` e `summary` em `last_24h`
  - `impressions` via `hourly` e `summary` em `last_24h`
  - `cost_per_*` repetido entre variantes quando representa o mesmo numerador/denominador

Regra aplicada:

- uma única representação principal em `metric_snapshots`
- variantes descartadas da camada principal entram em `duplication_report`

### Considerado complementar

- `reach` vs `impressions`
- `clicks` vs `inline_link_clicks` vs `outbound_clicks`
- `conversation_started` vs `first_reply` vs `messaging_depth_*`
- métricas breakdown com `dimension_key`/`dimensions_json`
- rankings de qualidade e métricas de recall

Essas métricas permanecem distintas.

## O que foi movido para auditoria

- origem do valor vencedor entre `summary`, `hourly` e `derived`
- hashes de payload
- referência R2
- sinais de erro de fetch
- warnings de inconsistência matemática

## O que foi descartado de verdade

Nenhuma métrica relevante foi descartada de propósito.

O que foi removido foi apenas:

- duplicação estrutural wide
- redundância entre variantes equivalentes
- mistura de dado técnico com dado analítico

## Plano de compatibilidade

Enquanto houver consumidores do Sheets:

- usar `compatibility_exports.summary_rows` para uma aba resumida
- usar `compatibility_exports.breakdown_rows` para debug/investigação
- tratar a exportação como job opcional de sync, não como armazenamento primário

## O que saiu do workflow hardcoded

Valores fixos removidos do JSON do workflow:

- bearer token da Meta Graph API
- account id da conta Meta
- URL do Worker
- token do Worker

Agora esses valores vêm de env no node `Params`:

- `META_ADS_ACCESS_TOKEN`
- `META_ADS_ACCOUNT_ID`
- `META_ADS_REPORT_WORKER_BASE_URL`
- `META_ADS_REPORT_WORKER_API_TOKEN`

## O que virou persistência real

O payload `storage_plan.worker.body` agora é enviado para o Worker.

Persistência principal:

- `entities`
- `metric_snapshots`
- `ingestion_audit`
- `raw_payloads`
- `metric_duplication_audit`
- `ingestion_runs`

Persistência opcional:

- `compatibility_exports.summary_rows`
- `compatibility_exports.breakdown_rows`
