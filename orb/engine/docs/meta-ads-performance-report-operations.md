# Meta Ads Performance Report: Operação, Deploy e Testes

## Workflow atualizado

Snapshot local sincronizado:

- [meta-ads.performance-report.live-synced.json](/Users/jubenitogarcia/Automation/n8n/workflows/meta-ads.performance-report.live-synced.json)
- [meta-ads.performance-report.json](/Users/jubenitogarcia/Automation/n8n/workflows/meta-ads.performance-report.json)

Nós finais adicionados:

- `Prepare Worker Persistence`
- `If Worker Persistence Ready`
- `Persist to Worker`
- `Validate Worker Persistence`
- `Fail Worker Persistence Config`

## Configuração no n8n

O workflow não usa mais `$env` dentro de nodes. A configuração operacional foi dividida entre `Variables` e `Credentials` nativos do n8n.

### Variables

Configurar no projeto do workflow:

- `META_ADS_ACCOUNT_ID`
- `META_ADS_API_VERSION`
- `META_ADS_REPORT_MODE`
- `META_ADS_REPORT_ENVIRONMENT`
- `META_ADS_REPORT_STORAGE_MODE`
- `META_ADS_REPORT_WORKER_BASE_URL`
- `META_ADS_REPORT_WORKER_PERSIST_PATH`
- `META_ADS_REPORT_WORKER_AUTH_HEADER`
- `META_ADS_REPORT_WORKER_AUTH_SCHEME`
- `META_ADS_REPORT_WORKER_TIMEOUT_MS`
- `META_ADS_REPORT_D1_DATABASE_NAME`
- `META_ADS_REPORT_R2_BUCKET_NAME`
- `META_ADS_REPORT_RAW_PAYLOADS_ENABLED`
- `META_ADS_REPORT_COMPAT_EXPORT_ENABLED`
- `META_ADS_REPORT_COMPAT_EXPORT_TARGET`
- `META_ADS_REPORT_INVENTORY_ENABLED`
- `META_ADS_REPORT_INVENTORY_FRESHNESS_HOURS`
- `META_ADS_REPORT_INVENTORY_ADS_LIMIT`

Valores recomendados para o caminho incremental:

- `META_ADS_REPORT_INVENTORY_ENABLED=false`
- `META_ADS_REPORT_INVENTORY_FRESHNESS_HOURS=168`
- `META_ADS_REPORT_INVENTORY_ADS_LIMIT=500`

Observação:

- o workflow agora sabe consultar inventário de ads já persistido no Worker
- esse caminho fica desligado por padrão até existir inventário real confiável no D1
- quando ligado, ele tenta reaproveitar ads persistidos antes de fazer a descoberta completa `campaigns -> adsets -> ads`

### Credentials

Configurar no n8n como `httpBearerAuth`:

- `Meta Ads Performance Report - Meta Graph Bearer`
- `Meta Ads Performance Report - Worker Bearer`

Uso no workflow:

- todos os nós HTTP da Meta usam `genericCredentialType -> httpBearerAuth`
- `Persist to Worker` usa `genericCredentialType -> httpBearerAuth`

Instância local atual:

- arquivo: [n8n/.env](/Users/jubenitogarcia/Automation/n8n/.env)
- o `.env` segue existindo como fonte operacional local, mas não é mais lido por expressão dentro do workflow
- reinício do n8n é necessário após mudança de env ou após escrita direta nas `variables` do banco

Template compartilhado:

- [skincos/n8n/.env.example](/Users/jubenitogarcia/Automation/skincos/n8n/.env.example)

## Worker Cloudflare

Projeto:

- [report-ingest-worker](/Users/jubenitogarcia/Automation/skincos/backend/apps/meta-ads/apps/report-ingest-worker)

Arquivos principais:

- [src/index.js](/Users/jubenitogarcia/Automation/skincos/backend/apps/meta-ads/apps/report-ingest-worker/src/index.js)
- [wrangler.toml](/Users/jubenitogarcia/Automation/skincos/backend/apps/meta-ads/apps/report-ingest-worker/wrangler.toml)
- [0001_initial.sql](/Users/jubenitogarcia/Automation/skincos/backend/apps/meta-ads/apps/report-ingest-worker/migrations/0001_initial.sql)
- [0002_ingestion_run_phases.sql](/Users/jubenitogarcia/Automation/skincos/backend/apps/meta-ads/apps/report-ingest-worker/migrations/0002_ingestion_run_phases.sql)

Bindings:

- `META_ADS_DB`
- `META_ADS_RAW_PAYLOADS`

Secrets/vars no Worker:

- secret `WORKER_API_TOKEN`
- var `REQUIRE_AUTH`
- var `WORKER_AUTH_HEADER_NAME`
- var `WORKER_AUTH_SCHEME`
- var `ENVIRONMENT`
- var `LOG_LEVEL`

## URLs ativas

- produção: [https://skincos-meta-ads-performance-report.skincos.workers.dev](https://skincos-meta-ads-performance-report.skincos.workers.dev)
- staging: [https://skincos-meta-ads-performance-report-staging.skincos.workers.dev](https://skincos-meta-ads-performance-report-staging.skincos.workers.dev)

Health:

- `GET /health`

Contrato:

- `GET /contract/meta-ads-performance-report`

Inventário incremental:

- `GET /inventory/meta-ads-performance-report?account_id=...&freshness_hours=...&limit=...`

Leitura para relatório operacional (workflow 2):

- `GET /report/meta-ads-performance-report?account_id=...&report_date=YYYY-MM-DD&windows=last_24h,last_7d,last_30d&include=summary|breakdown|both&limit=...`

## Contrato HTTP n8n -> Worker

Método:

- `POST`

Endpoint:

- `/ingest/meta-ads-performance-report`

Endpoint opcional de inventário:

- `/inventory/meta-ads-performance-report`

Endpoint opcional de leitura de relatório:

- `/report/meta-ads-performance-report`

Query do inventário:

- `account_id` obrigatório
- `freshness_hours` opcional
- `limit` opcional

Query da leitura de relatório:

- `account_id` obrigatório
- `report_date` opcional (default: ontem UTC)
- `windows` opcional (csv, default: `last_24h,last_7d,last_30d`)
- `include` opcional (`summary`, `breakdown`, `both`)
- `limit` opcional

Resposta de inventário:

```json
{
  "ok": true,
  "count": 1,
  "inventory": {
    "source": "d1",
    "entity_kind": "ad",
    "account_id": "3271664739829465",
    "freshness_hours": 168
  },
  "items": []
}
```

Resposta de leitura de relatório:

```json
{
  "ok": true,
  "requestId": "uuid",
  "metadata": {
    "source": "d1",
    "account_id": "3271664739829465",
    "report_date": "2026-04-05",
    "windows": ["last_24h", "last_7d", "last_30d"],
    "include": "both",
    "runs_count": 42
  },
  "summary_rows": [],
  "breakdown_rows": []
}
```

Uso operacional:

- se `count > 0`, o workflow pode começar direto do nível de `ad`
- se `count = 0` ou o fetch falha, o workflow faz fallback para a descoberta completa na Meta

Headers obrigatórios:

- `Content-Type: application/json`
- `Idempotency-Key: <run_id>:<metrics_group_key>`
- `Authorization: Bearer <WORKER_API_TOKEN>`

Headers auxiliares emitidos pelo workflow:

- `X-Workflow-Run-Id`
- `X-Metrics-Group-Key`
- `X-Workflow-Environment`

Body:

- `run`
- `entities`
- `metric_snapshots`
- `ingestion_audit`
- `raw_payloads`
- `compatibility_exports` opcional
- `duplication_report` opcional

Resposta de sucesso:

```json
{
  "ok": true,
  "requestId": "uuid",
  "results": {
    "entities_upserted": 5,
    "metric_snapshots_inserted": 37,
    "audit_rows_inserted": 1,
    "raw_payloads_written": 1,
    "raw_payload_rows_upserted": 1,
    "duplication_rows_upserted": 3,
    "warnings_count": 3,
    "duplication_count": 3,
    "idempotency_key": "run:group"
  }
}
```

Resposta de replay idempotente:

```json
{
  "ok": true,
  "idempotentReplay": true,
  "requestId": "uuid",
  "results": {}
}
```

Resposta de concorrência segura:

```json
{
  "ok": true,
  "inProgress": true,
  "requestId": "uuid",
  "phase": "raw_payload_sync_started",
  "lastSuccessfulPhase": "",
  "previousRequestId": "uuid",
  "results": {
    "status": "in_progress",
    "phase": "raw_payload_sync_started",
    "attempt_count": 1
  }
}
```

## Workflow 2: Execução ponta a ponta comprovada

Workflow canônico validado:

- [meta-ads.performance-report-2.live.current.json](/Users/jubenitogarcia/Automation/n8n/workflows/meta-ads.performance-report-2.live.current.json)
- workflow salvo no n8n: `Meta Ads – Performance Report (2)`
- `workflowId`: `xN8juRoQBMa4JKOd`

Execução validada:

- `executionId`: `15491`
- início: `2026-04-07 01:20:48`
- fim: `2026-04-07 01:22:28`
- status: `success`

Provas objetivas da execução:

- coleta do relatório no Worker:
  - `Normalize Summary Rows`: `2` linhas
  - `Normalize Breakdown Rows`: `642` linhas
  - `Code - Analytics Core`:
    - `entity_type=ad`
    - `category=atencao`
    - `total_entities=2`
    - `pipeline_audit.summary_rows=2`
    - `pipeline_audit.breakdown_rows=642`
    - `report_completeness=partial`
- processamento de IA:
  - nó `Livia` executado com `3` saídas
  - estrutura retornada: `output.group_analysis` e `output.entity_reviews`
  - amostra do resumo:
    - `group_summary`: “Não há imagem/preview/thumbnail e também não há cópia (...) A decisão matemática de restringir/bloquear por confiança/coleta fica, portanto, neutra do ponto de vista subjetivo...”
  - amostra de review:
    - `entity_id=120239759733500157`
    - `math_action=REQUEST_HUMAN_REVIEW`
- envio WhatsApp:
  - nó `Gestor Tráfego` executado com `3` saídas
  - todas retornaram payload real da Evolution API
  - `remoteJid=555195103563@s.whatsapp.net`
  - `status=PENDING`
  - `messageType=conversation`
  - `instanceId=dbacee2f-2ad5-4682-99b9-7090cba4d49b`

Exemplo resumido da mensagem enviada:

```text
*Meta Ads – Performance Report (2)*
2026_04_06__ad__atencao
Não há imagem/preview/thumbnail e também não há cópia (...)
Focos prioritários:
1. Recuperar o asset real do criativo (...)
```

Decisões operacionais aplicadas no workflow 2 para fechar a execução:

- `Get Creative` foi reduzido para campos estáveis da Graph API
- o contexto do creative passou a ser recomposto em `Merge Creative Context`
- `Get Image` deixou de tentar download real quando a mídia não está disponível e passou a preservar o item para fallback analítico
- `Gestor Tráfego` deixou de usar o node Evolution customizado para envio textual e passou a usar `HTTP Request` direto contra a Evolution API
- o payload de WhatsApp passou a usar o contrato real da Evolution:
  - `POST /message/sendText/{instance}`
  - body com `number` e `text`

Variáveis adicionais usadas pelo workflow 2:

- `EVOLUTION_API_BASE_URL`
- `EVOLUTION_API_KEY`

Contrato de envio validado manualmente:

```bash
curl -X POST "http://localhost:8080/message/sendText/crm-channel-1" \
  -H "Content-Type: application/json" \
  -H "apikey: $EVOLUTION_API_KEY" \
  -d '{
    "number": "555195103563",
    "text": "Teste Codex workflow 2"
  }'
```

Regeneração dos snapshots locais:

- alterar o workflow exportado em branch dedicada e validar o contrato antes da importação
- o script agora parte de [meta-ads.performance-report-2.live.current.json](/Users/jubenitogarcia/Automation/n8n/workflows/meta-ads.performance-report-2.live.current.json), sincroniza os helpers externos ainda usados e grava [meta-ads.performance-report-2.live.implemented.json](/Users/jubenitogarcia/Automation/n8n/workflows/meta-ads.performance-report-2.live.implemented.json)
- ele não recria mais uma topologia paralela nem reintroduz nós antigos; o browser/n8n salvo continua sendo a fonte da verdade

## Workflow 2 validado novamente

Validação final executada em `2026-04-07` para o workflow salvo no n8n:

- workflow: `Meta Ads – Performance Report (2)`
- id: `xN8juRoQBMa4JKOd`
- execução final confirmada: `15506`
- status: `success`
- janela da execução: `2026-04-07T16:46:25.831Z` até `2026-04-07T16:47:45.363Z`

Evidências operacionais:

- coleta:
  - `Normalize Summary Rows = 2`
  - `Normalize Breakdown Rows = 62`
- IA:
  - `Livia = 3` saídas
  - grupos gerados:
    - `2026_04_06__ad__atencao`
    - `2026_04_06__adset__atencao`
    - `2026_04_06__campaign__atencao`
- WhatsApp:
  - `Gestor Tráfego = 3` envios
  - todos com:
    - `remoteJid = 555195103563@s.whatsapp.net`
    - `status = PENDING`
    - `messageType = conversation`

Correções que destravaram essa validação:

- o Worker publicado em produção estava sem a rota `GET /report/meta-ads-performance-report`
- o código canônico do Worker em [src/index.js](/Users/jubenitogarcia/Automation/skincos/backend/apps/meta-ads/apps/report-ingest-worker/src/index.js) foi realinhado com o espelho local e redeployado em produção
- a Evolution API estava saudável, mas a instância `crm-channel-1` estava fechada no runtime
- após reinício/reidratação do processo da Evolution, `crm-channel-1` voltou para `state = open`
- envio manual via `POST /message/sendText/crm-channel-1` foi validado novamente antes do rerun final

Resposta de erro:

```json
{
  "ok": false,
  "error": "invalid_body",
  "message": "Invalid ingestion payload.",
  "requestId": "uuid",
  "issues": []
}
```

Idempotência:

- `Idempotency-Key` é obrigatório
- `ingestion_runs.idempotency_key` é a chave primária operacional
- replay de uma ingestão já concluída retorna `idempotentReplay: true`
- retry concorrente da mesma chave durante uma ingestão ainda ativa retorna `202` com `inProgress: true`

Retry seguro:

- o node `Persist to Worker` faz retry
- o retry é seguro porque o Worker usa upsert e replay idempotente

Observabilidade operacional no D1:

- `ingestion_runs.phase`
- `ingestion_runs.last_successful_phase`
- `ingestion_runs.attempt_count`
- `ingestion_runs.last_request_id`
- `ingestion_runs.r2_status`
- `ingestion_runs.d1_status`
- `ingestion_runs.processing_warnings_json`

## Regressão corrigida no workflow principal

Workflow afetado:

- [meta-ads.performance-report.live-synced.json](/Users/jubenitogarcia/Automation/n8n/workflows/meta-ads.performance-report.live-synced.json)
- workflow salvo no n8n: `Meta Ads - Performance Report`
- `workflowId`: `yTatSnzUqtKuAjuM`

Causa raiz:

- o sincronizador [sync-meta-ads-performance-report-workflow.js](/Users/jubenitogarcia/Automation/n8n/scripts/sync-meta-ads-performance-report-workflow.js) estava reintroduzindo field sets antigos e incompatíveis nos fetches de detalhe da Graph API
- isso reabriu erros `(#100) Tried accessing nonexisting field (...)` em `Get Creative` e `Get Ad`

Field sets estáveis adotados:

- `Get Ad`: `id,name,status`
- `Get Creative`: `id,name,status,account_id`
- `Get AdSet`: `id,name,campaign_id,account_id`

Travas de regressão adicionadas no sincronizador:

- allowlist estável por nó para `Get Ad`, `Get Creative` e `Get AdSet`
- bloqueio explícito de campos banidos, incluindo:
  - `effective_instagram_media_id`
  - `thumbnail_url`
  - `object_id`
  - `asset_feed_spec`
  - `effective_status`
  - `configured_status`

Validação executada:

- os snapshots locais foram regenerados
- o workflow salvo no n8n foi sincronizado com o snapshot canônico
- a execução `15498` avançou além dos erros antigos da Meta e só falhou depois, no Worker, com `D1_ERROR: UNIQUE constraint failed: metric_snapshots.snapshot_key`

## Ajuste operacional de raw payloads

Para evitar nova retenção longa na etapa opcional de payload bruto:

- a variável live `META_ADS_REPORT_RAW_PAYLOADS_ENABLED` foi ajustada para `false`
- o code node [consolidate-metrics.js](/Users/jubenitogarcia/Automation/n8n/workflow-src/meta-ads-performance-report/consolidate-metrics.js) agora respeita essa configuração e remove `raw_payloads` do `storage_plan.worker.body` quando a flag estiver desligada
- a execução `15500` terminou com `success` e o nó `Prepare Worker Persistence` já saiu com `requestBody.raw_payloads = []`

Observação:

- o `run_id` do workflow principal é estável por recorte lógico
- por isso a execução `15500` recebeu replay idempotente do Worker para o mesmo recorte de `2026-04-07`, e o resumo retornado ainda reflete a gravação anterior com `raw_payloads_written = 69`
- isso não invalida o ajuste: o request efetivamente gerado pelo workflow atualizado já foi validado com `raw_payloads = 0`

## Deploy

Dentro de [report-ingest-worker](/Users/jubenitogarcia/Automation/skincos/backend/apps/meta-ads/apps/report-ingest-worker):

```bash
wrangler d1 migrations apply skincos-meta-ads-performance-report --remote
wrangler d1 migrations apply skincos-meta-ads-performance-report-staging --remote --env staging
wrangler secret put WORKER_API_TOKEN
wrangler secret put WORKER_API_TOKEN --env staging
wrangler deploy
wrangler deploy --env staging
```

## Teste local

Executar o Worker localmente:

```bash
cd /Users/jubenitogarcia/Automation/skincos/backend/apps/meta-ads/apps/report-ingest-worker
wrangler dev
```

No n8n local, apontar:

- `META_ADS_REPORT_WORKER_BASE_URL=http://127.0.0.1:8787`
- `META_ADS_REPORT_ENVIRONMENT=local`

## Validação ponta a ponta

Validações já executadas nesta etapa:

- deploy do Worker em produção e staging
- migration D1 aplicada nos dois bancos
- execução real ponta a ponta do workflow `15458` concluída com sucesso
- replay idempotente confirmado sem duplicar `metric_snapshots`
- teste concorrente confirmado: segunda chamada com a mesma `Idempotency-Key` recebeu `202 inProgress`
- `GET /health` em produção
- `GET /contract/meta-ads-performance-report` em produção
- POST real com payload gerado pelos code nodes do workflow
- replay idempotente confirmado
- contagem em D1 confirmada para `entities`, `metric_snapshots`, `ingestion_audit`, `raw_payloads`, `metric_duplication_audit`, `ingestion_runs`

## Observabilidade e falha

No workflow:

- falha explícita se faltar URL/body persistível
- falha explícita se o Worker responder 4xx/5xx ou `ok=false`

No Worker:

- logs estruturados para `ingestion_started`, `ingestion_completed`, `ingestion_failed`
- `requestId` em todas as respostas
- `last_error` persistido em `ingestion_runs`

## Export compatível

`compatibility_exports` permanece no body, mas não é persistência principal.

Uso sugerido:

- sync opcional para Google Sheets resumido
- CSV operacional
- debug manual

## Workflow 2: split determinístico vs IA

No workflow [meta-ads.performance-report-2.live.current.json](/Users/jubenitogarcia/Automation/n8n/workflows/meta-ads.performance-report-2.live.current.json), a análise agora foi separada em dois ramos:

- `Code - Visual Enrichment Prepare` monta a leitura determinística final do grupo
- `Needs Subjective AI Review` decide se aquele grupo precisa mesmo de interpretação subjetiva
- `Livia` só roda quando `requires_subjective_ai_review=true`
- `Gestor Tráfego` sempre envia a mensagem determinística base e anexa a leitura da IA apenas quando existir `output.group_analysis`

Regra operacional adotada:

- grupos `campaign` e `adset` são tratados como agregados determinísticos
- grupos `ad` só seguem para IA quando houver evidência visual utilizável
- sem evidência visual, o grupo segue direto para entrega, sem desperdiçar tokens da IA

Evidência validada:

- execução `15514` do workflow `Meta Ads – Performance Report (2)` terminou com `success`
- `Normalize Summary Rows = 2`
- `Normalize Breakdown Rows = 62`
- `Code - Analytics Core = 3` grupos
- `Code - Visual Enrichment Prepare = 3` grupos
- `Needs Subjective AI Review` roteou `0` itens para IA e `3` itens para o ramo determinístico
- `Livia` não foi executado nessa rodada porque não havia evidência visual suficiente
- `Gestor Tráfego = 3` envios com `status=PENDING` para `555195103563@s.whatsapp.net`

Arquiteturalmente, isso evita que métricas e decisões matemáticas sejam reenviadas para interpretação desnecessária da IA. A IA fica reservada apenas para leitura criativa e subjetiva quando o payload realmente contém contexto visual suficiente.
