# Relatório de Prontidão dos Módulos

Legenda de Status:
- ✅ Pronto (estrutura sólida, apenas conectar API real)
- ⚠️ Parcial (usa mocks extensivos, precisa definir contrato de dados)
- ⛔ Básico / Placeholder (UI mínima ou texto "Em desenvolvimento")

| Módulo (key) | Nome UI | Status | Principais Gaps para Dados Reais | Ações Recomendadas |
|--------------|---------|--------|----------------------------------|--------------------|
| dashboard / reports | Analítica / Relatórios | ⚠️ | Métricas hardcoded, ausência de filtros de período | Definir endpoints /reports/summary, /reports/timeseries; adicionar seletor de intervalo |
| leads | Leads | ⚠️ | Lista e scoring não conectados a fonte real | CRUD /leads, paginação, busca server-side, React Query |
| notifications | Notificações | ⚠️ | WebSocket mock + geração aleatória | Normalizar payload WS, persistência read/unread no backend |
| helpdesk | Help Desk | ⚠️ | Tickets e métricas mocks | Endpoints /tickets, /tickets/:id/activities; SLA calc server-side |
| omnichannel | Omnichannel | ⚠️ | Activities mock, canais não integrados | Unificar ingest (WhatsApp, IG, FB) via backend aggregator |
| meta-ads | Meta Ads | ⚠️ | Campanhas e contas mock | OAuth real + fetch /meta/ads/accounts, campaigns sincronização incremental |
| meta-command | Meta Command | ⚠️ | Operações simuladas | Mapear comandos reais (mensagens, posts) + fila assíncrona |
| meta-sync | Meta Sync | ⚠️ | Timeline mock | Implementar job status polling /sync/jobs |
| meta-sentiment | Sentimento | ⚠️ | Análises randomizadas | Serviço NLP externo + cache resultados |
| whatsapp-business | WhatsApp | ⚠️ | Mensagens e métricas mocks | Gateway real (Cloud API), webhook ingest, fila mensagens |
| instagram-studio | Instagram | ⚠️ | Posts/insights simulados | API Graph IG real + persistência mídia |
| threads-studio | Threads | ⛔ | Placeholder | Definir escopo inicial (post + métricas básicas) |
| workflow | Workflows | ⚠️ | Definições mock | Modelo BPMN ou JSON DSL + execução orquestrador |
| projects | Projetos | ⚠️ | Tarefas/kanban mock | Entidades project, task, status, associação usuário |
| kanban | Kanban | ⚠️ | Cartões épicos mock | Persistir colunas/cards; drag&drop -> PATCH batch |
| tasks | Tarefas | ⚠️ | Manager rico mas mock | CRUD /tasks; indexação por status & SLA |
| territories | Territórios | ⛔ | Sem fonte geográfica | Import shapefiles ou geojson + segment rules |
| quotes | Cotações | ⚠️ | Dados mock | CRUD /quotes + aprovação workflow |
| web-forms | Forms | ⚠️ | Estruturas mock | Schema dinâmico + endpoint público submit |
| email-templates | Templates | ⚠️ | Lista estática | Versões, render test, validação placeholders |
| fields | Campos | ⚠️ | Metadados locais | Persistir schema custom por objeto + migração |
| custom-objects | Objetos | ⚠️ | Editor / builder mock | Backend dynamic collections + índice busca |
| roi | ROI | ⛔ | Métricas financeiras incompletas | Normalizar custos, atribuição multi-touch |
| ai-automation | AI Automação | ⚠️ | Ações & agentes mock | Orquestrar LLM tools + logs execuções |
| ai-chat | AI Chat | ⚠️ | Chat local sem threads reais | Persistir threads, roles, tokens usage |
| agent-dashboard | Agentes | ⚠️ | Métricas chat mock | Ingest tempo real filas atendimento |
| coaching | Coaching | ⛔ | Placeholders | Definir KPIs coaching + gravação sessões |
| alerts | Alertas | ⚠️ | Performance & thresholds mock | Engine regras server + push via WS |
| backup-recovery | Backup | ⛔ | UI estática | List jobs, snapshots, restore flows |
| system-monitoring | Monitoramento | ⚠️ | Métricas geradas no client | Fonte Prometheus/Grafana API proxy |
| assets | Ativos | ⚠️ | Inventário mock | Upload S3, versionamento, metadados |
| manufacturing | Fabricação | ⛔ | Processos não modelados | Entidades BOM, ordens produção, etapas |
| hr | RH | ⛔ | Lista/análises ausentes | Colaboradores, cargos, folha (integração) |
| procurement | Compras | ⛔ | Fluxos não definidos | Requisições, ordens compra, fornecedores |
| accounting / accounting | Financeiro | ⚠️ | Lançamentos simulados | Plano contas, lançamentos double-entry |
| products | Produtos | ⚠️ | Catálogo mock | SKU, estoque, preço, variações |
| pipelines | Pipelines | ⚠️ | Estágios & deals mock | CRUD pipeline + reorder persistente |
| lead-scoring | Lead Scoring | ⚠️ | Cálculo local simplista | Serviço scoring ML + histórico versões |
| webhooks | Webhooks | ⚠️ | Configs mock | Assinaturas persistentes + retries + logs |
| companies | Empresas | ⚠️ | Multi-tenant parcial | Segregação tenant em todas queries + RBAC |
| api | API Explorer | ⚠️ | Schema mock | Carregar OpenAPI / GraphQL introspection real |

## Priorização Recomendada (Fases)
1. Fundamentos de Dados: Leads, Pipelines, Tasks, Contacts (Customers), Authentication real, Companies (multi-tenant).
2. Comunicação & Engajamento: Omnichannel, Notifications (WS real), WhatsApp, Instagram, Email Templates.
3. Operações e Automação: Workflows, AI Chat, AI Automação, Webhooks, Fields & Custom Objects.
4. Observabilidade & Performance: System Monitoring (backend), Alerts Engine, ROI, Relatórios avançados.
5. Domínios Avançados: Manufacturing, HR, Procurement, Accounting profundo.

## Padrões Técnicos Sugeridos
- Estado remoto: React Query (já presente) para todos endpoints CRUD.
- Autenticação real: Trocar mock por fluxo OAuth / JWT (endpoint /auth/login, /auth/register, /auth/refresh) + refresh interceptor.
- Autorização: Middleware de permissões por módulo (ex: hook usePermission('leads:view')).
- Observabilidade: Captura de erros com Sentry/OpenTelemetry + métricas vitais.
- WebSocket unificado: canal /ws multiplexado (notifications, presence, pipeline events).
- Validação: Zod schemas compartilhados (frontend + backend) para contratos críticos.
- Auditoria: Registrar mutações (quem, quando, antes/depois) em trilha de auditoria.

## Próximos Passos Táticos
1. Definir contrato OpenAPI mínimo (Leads, Users, Auth, Pipelines).
2. Implementar adaptadores API + hooks (useLeads, usePipelines) substituindo mocks.
3. Migrar SignUp/SignIn para backend e armazenar token seguro (HttpOnly cookie ou secure storage).
4. Introduzir camada de permissionamento simples (roles em JWT + guard nos módulos sensíveis).
5. Criar script verificação de mocks residuais (grep por 'mock', 'Em desenvolvimento').

_Gerado automaticamente — atualize conforme módulos evoluem._
