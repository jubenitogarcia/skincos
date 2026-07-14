# Meta Ads Performance Report: Arquitetura Alvo

## Antes

O fluxo original estava organizado em torno de respostas da Meta Graph API, com transformação focada em consolidação operacional e, historicamente, uso de Google Sheets como superfície principal de consulta e armazenamento wide.

Problemas estruturais do modelo anterior:

- excesso de colunas wide por janela e por entidade
- mistura de métricas analíticas com metadados técnicos
- pouca separação entre contexto estrutural, auditoria e dado analítico
- rastreabilidade limitada sobre payload bruto, origem da métrica e consistência matemática
- baixa aderência para consumo futuro por IA

## Depois

O workflow foi refatorado para manter a topologia de coleta, mas agora termina em persistência real contra Cloudflare:

- `Build Insights`: gera jobs de coleta com contexto de entidade, identidade de requisição, chave de auditoria e referência de payload bruto
- `Normalize Metrics`: transforma cada resposta da API em:
  - `entity_records`
  - `metric_records`
  - `audit_fragment`
  - `raw_payload_record`
  - warnings de consistência
- `Consolidate Metrics`: deduplica, escolhe a representação primária das métricas, agrega auditoria por janela e monta:
  - `entities`
  - `metric_snapshots`
  - `ingestion_audit`
  - `raw_payloads`
  - `compatibility_exports`
  - `storage_plan`
- `Prepare Worker Persistence`: valida se existe body persistível, resolve URL/path/auth via variáveis e monta contrato HTTP explícito
- `If Worker Persistence Ready`: bloqueia execução quando faltar configuração ou payload útil
- `Persist to Worker`: envia `storage_plan.worker.body` via `POST`
- `Validate Worker Persistence`: trata 4xx/5xx explicitamente e só segue com sucesso quando o Worker confirma `ok=true`

## Topologia final do workflow

1. Meta Graph API
2. Code nodes de transformação
3. `Prepare Worker Persistence`
4. `If Worker Persistence Ready`
5. `Persist to Worker`
6. `Validate Worker Persistence`

Os nós de export compatível continuam desacoplados da persistência principal. `compatibility_exports` segue no payload, mas não bloqueia ingestão em D1/R2.

## Camadas de dados

### 1. Entities

Camada contextual/estrutural.

Guarda:

- account
- campaign
- adset
- ad
- creative

Com campos como:

- ids e nomes
- page_id
- instagram_user_id
- campaign_objective
- optimization_goal
- destination_type
- bid_strategy
- billing_event
- buying_type
- status/effective_status/configured_status

Essa camada não guarda métricas.

### 2. Metric Snapshots

Camada analítica principal.

Cada métrica vira uma linha com:

- `report_date`
- `entity_level`
- `entity_id`
- `metrics_window`
- `metric_name`
- `metric_value`
- `metric_group`
- `analytic_role`
- `value_type`
- `source_kind`

Campos adicionais preservam granularidade útil:

- `dimension_key`
- `dimensions_json`
- `source_variant`
- `source_metric_name`
- `confidence_status`
- `warning_codes_json`

### 3. Ingestion Audit

Camada técnica de confiabilidade.

Agrupa por entidade e janela:

- status de fetch summary/hourly/breakdown
- contagem de linhas por variante
- hash dos payloads
- referências de payload bruto
- notas de processamento
- contagem de warnings e low confidence

### 4. Raw Payloads

Camada de replay/auditoria.

O workflow agora prepara:

- hash do payload
- chave R2 sugerida
- corpo JSON bruto serializado
- metadados de fetch

O worker Cloudflare pode persistir isso em R2 e registrar a referência em D1.

## Por que a arquitetura é melhor

- separa dado analítico de dado técnico
- elimina dependência estrutural de planilha como fonte de verdade
- evita tabela wide com explosão de colunas
- melhora deduplicação e queryabilidade por entidade/janela/métrica
- preserva rastreabilidade via `request_key`, `audit_key` e `payload_hash`
- prepara o dataset para filtros e análises futuras por IA

## Fluxo alvo de ingestão

1. Coleta Meta Graph API
2. Validação de payload/resposta
3. Preparação opcional de persistência do bruto em R2
4. Normalização para modelo interno
5. `POST /ingest/meta-ads-performance-report`
6. Upsert de `entities`
7. Upsert de `metric_snapshots`
8. Upsert de `ingestion_audit`
9. Registro de `metric_duplication_audit`
10. Registro de `ingestion_runs`
11. Export compatível opcional para Sheets/CSV

## Commit e reconciliação

O Worker agora explicita o progresso operacional em `ingestion_runs` para reduzir ambiguidade em falhas parciais.

Campos novos:

- `phase`
- `last_successful_phase`
- `attempt_count`
- `last_request_id`
- `r2_status`
- `d1_status`
- `processing_warnings_json`

Estratégia:

1. aceita a requisição e registra `in_progress`
2. sincroniza payload bruto em R2
3. grava fases D1 por blocos lógicos
4. marca `completed` somente no fim

Se uma segunda requisição com a mesma `Idempotency-Key` chegar enquanto a primeira ainda estiver ativa:

- o Worker responde `202 inProgress`
- não inicia uma segunda persistência concorrente

Se uma tentativa falhar no meio:

- os upserts mantêm a camada analítica sem duplicação estrutural
- `phase` e `last_successful_phase` mostram exatamente até onde a ingestão avançou

## Persistência Cloudflare

Implementação real:

- Worker deployável: [src/index.js](/Users/jubenitogarcia/Automation/skincos/backend/apps/meta-ads/apps/report-ingest-worker/src/index.js)
- Wrangler config: [wrangler.toml](/Users/jubenitogarcia/Automation/skincos/backend/apps/meta-ads/apps/report-ingest-worker/wrangler.toml)
- Migration D1: [0001_initial.sql](/Users/jubenitogarcia/Automation/skincos/backend/apps/meta-ads/apps/report-ingest-worker/migrations/0001_initial.sql)

Espelhos de referência no repo n8n:

- schema D1: [meta-ads-performance-report.sql](/Users/jubenitogarcia/Automation/n8n/cloudflare/d1/meta-ads-performance-report.sql)
- worker mirror: [meta-ads-performance-report-worker.js](/Users/jubenitogarcia/Automation/n8n/cloudflare/meta-ads-performance-report-worker.js)

Deploys ativos:

- produção: [skincos-meta-ads-performance-report.skincos.workers.dev](https://skincos-meta-ads-performance-report.skincos.workers.dev)
- staging: [skincos-meta-ads-performance-report-staging.skincos.workers.dev](https://skincos-meta-ads-performance-report-staging.skincos.workers.dev)

## Configuração e segredos

O workflow não carrega mais segredos hardcoded no JSON:

- Meta Graph API usa `META_ADS_ACCESS_TOKEN` via node `Params`
- conta e versão usam `META_ADS_ACCOUNT_ID` e `META_ADS_API_VERSION`
- persistência usa `META_ADS_REPORT_WORKER_BASE_URL` e `META_ADS_REPORT_WORKER_API_TOKEN`

No Worker:

- autenticação usa secret `WORKER_API_TOKEN`
- cabeçalho e esquema são configuráveis por `WORKER_AUTH_HEADER_NAME` e `WORKER_AUTH_SCHEME`

## Compatibilidade temporária

O workflow monta `compatibility_exports` com:

- `summary_rows`
- `breakdown_rows`

Esses objetos podem alimentar:

- Google Sheets resumido
- CSV operacional
- dashboard temporário

Sem recolocar o Sheets como storage principal.
