# 📘 WhatsApp Enterprise API - Especificação de Implementação

Versão: 0.1 (Blueprint)
Status: Proposta Inicial
Data: 2025-08-09

## 🎯 Objetivo
Evoluir a API atual (endpoints básicos: /status, /send, /chats, /webhook, /qr) para uma Plataforma Enterprise completa com autenticação segura, multitenancy, automação, CRM, templates, analytics e governança.

---
## 🧱 Arquitetura Recomendada (High Level)

| Camada | Tecnologia Recomendada | Função |
|--------|------------------------|--------|
| API Gateway / Edge | Traefik + Rate Limit Middleware | Roteamento, TLS, limits básicos |
| Autenticação | JWT (Access + Refresh) + OAuth2 (Keycloak / Auth0 opcional) | Emissão e validação de tokens |
| Core API | Node.js (Express/Fastify) | Endpoints REST v1 |
| Mensageria / Filas | Redis Streams ou RabbitMQ | Fila de envio / retries |
| Cache & Sessions | Redis | Rate limit, tokens revogados, webhooks pendentes |
| Banco Principal | PostgreSQL | Persistência relacional (contatos, mensagens metadados, templates) |
| Armazenamento Mídia | S3 compatível (MinIO / AWS S3) | Arquivos grandes / caching |
| Logs & Auditoria | PostgreSQL (tabela audit) + Loki/Elastic | Compliance / rastreabilidade |
| Analytics | Materialized Views + ClickHouse (opcional) | Agregações de alto volume |
| Observabilidade | Prometheus + Grafana | Métricas técnicas |

---
## 🗂️ Fases de Implementação (Roadmap)

| Fase | Objetivo | Blocos | Critério de Conclusão |
|------|----------|--------|----------------------|
| 1 | Fundamentos Seguros | Auth, Accounts, Phone Numbers, Webhooks básicos | Tokens, RBAC inicial, webhooks entregues |
| 2 | Mensagens Core | POST/GET Messages, fila, status updates | 99% entrega, retries configurados |
| 3 | CRM & Contatos | CRUD contatos + sync | Sincronização incremental estável |
| 4 | Templates & Campanhas | Templates + segments + campaigns | Envio segmentado auditável |
| 5 | Automação & Flows | Flows, triggers, keywords | Engine determinística com fallback humano |
| 6 | Analytics & Insights | Métricas + dashboards | KPIs exportáveis / CSV / API |
| 7 | Segurança Avançada | 2FA, Audit, Compliance | Relatório auditoria filtrável |
| 8 | Multicanal & Escala | Múltiplos números + canais | Isolamento por tenant garantido |

---
## 🔐 Autenticação & Segurança

### Endpoints (Fase 1 / 7)
| Método | Endpoint | Descrição | Auth | Notas |
|--------|----------|-----------|------|-------|
| POST | /v1/auth/token | Emite access + refresh | Basic / OAuth2 | Suporta 2FA opcional |
| POST | /v1/auth/refresh | Novo access a partir do refresh | Refresh token | Rotação obrigatória |
| POST | /v1/auth/2fa/verify | Valida segundo fator | JWT parcial | TTL curto |
| GET | /v1/business_accounts/{id} | Info da conta | JWT | Escopo accounts:read |
| POST | /v1/phone_numbers | Registro/verificação número | JWT | Workflow assíncrono |

### RBAC (Roles sugeridos)
- admin: gestão total tenant
- manager: campanhas, templates, relatórios
- agent: atendimento e mensagens
- auditor: leitura de logs e analytics

### Storage de Credenciais
- Hash de senhas: Argon2id
- Refresh tokens: lista branca em Redis
- Revogação: chave jti -> expiração antecipada

---
## 💬 Mensagens (Fase 2)

### Endpoints
| Método | Endpoint | Função |
|--------|----------|--------|
| POST | /v1/messages | Envio unificado (text, image, document, audio, video, location, contact) |
| GET | /v1/messages | Listar/historizar (filtros: date_from, date_to, type, status, contactId, direction) |
| GET | /v1/messages/{id} | Detalhe + metadata |
| PUT | /v1/messages/{id}/status | Atualização manual (fallback) |
| POST | /v1/messages/bulk | Envio em massa segmentado |
| POST | /v1/messages/schedule | Agendamento futuro |

### Pipeline de Envio
1. Validação payload
2. Normalização (E.164 número)
3. Persistência (status=queued)
4. Push fila (Redis Stream XADD / RabbitMQ)
5. Worker envia para WhatsApp (biblioteca atual)
6. Atualiza status (sent/delivered/read/failed)
7. Dispara webhooks
8. Index para analytics

### Status Possíveis
queued → sending → sent → delivered → read → failed (retriable / permanent)

### Rate Limiting
- Token Bucket por (tenant, type)
- Padrão: 20 msg texto/min; mídia 10/min; burst 5

---
## 🧩 Templates & Estruturadas (Fase 4)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | /v1/message_templates | Lista templates aprovados |
| POST | /v1/message_templates | Cria template (estado=pending) |
| GET | /v1/message_templates/{id} | Detalhe + versões |
| PUT | /v1/message_templates/{id} | Atualiza rascunho |
| POST | /v1/message_templates/{id}/submit | Submete aprovação |

Campos Chave: name, category (marketing|utility|authentication), language, body, header(optional), footer(optional), buttons[], variables[].

Validar: placeholders sequenciais {{1}}, {{2}}.

---
## ⚙️ Automação & Flows (Fase 5)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | /v1/flows | Cria fluxo (graph JSON) |
| GET | /v1/flows | Lista fluxos |
| GET | /v1/flows/{id} | Detalhe fluxo |
| POST | /v1/flows/{id}/trigger | Dispara manual/evento |
| POST | /v1/flows/{id}/disable | Inativa fluxo |

Flow Node Types: message, condition, wait, webhook_call, assign_agent, end.
Motor: executa transições transacionais + log.

---
## 👥 Contatos & CRM (Fase 3)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | /v1/contacts | Lista contatos (filtros: tag, updated_from) |
| POST | /v1/contacts | Cria contato |
| GET | /v1/contacts/{id} | Detalhe |
| PUT | /v1/contacts/{id} | Atualiza |
| POST | /v1/contacts/sync | Sincroniza batch externo |
| POST | /v1/contacts/{id}/tags | Adiciona tags |
| DELETE | /v1/contacts/{id}/tags/{tag} | Remove tag |

Campos: externalId, phoneE164, name, email, tags[], customFields(jsonb), leadScore, lastInteractionAt.

Lead Scoring: função plugável (RFM + engajamento).

---
## 🪝 Webhooks (Fase 1 Estendido)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | /v1/webhooks | Registra webhook |
| GET | /v1/webhooks | Lista |
| DELETE | /v1/webhooks/{id} | Remove |
| POST | /v1/webhooks/test | Dispara evento teste |

Eventos: message_received, message_delivered, message_read, message_failed, contact_updated, template_approved, flow_completed.

Entrega: assinatura HMAC (SHA256) header `X-Signature`.
Retries: exponencial (30s, 2m, 10m, 30m) máx 5.

---
## 📦 Canais & Instâncias (Fase 8)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | /v1/channels | Lista canais configurados |
| POST | /v1/channels | Adiciona canal (ex: whatsapp_number) |
| GET | /v1/channels/{id} | Detalhe |
| POST | /v1/channels/{id}/rotate_credentials | Rotaciona secrets |

Multitenancy: chave tenantId em todas as tabelas.
Isolamento lógico (não misturar mensagens entre tenants).

---
## 🎯 Segmentação & Campanhas (Fase 4)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | /v1/segments | Cria segmento (query DSL) |
| GET | /v1/segments | Lista segmentos |
| POST | /v1/campaigns | Cria campanha (segmentId + template + schedule) |
| GET | /v1/campaigns/{id} | Status / métricas |
| POST | /v1/campaigns/{id}/pause | Pausa |
| POST | /v1/campaigns/{id}/resume | Retoma |

Segment Query DSL (ex):
```json
{
  "filters": [
    {"field": "tags", "op": "contains", "value": "vip"},
    {"field": "lastInteractionAt", "op": ">=", "value": "2025-08-01"},
    {"field": "leadScore", "op": ">=", "value": 80}
  ],
  "logic": "AND"
}
```

---
## 📊 Analytics & Métricas (Fase 6)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | /v1/analytics/messages | KPIs mensagens (intervalo) |
| GET | /v1/analytics/conversations | Conversas agregadas |
| GET | /v1/analytics/campaigns | Performance campanhas |
| GET | /v1/analytics/agents | Produtividade agentes |

Métricas Principais:
- delivery_rate, read_rate
- avg_response_time
- conversation_count (inbound/outbound)
- campaign_ctr, campaign_conversion
- quality_score (WhatsApp tier status)

Armazenar eventos normalizados: messages_events (type, ts, messageId, meta jsonb)
Views materializadas para agregações.

---
## 🛡️ Compliance & Auditoria (Fase 7)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | /v1/security/audit | Lista eventos (paginado) |
| POST | /v1/security/audit/export | Exporta CSV/JSON |
| POST | /v1/compliance/gdpr | Solicita anonimização / exportação |

Audit Event Schema: id, tenantId, actorId, role, action, entityType, entityId, timestamp, ip, userAgent, diff(jsonb).

---
## 📏 Rate Limits & Qualidade (Fase 2/7)

Monitorar:
- Mensagens por janela (text/media)
- Campanhas ativas simultâneas
- Uso por template category
- Erros/rate-limit incidents

Estratégia: Token Bucket + Circuit Breaker (se erro > X% em 5 minutos, reduzir throughput).

---
## 🗄️ Modelo de Dados (Resumo)

| Tabela | Campos Principais |
|--------|-------------------|
| tenants | id, name, status, plan, createdAt |
| users | id, tenantId, email, passwordHash, role, mfaSecret, lastLoginAt |
| phone_numbers | id, tenantId, numberE164, status, wabaLimitTier, verifiedAt |
| contacts | id, tenantId, phoneE164, name, email, tags[], customFields jsonb, leadScore, lastInteractionAt |
| messages | id, tenantId, channelId, contactId, direction, type, status, body, mediaUrl, scheduledFor, sentAt, deliveredAt, readAt, failedReason |
| message_events | id, tenantId, messageId, type, timestamp, meta jsonb |
| message_templates | id, tenantId, name, category, language, body, header, footer, buttons jsonb, status |
| flows | id, tenantId, name, definition jsonb, status, version |
| segments | id, tenantId, name, query jsonb, sizeCache, lastComputedAt |
| campaigns | id, tenantId, segmentId, templateId, status, scheduleAt, stats jsonb |
| webhooks | id, tenantId, url, secret, events[], active |
| audit_log | id, tenantId, actorId, action, entityType, entityId, timestamp, diff jsonb |

Índices recomendados: btree (tenantId, createdAt), GIN jsonb para query em customFields, partial indexes em status.

---
## 🧪 Testes & Qualidade

Pirâmide de testes:
- Unit: validação payload, parsing template, rate limit util
- Integration: fluxo envio -> fila -> worker -> status
- E2E: cenários (mensagem texto, mídia, template marketing, campanha segmentada)
- Performance: carga 100 msg/min sustentado

Test Data Builders para mensagens e contatos.

---
## 🔄 Migração Gradual da API Atual

| Atual | Novo | Ação |
|-------|------|------|
| POST /send | POST /v1/messages | Manter compat temporária (/send → proxy) |
| GET /status | GET /v1/health (futuro) | Adicionar /v1/health e depreciar /status |
| GET /chats | GET /v1/conversations (futuro) | Mapear chats → conversations |
| POST /webhook | POST /v1/webhooks | Migrar formato + assinatura |

Depreciação: comunicação em 2 etapas (warning header + data fim).

---
## 🧩 Sequência Técnica Recomendada (Sprint-Level)

1. Infra: adiciona PostgreSQL + Redis + migrations
2. Auth: JWT + usuários + tenants (admin hardcoded → DB)
3. Messages: persistência + fila + worker + status
4. Webhooks: registro + dispatch + retries
5. Contacts: ingest automático em message_received
6. Templates + envio template-based
7. Segments + campaigns (batch + throttle)
8. Flows: engine mínima (message → condition → message)
9. Analytics: eventos + primeira dashboard
10. Audit + compliance endpoints
11. Hardening: MFA, RBAC refinado, rate adaptativo

---
## 🔐 Segurança (Checklist)
- [ ] TLS obrigatório em produção
- [ ] HSTS + security headers
- [ ] Limite tamanho payload (ex: 2MB JSON)
- [ ] Sanitização de entrada (OWASP)
- [ ] Logs sem dados sensíveis
- [ ] Expiração tokens curta (15m) + refresh (7d)
- [ ] Rotação de segredos (webhook, API keys internas)
- [ ] Alertas de anomalia (spike falhas envio)

---
## 🛠️ Ferramentas de Suporte
- Migration: Prisma / Knex
- Doc: OpenAPI 3.1 + Swagger UI
- Linter: ESLint + Prettier
- CI: GitHub Actions (lint, test, security scan)
- SAST: Semgrep
- Dependency Scan: npm audit + osv-scanner

---
## 📌 Próximos Passos Imediatos
1. Confirmar escopo mínimo da Fase 1
2. Adicionar PostgreSQL & Redis ao docker-compose
3. Introduzir camada de Auth (JWT) sem quebrar endpoints atuais
4. Implementar /v1/messages com persistência + compat /send
5. Definir modelo de webhooks (HMAC + retries)

---
## ✅ Resumo
Este blueprint transforma a API simples atual em uma plataforma enterprise modular, segura e escalável, suportando automação avançada, CRM, campanhas, templates e analytics com governança robusta e compliance.

> Após validação, cada fase pode ser quebrada em tickets técnicos com critérios de aceite claros.
