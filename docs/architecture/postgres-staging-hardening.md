# PostgreSQL em staging: acesso, migrations e operação

Status: validado localmente no PostgreSQL isolado `skincos_staging` em 2026-07-23. Esta mudança não publica nem altera produção.

## Contrato de conexão

Toda conexão de aplicação deve usar `DATABASE_URL` sem `sslmode` ou `sslrootcert` na URL e declarar:

- `PGTLS_CA_FILE`: caminho privado para a CA/certificado confiável;
- `PGTLS_SERVER_NAME`: nome presente no certificado do servidor.

`crm/api/server/postgres/pool.js` falha ao iniciar se qualquer um faltar e sempre usa `rejectUnauthorized: true`. Em staging, o HBA permite apenas `hostssl` para as contas de aplicação e rejeita a mesma origem por `hostnossl`.

## Roles e limites

| Uso | Login | Papel efetivo | Limite |
| --- | --- | --- | --- |
| Identity | `skincos_staging_identity_app` | `skincos_staging_identity_runtime` | 4 conexões |
| Inventory | `skincos_staging_inventory_app` | `skincos_staging_inventory_runtime` | 4 conexões |
| Financeiro | `skincos_staging_finance_app` | `skincos_staging_finance_runtime` | 4 conexões |
| CRM | `skincos_staging_crm_app` | `skincos_staging_crm_runtime` | 8 conexões |
| Migrations | `skincos_staging_migrator_login` | faz `SET ROLE` apenas para o owner aprovado | 1 conexão |

Cada login é `NOINHERIT`. As contas de aplicação só recebem `CONNECT`, `USAGE` no schema do domínio e DML nas tabelas do CRM; não recebem `CREATE`. A conta de migrations recebe memberships de owner para executar mudanças versionadas, mas só o runner permite o owner de CRM explicitamente aprovado.

Os limites do cliente são separados: CRM 8, Atendimento 6, Harmonia 4, Caixa 3, Tracking 2 e migrations 1. Todos usam timeout de conexão, inatividade, vida máxima da conexão, statement, lock e transação ociosa; os valores podem ser reduzidos por variáveis `PG_*_TIMEOUT_MS` e `PG_POOL_MAX_<DOMINIO>`.

## Migrations

O bootstrap administrativo cria schemas e `pgcrypto`. As migrations da aplicação ficam em `crm/api/migrations/`, são aplicadas em ordem pelo journal `skincos_migrations.applied` e têm checksum. Não há DDL na inicialização de Atendimento, Harmonia, Caixa ou sessões.

Execução controlada:

```bash
DATABASE_URL='postgresql://...' \
PGTLS_CA_FILE=/caminho/privado/ca.pem \
PGTLS_SERVER_NAME=db.staging.exemplo \
PG_MIGRATION_SET_ROLE=skincos_staging_crm_owner \
node crm/api/scripts/apply-postgres-migrations.mjs
```

`platform/staging-foundation/postgres/validate-staging-crm-postgres.sh` é o teste de integração reproduzível: provisiona credenciais efêmeras, aplica HBA, executa migrations, confirma `verify-full`, rejeita conexão sem TLS, confirma isolamento de schema/DDL e exercita Atendimento, Caixa e Harmonia.

## Métricas e alertas

`getPgPoolMetrics()` expõe `configured`, `total`, `idle`, `waiting`, `errors` e `lastErrorAt`; `getPgDatabaseMetrics()` expõe conexões, commits/rollbacks, blocos e contadores de tuplas da base atual. Os health checks de Atendimento, Caixa e Harmonia incluem suas métricas de pool. O coletor externo deve alertar para `waiting > 0` sustentado, conexões próximas ao limite, rollbacks anormais, falhas de TLS e timeout/lock.

## Dependências ainda legadas

- O CRM nativo em produção continua usando o `DATABASE_URL` presente no ambiente privado do serviço. Ele não foi alterado nesta etapa; a troca exige secret separado, certificado confiável, smoke e rollback de produção.
- O adaptador legado de Replit Auth ainda lê/escreve a tabela PostgreSQL não qualificada `users`. O banco isolado não a expõe à role de CRM; a autenticação de staging deve seguir o contrato de ator do Identity/D1 até que uma PR específica mova esse adaptador sem perda de sessão.
- `skincos_crm_local` continua sendo o destino explícito de espelhamentos e migrations locais de Atendimento (`mirror.js`, `professionalIdentityMigration.js` e `writeSafetyMigration.js`). Não apontar esses fluxos para `skincos_staging`.
- Orb/n8n ainda documenta e consome seu `DATABASE_URL` próprio para `n8n_runtime`; permanece fora deste conjunto de roles.
- Evolution/WhatsApp permanece no banco `evolution` e com identidade de serviço do fornecedor; não foi migrado nem recebeu grants de `skincos_staging`.

Nenhuma dessas dependências deve reutilizar a conta `skincos_staging_migrator_login`. A retirada dos usuários legados requer PR específica, secret por serviço, validação em staging e rollback para a credencial anterior.
