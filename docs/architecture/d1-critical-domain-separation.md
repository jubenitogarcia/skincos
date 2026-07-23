# Separação progressiva dos D1s críticos

## Baseline e decisão

Hoje `Identity`, `Inventory` e `Finance` coexistem em `skincos-db` e
`skincos-db-staging`. Isso viola o isolamento de recuperação: o backup legado
de Inventory inclui `crm_users`, e uma restauração desse payload pode apagar ou
regravar dados de autenticação. Finance já possui journal próprio
(`finance_release_migrations`), porém ainda o escreve na mesma base física.

O alvo é uma base D1 por domínio e por ambiente, sem bindings de banco
compartilhados entre os três domínios:

| Domínio | Fonte durante coexistência | D1 alvo staging | D1 alvo produção | Journal | Backup dedicado |
| --- | --- | --- | --- | --- | --- |
| Identity | `crm_users`, `crm_invites`, `crm_password_resets`, `crm_user_prefs`, `auth_attempts` em `skincos-db*` | `skincos-identity-staging` | `skincos-identity` | `identity_release_migrations` | `skincos-identity-backups*` |
| Inventory | tabelas `insumos_*`, auditoria, jobs e snapshots em `skincos-db*` | `skincos-inventory-staging` | `skincos-inventory` | `inventory_release_migrations` | `skincos-inventory-backups*` |
| Finance | tabelas `finance_*` em `skincos-db*` | `skincos-finance-staging` | `skincos-finance` | `finance_release_migrations` | `skincos-finance-backups*` |

O catálogo verificável está em
[`ops/d1/critical-domain-catalog.json`](../../ops/d1/critical-domain-catalog.json).
Ele descreve somente recursos-alvo: não cria D1, não altera bindings nem muda
o caminho de leitura/escrita atual.

## Regras não negociáveis

1. Uma migration só atua no D1 do próprio domínio. O runner exige o nome exato
   do alvo isolado e recusa `skincos-db` e `skincos-db-staging`.
2. Cada migration recebe checksum no journal exclusivo. Um checksum alterado
   depois de aplicado falha; migrations são somente aditivas.
3. Export de backup vai para o runtime privado do operador, nunca para Git.
   Cada domínio usa bucket distinto e artefato com checksum.
4. Restauração começa obrigatoriamente em um D1 local novo. Importar um backup
   diretamente em staging ou produção é proibido até haver revisão explícita,
   suspensão de escrita do domínio e checkpoint prévio daquele mesmo domínio.
5. Roles, sessões e grants não são chave estrangeira entre D1s. Os domínios
   recebem o ator do contrato `identity-actor/v1`; referências históricas por
   `username` ou `subject` são migradas por cópia auditada, sem deleção na
   origem durante coexistência.
6. `staging` e produção usam IDs, buckets, secrets e GitHub Environments
   distintos. Um workflow de staging não pode receber variáveis de produção.

## Artefatos já preparados

- Schemas-alvo versionados: [Identity](../../identity/d1/migrations/0001_identity_schema.sql), [Inventory](../../inventory/d1/migrations/0001_inventory_schema.sql) e as migrations nativas de [Finance](../../finance/migrations/0001_finance_foundation.sql).
- Runner de migrations checksum-aware:
  [`scripts/d1/apply-isolated-domain-migrations.sh`](../../scripts/d1/apply-isolated-domain-migrations.sh).
  Os wrappers por domínio são `identity/scripts`, `inventory/scripts` e
  `finance/scripts`.
- O CI valida nomes, journals, buckets, permissões declaradas, schemas sem
  tabelas de outro domínio e destino de recuperação:
  `npm run d1-domains:validate`.

Esses artefatos não são uma autorização de execução remota. IDs D1,
provisionamento de buckets, secrets e bindings só entram no PR de cada fase,
depois da aprovação da checklist abaixo.

## Ordem de execução

| Ordem | Prioridade | Mudança | Dependências | Critério de aceite | Rollback |
| --- | --- | --- | --- | --- | --- |
| 0 | P0 | Congelar o contrato e inventariar contagens/checksums por tabela da origem | catálogo e CI verdes | nenhuma gravação remota; snapshot privado e restore em scratch conferido | descartar somente o scratch e o artefato de teste |
| 1 | P0 | Provisionar **somente Identity staging**, bucket e Environment segregados | aprovação do plano, token com escopo mínimo | D1 vazio com schema/journal Identity; nenhum binding de produção | apagar somente o recurso staging ainda vazio, após registrar a decisão |
| 2 | P0 | Cópia aditiva Identity → Identity staging e reconciliação por `subject`/username, contagem e hash | snapshot P0; schema Identity | login, CSRF, recuperação e convite funcionam com cookie existente; origem permanece intacta | desligar a flag/binding de leitura nova e continuar na origem |
| 3 | P1 | Dual-read controlado de Identity, com escrita ainda na origem ou outbox auditado | fase 2 aprovada | divergência zero no conjunto de controle; sessão antiga e nova aceitas | voltar o leitor para a origem; não restaurar a origem |
| 4 | P1 | Provisionar e validar Inventory staging, depois Finance staging, um por vez | Identity estabilizado; buckets/Environments dedicados | backup/restauração scratch por domínio; migrations não veem tabelas dos pares | desligar o binding do domínio em teste e reter a origem como leitura |
| 5 | P2 | Cortar escrita de cada domínio em staging, publicar o mesmo artefato e executar smoke/canary | PR verde, staging aprovado, checkpoint do domínio | nenhuma escrita nova na origem; métricas e reconciliação verdes durante a janela | reverter artefato/flag para a origem; preservar D1 alvo para investigação |
| 6 | P3 | Repetir em produção, um domínio por release | staging, canary, backup/restore e aprovação explícita | checkpoint restaurável, janela de escrita suspensa e rollback ensaiado | reverter somente o domínio afetado; nunca restaurar outro D1 |

Identity vem primeiro porque retira usuários/sessões do backup de Inventory e
elimina o maior risco de restauração cruzada. Finance só avança quando a
segregação de ator estiver estável, pois seus grants continuam independentes e
nunca podem ser inferidos de um papel global.

## Validação de staging por domínio

Antes de cada promoção, executar e registrar em evidência privada:

1. `bash <domínio>/scripts/apply-isolated-d1-migrations.sh --remote --env staging --database skincos-<domínio>-staging`;
2. export do D1 alvo, SHA-256 e restauração em D1 local novo;
3. consulta de journal, checksum de todas as migrations e contagens por tabela;
4. smoke do domínio com flag desligada, depois janela mínima com flag ligada;
5. teste de falha: indisponibilidade do D1 alvo retorna o fallback declarado e
   não escreve no D1 de outro domínio;
6. teste de recuperação: restaurar apenas o scratch, comparar integridade e
   destruir o scratch; nenhuma importação remota automática;
7. desligar a flag e confirmar que a origem continua íntegra antes do corte de
   escrita.

Para produção, acrescentar aprovação explícita de mudança, backup prévio do
domínio, suspensão de escrita daquele domínio, versão anterior do Worker e a
mesma evidência de restore. Não existe rollback por migration destrutiva.
O runner também exige `D1_PRODUCTION_CHANGE_APPROVED=1`; essa variável é uma
confirmação de última milha, não substitui a aprovação do Environment nem a
evidência de staging.

## Permissões mínimas e recuperação

Cada domínio recebe tokens/variáveis próprios (`*_D1_STAGING_ID` e
`*_D1_PRODUCTION_ID`) somente nos GitHub Environments correspondentes. O
Worker do domínio é o único leitor/escritor de sua base; gateway, CRM e outros
Workers o alcançam por contrato ou service binding, nunca por binding D1.

Uma recuperação remota exige dois passos humanos separados: aprovar o relatório
do restore em scratch e aprovar o alvo exato. O procedimento cria antes um novo
checkpoint do **mesmo** domínio, suspende as suas escritas, aplica somente o
artefato daquele domínio e executa reconciliação pós-restore. Backup de
Inventory não pode conter nem restaurar dados Identity, e backup Financeiro não
pode modificar qualquer outro D1.
