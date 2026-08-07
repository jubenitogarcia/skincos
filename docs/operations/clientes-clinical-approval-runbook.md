# Runbook — aprovação clínica do Clientes

## Estado inicial

Flags efetivas nesta tranche:

- `CLINICAL_APPROVAL_ENABLED=false` (catálogo online);
- `CLINICAL_APPROVAL_EXPIRY_JOB_ENABLED=false`;
- `CLINICAL_APPROVAL_EXPIRY_TARGET=staging` (só aceito em `local` ou `staging`);
- `CRM_ATENDIMENTO_READ_ONLY=true` quando o runtime isolado for promovido;
- `commercialContactWritesEnabled=false`;
- canário comercial vazio;
- mensagens e campanhas automáticas desabilitadas.

O domínio não é uma prescrição. Uma regra aprovada apenas documenta uma
cadência revisada para consumo posterior por um fluxo explicitamente autorizado.

## Dry-run e migration

Use o runner nativo a partir de `crm/api`, sem shell recebido de variáveis:

```text
npm run migrate-clinical-approval -- --target=local --dry-run
npm run migrate-clinical-approval -- --target=local --apply
npm run migrate-clinical-approval -- --target=local --rollback
```

O destino é validado contra o espelho local ou o PostgreSQL staging loopback
com login migrator. Produção é rejeitada. A migration é aditiva e registra o
estado em `clinical_approval.schema_migrations`; rollback preserva schema,
ledgers e triggers.

## Operação

1. `GESTOR` cria um rascunho com procedimento, unidade, intervalo,
   justificativa, evidência e vigência.
2. O gestor submete a revisão com `expectedRevision` e `Idempotency-Key`.
3. `CLINICAL_APPROVER` revisa fora do Clientes, confirma a unidade e não pode
   aprovar o próprio autor.
4. Aprovar/rejeitar grava evento append-only. Alteração relevante cria nova
   revisão; uma aprovação expirada não é elegível.
5. Em caso de conflito, não repetir sem recarregar a versão. O domínio usa
   lock transacional e deduplicação por ator/operação/chave.

Quando o domínio já tiver sido validado em ambiente gravável autorizado, a
expiração pode ser materializada pelo processo independente `crm-jobs.service`.
Ela continua desligada por padrão, exige as três flags acima mais
`CRM_CONTINUOUS_JOBS_ENABLED=1`, e só transforma regras já vencidas de
`approved` para `expired`, com evento append-only e chave idempotente do
checkpoint. Não há aprovação automática, recomendação, contato ou envio. Em
runtime somente leitura ou alvo `production`, o job falha fechado antes de
tocar no banco; erro de configuração vai para dead-letter sem retry.

## Smoke autorizado

- `GET /api/clinical/health` não exige autenticação e não contém PII;
- `GET /api/clinical/readiness` é interno e exige ator autenticado; deve ser 200 somente com banco e schema prontos;
- sem banco, health permanece 200 com `ready:false` e readiness é 503;
- mutações retornam 405 sob `CRM_ATENDIMENTO_READ_ONLY=true`;
- testes de escrita usam somente procedimento/unidade sintéticos e staging
  autorizado; nunca enviar mensagens ou aplicar decisão em identidade real.

## Gate humano mínimo

Antes de qualquer promoção além da leitura local, a operação precisa fornecer
apenas: (a) provisionamento do papel `CLINICAL_APPROVER` em staging/produção,
com escopo de unidade e revisor independente; (b) destino PostgreSQL staging
autorizado e credencial migrator. Na ausência deles, mantenha as flags acima e
não execute escrita externa.
