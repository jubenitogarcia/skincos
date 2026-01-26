# Insumos (Cloudflare)

Este módulo incorpora o projeto "Insumos" no monorepo do SKINCOS, usando Cloudflare Workers + D1 + R2.

O objetivo é manter o CRM `crm.skincos.com.br` consumindo a API por `same-origin` (`/api/insumos/*`) e deixando o Worker como backend único para o domínio `api.skincos.com.br`.

## Entrypoint

- Worker: [backend/apps/insumos/workers/index.js](../apps/insumos/workers/index.js)
- Config (Wrangler): [backend/apps/insumos/wrangler.toml](../apps/insumos/wrangler.toml)
- Migrações D1: [backend/apps/insumos/migrations](../apps/insumos/migrations)
- Store D1 (lógica): [backend/apps/insumos/src/d1Store.js](../apps/insumos/src/d1Store.js)

## Rotas públicas

Base: `https://api.skincos.com.br/insumos/*`

Observação: o Worker faz o *mount* em `/insumos/*` e mantém as rotas internas intactas, por isso muitos endpoints ficam com dupla ocorrência do prefixo (ex.: `/insumos/insumos`).

### Saúde e sessão

- Health: `GET /insumos/health`
- Sessão: `GET /insumos/auth/me`
- Login: `POST /insumos/auth/login`
- Logout: `POST /insumos/auth/logout`
- Refresh: `POST /insumos/auth/refresh`
- Perfil (nome/email/senha): `PUT /insumos/auth/profile`
- Cadastro (com token de convite): `POST /insumos/auth/register`

### Insumos e operações

- Listar/buscar: `GET /insumos/insumos?unidade=<slug>&q=<texto>&pagina=1&limite=200`
- Criar: `POST /insumos/insumos?unidade=<slug>`
- Atualizar: `PUT /insumos/insumos/:registro?unidade=<slug>`
- Excluir: `DELETE /insumos/insumos/:registro?unidade=<slug>`
- Entrada: `POST /insumos/insumos/entrada?unidade=<slug>`
- Saída: `POST /insumos/insumos/baixa?unidade=<slug>`
- Ajuste: `POST /insumos/insumos/ajuste?unidade=<slug>`
- Transferência: `POST /insumos/insumos/transferir?unidade=<origem>`

### Categorias (políticas)

- Políticas (read-only para usuários autenticados): `GET /insumos/categorias/policies`
- Admin (CRUD): `GET/POST /insumos/admin/categories`, `DELETE /insumos/admin/categories/:slug`

### Preferências do usuário (UI)

- Carregar: `GET /insumos/prefs`
- Salvar: `PUT /insumos/prefs`
- Resetar: `DELETE /insumos/prefs`

### Insights e alertas

- Alertas estoque/validade: `GET /insumos/alertas/estoque?unidade=<slug>`
- Ações recomendadas (reposição/transferências etc.): `GET /insumos/analytics/actionables?unidade=<slug>`
- Tendências (entradas/saídas): `GET /insumos/analytics/trends?unidade=<slug>&days=30&groupBy=day`
- Giro por categoria: `GET /insumos/analytics/category-turnover?unidade=<slug>&days=30&mode=saida`
- ROI: `GET /insumos/analytics/roi?unidade=<slug>`
- Qualidade do cadastro: `GET /insumos/quality/report?unidade=<slug>`

### Movimentações e exports

- Movimentações: `GET /insumos/movimentacoes?unidade=<slug>&tipo=TODOS&pagina=1&limite=50`
- CSV Insumos: `GET /insumos/export/insumos.csv?unidade=<slug>`
- CSV Movimentações: `GET /insumos/export/movimentacoes.csv?unidade=<slug>`

### Share (histórico e leitura)

- Histórico: `GET/POST /insumos/share/history` e `DELETE /insumos/share/history/:id`
- Abrir share: `GET /insumos/share/:id`

### Backup (D1 + R2)

- Status: `GET /insumos/backup/status`
- Trigger: `POST /insumos/backup/trigger`
- List: `GET /insumos/backup/list`
- Restore: `POST /insumos/backup/restore`
- Cleanup: `POST /insumos/backup/cleanup`

## Consumo no CRM

Para evitar CORS e manter o padrão same-origin do CRM, o backend do CRM expõe proxy:

- `GET/POST/... /api/insumos/*` → `https://api.skincos.com.br/insumos/*`
- `GET/POST... /api/auth/*` → `https://api.skincos.com.br/insumos/auth/*` (alias de login/registro/sessão)

Variável opcional:

- `INSUMOS_API_TARGET` (default `https://api.skincos.com.br`)
- `AUTH_LOCKOUT_MAX_ATTEMPTS` (default `5`)
- `AUTH_LOCKOUT_WINDOW_MINUTES` (default `15`)

### Nota: crm-api (backend/apps/crm-api)

O `crm-api` (Node/Express) não é o backend de Insumos. Ele serve outras partes do CRM (ex.: WhatsApp/orquestrador) e possui um stack de auth próprio.

Para Insumos, a autenticação e RBAC ficam no Worker `skincos-insumos` (cookies `session` + `csrfToken`) e os dados ficam em D1/R2.

### Frontend: onde fica

- Módulo: [frontend/InsumosModule.tsx](../../frontend/InsumosModule.tsx)
- Registro do módulo / bloqueio de abas: [frontend/App.tsx](../../frontend/App.tsx)
- Action registry global (pequeno): [frontend/actionsRegistry.ts](../../frontend/actionsRegistry.ts)

## Desenvolvimento local

Preferir via scripts canônicos do monorepo:

- `./backend/scripts/dev.sh insumos dev`
- `./backend/scripts/dev.sh insumos migrate` (env opcional: `INSUMOS_D1_DB`)
- `./backend/scripts/dev.sh insumos deploy`

Observação: o deploy usa `--keep-vars` para não apagar variáveis configuradas no Dashboard.

Para usar o Worker local no CRM (proxy via CRM API), rode o Worker e aponte o target:

- `INSUMOS_API_TARGET=http://127.0.0.1:8787 ./backend/scripts/dev.sh crm`

Smoke test (sem segredos / sem Google):

- `./backend/scripts/insumos-smoke.sh http://127.0.0.1:8787`

## Segredos

### Obrigatórios (produção)

- `SESSION_SECRET` (Worker): assina cookies de sessão/CSRF.

### Opcionais

- `MIGRATION_TOKEN` (Worker): permite migração Sheets → D1 sem sessão/CSRF (rota admin).
- `GOOGLE_PRIVATE_KEY` (Sheets legado): só necessário se for usar migração/restore do legado.

### Sheets em dev (local)

O projeto roda em D1 (ver `INSUMOS_STORAGE=d1` em `wrangler.toml`). Sheets é **legado** e pode ficar desabilitado.

Para habilitar integração com Google Sheets localmente:

- Copie o arquivo [backend/apps/insumos/.dev.vars.example](../apps/insumos/.dev.vars.example) para `backend/apps/insumos/.dev.vars`
- Preencha `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` e `GOOGLE_PRIVATE_KEY`

Depois reinicie:

- `./backend/scripts/dev.sh insumos dev`

## Matriz (temos vs falta)

**Já temos (end-to-end)**

- Auth por cookies + CSRF, RBAC e permissão por unidade.
- CRUD de insumos e múltiplos lotes por código (via `registro`), com estoque por unidade.
- Operações: entrada/saída/ajuste/transferência (com idempotência e auditoria).
- Políticas por categoria (`requires_lot`, `requires_expiry`, `fefo`) e enforcement no backend.
- Alertas (estoque baixo, vencendo, expirado com estoque) + insights (tendências/giro/ROI/qualidade).
- Offline queue no frontend para mutações quando cair a rede.
- Backups em D1 com payloads grandes em R2 (se `BACKUP_BUCKET` estiver configurado).

**Falta / gaps (prioridade sugerida)**

- P0: UX “selecionar lote” mais amigável (mostrar lote+validade em vez de “registro”) em todos os fluxos.
- P0: tela/admin de usuários e permissões (hoje existe “Usuários” mas fica bloqueado).
- P1: compras (fornecedor, pedido, status, recebimento) — hoje só existe “lista sugerida”.
- P1: inventário avançado (reorder por unidade, múltiplos mínimos, consumo por procedimento, custo médio).
- P2: importação em massa, etiquetas/barcode print, auditoria avançada (filtros/retention), integrações.

## Backlog (P0/P1/P2)

**P0 (usar internamente sem fricção)**

- Execução guiada de transferências sugeridas (prefill + confirmação) e lista de compra exportável.
  - Aceite: usuário abre “Ações recomendadas” e consegue executar transferências/entrada sem preencher manualmente código/unidades.
- Seleção de lote “com contexto” (lote, validade, estoque) para casos ambíguos.
  - Aceite: quando há múltiplos lotes, UI mostra lote/validade/estoque e nunca obriga o usuário a “adivinhar o registro”.

**P1 (operacional e financeiro)**

- “Compras” (mínimo viável): fornecedor + pedido + status + recebimento que gera “entrada”.
  - Métrica: % de entradas originadas de pedidos de compra.
- Relatórios: consumo por categoria/produto/unidade com filtros e export.

**P2 (escala e automação)**

- Integração com IA/automação (previsão de consumo, sazonalidade).
- Importação em massa e catálogo central (itens padrão, unidades, categorias).

## Referências (benchmark)

Capacidades comuns em ERPs/WMS que valem replicar no nosso contexto (sem copiar código):

- “Reorder rules” por depósito/unidade (mínimo/máximo, lead time).
- Lote/validade como first-class (FEFO, bloqueio de expiração, rastreabilidade).
- Ledger de estoque (movimentações imutáveis, reconciliação/auditoria).
- Transferências com aprovação (dupla conferência para volumes altos).
- Compras (PO → recebimento → entrada automática).
- Consumo por procedimento/ordem de serviço (para custo real e previsibilidade).

Repositórios abertos para inspiração (benchmark):

- `frappe/erpnext` (Stock): batch/serial, stock ledger, reorder, stock reconciliation.
- `odoo/odoo` (Stock): picking/transfer workflow, multi-warehouse, lots/serials, putaway.
- `openboxes/openboxes` (Supply chain): expiries/lots, transfers, requisitions.
- `snipe/snipe-it` (Assets): auditoria, check-in/out, localização (ideias de governança).
- `inventree/InvenTree` (Parts): lot tracking, suppliers, reorder, BOM (ideias de cadastros e UX).
