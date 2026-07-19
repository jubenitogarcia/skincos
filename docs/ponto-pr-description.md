# Workforce Timekeeping — publicação controlada

## Resumo

Este PR move o Controle de Ponto para o domínio `workforce/timekeeping`,
publicado exclusivamente pelo gateway `api` e consumido pelo CRM pelo proxy
same-origin. O JSON legado deixa de ser persistência operacional e passa a ser
somente fonte de importação/rollback controlado.

## Arquitetura e contratos

- Worker D1 próprio, com rotas HTTP, domínio de cálculo, segurança e auditoria
  separados;
- gateway em `api/src/router.js` pelo Service Binding `TIMEKEEPING`;
- proxy CRM com allowlist de headers, CSRF, HMAC v2 e limite de 1 MiB;
- respostas JSON padronizadas, inclusive para 404; `health` e `readiness`
  públicos sem segredos.

## Dados e migrations

As migrations `0001` a `0004` criam identidade canônica, aliases, unidades,
jornadas, dispositivos, credenciais, biometria cifrada, eventos append-only,
correções, fechamento, auditoria imutável e travas de período. O importador
possui dry-run, checksum, backup, idempotência, relatório de conflitos e
rollback documentado.

## Segurança

- autorização por papel e unidade no Worker;
- PIN PBKDF2, comparação segura e bloqueio progressivo global;
- HMAC v2 ligado a ator, timestamp, método, caminho, query, nonce e corpo;
- templates biométricos cifrados, sem foto, score ou vetor exposto ao cliente;
- eventos de auditoria imutáveis e CSV protegido contra fórmulas.

## Validação local

- `npm --prefix workforce/timekeeping test`;
- `npm --prefix api test`;
- `npm --prefix crm/console test`, `typecheck`, `lint` e `build`;
- migrations D1 locais, importação JSON dry-run, rollback e integração sintética;
- bundles Wrangler de staging e produção em dry-run;
- parser YAML em todos os workflows e revisão do diff/segredos.

## Deploy, secrets e bindings

O workflow `deploy-timekeeping.yml` exige `TIMEKEEPING_D1_STAGING_ID` ou
`TIMEKEEPING_D1_PRODUCTION_ID` no environment correspondente e usa os secrets
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PONTO_ACTOR_HMAC_KEY`,
`PONTO_IDEMPOTENCY_KEY`, `PONTO_TEMPLATES_KEY`, `ESCALA_ACTOR_HMAC_KEY` e
`TIMEKEEPING_BACKUP_PASSPHRASE`. O gateway requer o binding `TIMEKEEPING` e o
Worker requer `SCHEDULE`.

## Plano de staging e rollback

O deploy começa em `staging`, gera checkpoint D1 cifrado, aplica migrations,
publica Worker/gateway e valida `health`/`readiness`. Produção só aceita a
atestation verde do mesmo SHA. Rollback de aplicação publica a versão anterior;
migrations são expansivas e o rollback de importação segue
`docs/ponto-migration.md`.

## Riscos conhecidos e revisão

- O primeiro deploy depende de D1 e environments GitHub provisionados;
- não há merge automático: os checks protegidos de `main` devem ficar verdes;
- produção só avança após staging e smoke somente leitura.

- [ ] Revisar contratos CRM/gateway
- [ ] Confirmar secrets e bindings por environment
- [ ] Confirmar migrations/checkpoint em staging
- [ ] Aprovar staging e smoke de produção
