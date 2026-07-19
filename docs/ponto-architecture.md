# Arquitetura — Workforce Timekeeping

## Limites

- `workforce/timekeeping/worker.js`: rotas, orquestração, autenticação/autorização e observabilidade;
- `workforce/timekeeping/domain.js`: cálculo diário e consolidado puro/determinístico;
- `workforce/timekeeping/security.js`: PIN, HMAC e criptografia biométrica;
- `workforce/timekeeping/migrations`: persistência D1 e integridade;
- `crm/console/pontoApi.ts` e `pontoTypes.ts`: contrato do cliente;
- `crm/console/functions/api/ponto/[[path]].ts`: adaptador same-origin seguro;
- `api/src/router.js`: mount público canônico.

Eventos são append-only. Correções referenciam o evento original. Fechamentos guardam checksum, versão de cálculo, regras e snapshots diários. A Escala entra por alias canônico; um nome sem alias gera conflito e nunca fusão automática.

Fechamentos adquirem uma trava por funcionário, unidade e data antes do cálculo; o trigger do D1 impede inserções concorrentes até a reabertura formal.

## Contrato HTTP

Sucesso JSON: `{ "ok": true, "data": ..., "requestId": "..." }`. Erro JSON: `{ "ok": false, "error": "CODE", "code": "CODE", "requestId": "..." }`. Exportação é `text/csv`; demais respostas nunca usam fallback HTML.

O proxy CRM aplica CSRF às mutações e assina um envelope HMAC v2 ligado ao método, caminho/query, nonce e hash do corpo. O gateway não replica cookies: propaga apenas o contrato assinado para o Service Binding. Corpos acima de 1 MiB são rejeitados antes do parsing tanto no proxy quanto no Worker.

Principais recursos: `health`, `readiness`, `context`, `employees`, `punches`, `daily`, `mirror`, `monthly`, `inconsistencies`, `bank`, `corrections`, `devices`, `biometrics`, `pin`, `periods`, `audit`, `export` e `schedule/sync`.

## Identidade

`workforce_employees.canonical_employee_id` é o identificador estável compartilhado. `workforce_employee_aliases` relaciona `PONTO_V2`, `ESCALA_PROFESSIONAL_ID` e `ESCALA_NAME`. Vínculos de unidade, jornada e escala têm vigência temporal. Desligamento altera status; não apaga evento, snapshot ou relatório histórico.

## Cálculo

O cálculo recebe instantes UTC, regra versionada, escala, feriado e ausência já resolvidos. Produz previsto, trabalhado, intervalo, atraso, saída antecipada, excedente, saldo, inconsistências e origem. Tratamento para folha permanece fora deste domínio.
