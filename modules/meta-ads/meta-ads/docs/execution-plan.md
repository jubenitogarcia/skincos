# Execution Plan (Detalhado por Epico)

## Fase 2 - Epicos e Tarefas

### Epico F2-1: Rules Engine
1. Modelagem
   - Criar tabela `automation_rules` (migracao Prisma)
   - Campo `conditions`, `actions`, `schedule`, `guardrails`
2. API
   - CRUD de regras
   - Endpoint dry-run (simulacao)
3. Worker
   - Scheduler por regra
   - Executor com rate limit
4. UI
   - Listagem + criação simples
5. QA
   - Testes unitarios de avaliador de regras

### Epico F2-2: Insights Avancados
1. Meta gateway
   - Suporte a breakdowns e filtros
2. Storage
   - Nova tabela `insights_breakdown`
3. API
   - Endpoints de query
4. UI
   - Filtros + breakdowns + CSV export

### Epico F2-3: Templates + Duplicacao Profunda
1. Meta wrapper
   - Parametros de `createCopy` com rename_options
2. API
   - Preview e execucao de duplicacao profunda
3. UI
   - Template builder

### Epico F2-4: CAPI Server-Side
1. Endpoints ingest
2. Deduplicacao com event_id
3. Monitoramento e alertas

---

## Fase 3 - Epicos e Tarefas

### Epico F3-1: Forecast
1. Modelos simples (prophet, regressao)
2. Ajuste de budget automatico

### Epico F3-2: MMM / Robyn
1. Pipeline data lake + Robyn
2. Relatorios executivos

### Epico F3-3: Leads + WhatsApp
1. Ingestao leads
2. Orquestracao de atendimento
3. SLA dashboards
