# Roadmap de Execucao (MVP → Fase 2 → Fase 3)

Este documento traduz a matriz de prioridade em etapas executaveis, com entregaveis, criterios de aceite e metricas de sucesso.

## Visao Geral

### Fase MVP (0 → 1)
Objetivo: usar em producao com seguranca e ganhos claros de produtividade.

### Fase 2 (1 → N)
Objetivo: escalar com automacoes, insights ricos e menos trabalho manual.

### Fase 3 (N → performance machine)
Objetivo: previsao, otimizacao automatica e ciencia aplicada.

---

## Fase MVP (Status: entregue parcialmente)

### MVP-1: Core Ads + Bulk Actions
**Entregaveis**
- Listagem e cache de campanhas/adsets/ads.
- Bulk pause/resume, budget e rename com preview.
- Execucao em background com chunks e status por item.

**Criterios de aceite**
- Operacao em lote com preview e log de resultados por item.
- Processo resiliente com retry e status de operacao.

**Metricas**
- Tempo medio de execucao por 100 itens.
- Taxa de falha por item < 2% (com motivos claros).

**Status**: entregue (MVP atual).

### MVP-2: Insights basicos e dashboard
**Entregaveis**
- Sync diario de insights por nivel.
- Dashboard com spend, ROAS e tendencia 7/14/30 dias.

**Criterios de aceite**
- Dashboard mostra dados reais quando ha insights.

**Metricas**
- Tempo de sync dos ultimos 7 dias.
- Consistencia entre UI e dados persistidos.

**Status**: entregue (MVP atual).

### MVP-3: Pacing + Alertas basicos
**Entregaveis**
- Job de pacing e alertas (gasto acelerado e no-spend).
- UI de alerts com resolucao.

**Criterios de aceite**
- Alertas criados e exibidos com base em dados reais.

**Status**: entregue (MVP atual).

### MVP-4: Auth + RBAC + Auditoria
**Entregaveis**
- Login local e RBAC por org.
- Audit logs basicos.

**Status**: entregue (MVP atual).

---

## Fase 2 (Escala e Automacao)

### F2-1: Rules Engine (If/Then)
**Objetivo**: reduzir operacao manual com regras automatizadas.

**Escopo**
- CRUD de regras.
- Condicoes: pacing, CPA, ROAS, spend, time window.
- Acoes: pause/resume, budget, rename, notify.
- Guardrails: limite max de alteracoes/dia e dry-run.

**Entregaveis**
- Tabelas `alert_rules` evoluidas para `automation_rules`.
- UI simples para criar e ativar regras.
- Worker executa regras em janelas definidas.

**Criterios de aceite**
- 3 regras ativas em producao sem regressao.
- Modo simulacao antes de aplicar.

**Metricas**
- Reducao de operacao manual (horas/semana).
- Taxa de falsos positivos < 10%.

---

### F2-2: Insights Avancados + Breakdowns
**Objetivo**: aumentar profundidade de analise.

**Escopo**
- Breakdowns: placement, age, gender, device.
- Normalizacao de actions (CPA/CPP por objetivo).
- Export CSV e saved views.

**Criterios de aceite**
- Relatorios com filtros e breakdowns disponiveis na UI.

**Metricas**
- Tempo de resposta < 2s (p95) para queries comuns.

---

### F2-3: Duplicacao Profunda + Templates
**Objetivo**: acelerar criacao de campanhas.

**Escopo**
- Duplicar campanha com adsets e ads.
- Templates com prefix/suffix, budgets predefinidos.

**Criterios de aceite**
- Criar 3 campanhas a partir de template em < 5 min.

---

### F2-4: CAPI Server-Side + Deduplicacao
**Objetivo**: melhorar tracking e confiabilidade.

**Escopo**
- Endpoint CAPI com event_id.
- Deduplicacao Pixel + CAPI.
- Logs e monitoramento.

**Criterios de aceite**
- Taxa de deduplicacao > 90%.

---

## Fase 3 (Performance Machine)

### F3-1: Forecast & Budget Automation
**Objetivo**: prever gasto e ajustar budget automaticamente.

**Escopo**
- Modelos simples de forecast.
- Regras automaticas de rebalanco.

**Metricas**
- Erro medio de forecast < 15%.

---

### F3-2: MMM / Robyn (Camada Ciencia)
**Objetivo**: atribuir impacto real por canal.

**Escopo**
- Pipeline Robyn.
- Integra dados offline e macro.

**Metricas**
- Insights acionaveis por trimestre.

---

### F3-3: Orquestracao de Leads (WhatsApp)
**Objetivo**: fechar ciclo lead → atendimento.

**Escopo**
- Captura, roteamento e SLA.
- Integracao WhatsApp Cloud API.

**Metricas**
- Tempo medio de resposta < 5 min.

---

## Sequencia Recomendada

1. F2-1 Rules Engine
2. F2-2 Insights Avancados
3. F2-3 Duplicacao Profunda + Templates
4. F2-4 CAPI Server-Side
5. F3-1 Forecast + Budget Automation
6. F3-2 MMM / Robyn
7. F3-3 WhatsApp Orchestration
