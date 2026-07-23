# Governança PostgreSQL

## Baseline corrigido

O CRM concentrava conexões em `DATABASE_URL`, aceitava TLS sem validação de
certificado e criava schema/tabelas durante a inicialização de Harmonia,
Atendimento e Caixa. Esses caminhos foram removidos do runtime. O pool comum
agora usa TLS obrigatório fora de localhost, valida a CA, nomeia a aplicação
por domínio e aplica limites de conexão, vida do pool, conexão, consulta, lock
e transação ociosa.

`POSTGRES_<DOMINIO>_DATABASE_URL` seleciona a URL por domínio e mantém
`DATABASE_URL` apenas como fallback de compatibilidade durante a migração. A
ordem de remoção do fallback é: provisionar role, validar staging, trocar o
serviço, confirmar `application_name`/role no banco e então remover o fallback.

| Domínio | Role de serviço | URL | Pool | Acesso |
| --- | --- | --- | --- | --- |
| Harmonia | `skincos_crm_harmonia` | `POSTGRES_HARMONIA_DATABASE_URL` | próprio, máximo 8 por padrão | DML somente em `harmonia` |
| Atendimento | `skincos_crm_atendimento` | `POSTGRES_ATENDIMENTO_DATABASE_URL` | próprio | DML em `crm_atendimento` |
| Caixa | `skincos_crm_caixa` | `POSTGRES_CAIXA_DATABASE_URL` | próprio | DML em `crm_caixa` e leitura contratada de Atendimento |
| Tracking | `skincos_crm_tracking` | `POSTGRES_TRACKING_DATABASE_URL` | próprio | somente leitura em Atendimento |
| Migrations | `skincos_crm_migrator` | `POSTGRES_MIGRATIONS_DATABASE_URL` | pipeline efêmero | DDL somente em janela aprovada |

As roles sem `LOGIN`, grants e default privileges estão em
[0001_service_roles.sql](../../ops/postgres/roles/0001_service_roles.sql).
O operador cria credenciais de login fora do repositório e atribui somente a
role necessária a cada segredo de Environment.

## Migrations e compatibilidade

Harmonia, Atendimento e Caixa têm migrations de adoção que apenas verificam a
baseline existente e registram o estado; não renomeiam, removem nem regravam
dados. Elas são o primeiro passo do pipeline próprio. Todo DDL novo deve ser
um arquivo posterior no diretório do domínio, com checksum registrado em
`public.skincos_schema_migrations`.

O pipeline executa somente com a URL do migrator, após backup, staging e
aprovação explícita. A aplicação usa roles sem `CREATE`, portanto não consegue
compensar uma migration ausente ao iniciar. Rollback é nova migration aditiva
ou retorno do artefato anterior; não há `down` automático em produção.
O workflow manual [postgres-migrations.yml](../../.github/workflows/postgres-migrations.yml)
requer Environment, confirmação literal, segredo exclusivo
`POSTGRES_MIGRATIONS_DATABASE_URL` e aprovação adicional de produção.

## Aceite de staging

1. TLS apresenta cadeia válida e a URL remota não aceita `sslmode=disable`,
   `prefer` ou `no-verify`.
2. Cada serviço conecta com sua role e `application_name` esperado; tentativa
   de DDL e de acesso à schema alheia falha.
3. Os limites são visíveis via `pg_stat_activity`; conexão, query, lock e
   transação ociosa terminam no timeout configurado.
4. As migrations de adoção registram a baseline sem alterar contagens ou
   checksums dos dados existentes.
5. Reiniciar cada serviço não emite DDL e falha de modo explícito se a baseline
   estiver ausente.

O CI executa `npm run postgres:validate` e bloqueia TLS permissivo,
`createTableIfMissing`, auto-migration e ausência dos artefatos versionados.

## Integrações fora do CRM

Meta Ads passa a usar `META_APP_DATABASE_URL` para a aplicação e
`META_MIGRATIONS_DATABASE_URL` para Prisma `migrate deploy`; o antigo comando
`migrate dev` não é caminho de publicação. O runtime Orb/n8n continua sendo um
PostgreSQL local gerenciado pelo sistema e não foi reconfigurado nesta mudança:
ele ainda precisa de uma janela própria para trocar os usos operacionais do
role `postgres` por roles de runtime e manutenção. Essa troca exige criar
logins, ajustar units e restaurar um backup em scratch; não é seguro inferir ou
alterar suas credenciais durante uma auditoria de código.
