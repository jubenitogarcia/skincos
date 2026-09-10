# Candidato de staging do Ponto Core

`.github/workflows/ponto-core-staging-candidate.yml` produz a evidência
sanitizada que o publisher isolado do Ponto Pages consome para uma alteração de
staging. Ele **não é um publisher**: o único workflow que cria versões novas de
Core e Identity continua sendo
`.github/workflows/deploy-core-workers.yml`.

## Quando executar

Execute somente após os três publishers canônicos de staging terem terminado
com sucesso para o mesmo SHA atual de `main`:

1. `deploy-timekeeping.yml` para Timekeeping;
2. `deploy-core-workers.yml` para `coreApi`;
3. `deploy-core-workers.yml` para `identityWorkforce`.

No despacho manual, informe o SHA completo e os três IDs de execução acima,
e selecione `execute_same_artifact_rollback=true`. A execução recusa outro
branch, SHA diferente de `github.sha`, reexecução, artefato sem proveniência
canônica ou staging fora de manutenção.

O ambiente GitHub usado é somente `staging`. O token de Cloudflare, se
necessário, permanece nesse environment; nenhum valor de secret, dado de
cliente ou dump de banco é colocado no artefato.

## O que a evidência prova

Antes e depois do exercício, o workflow confirma no plano de controle:

- Core `skincos-ponto-core-staging` no UUID e tag exatos, com
  `APP_VERSION`/`ENVIRONMENT` de staging, binding para
  `skincos-timekeeping-staging`, o UUID exato de `TIMEKEEPING_VERSION_ID`,
  `CF_VERSION_METADATA`, `PONTO_ROUTE_ONLY=true`, sem route, domínio,
  `workers.dev` ou preview URL;
- Identity `skincos-insumos-staging` no UUID e tag exatos, com o binding
  Timekeeping e `TIMEKEEPING_VERSION_ID` corretos, `CF_VERSION_METADATA`, somente a route
  `api-staging.skincos.com.br/insumos/*`, e sem domínio, `workers.dev` ou
  preview URL;
- health público exposto de Identity para a versão exata;
- rollback de peso de cada Worker para seu incumbent exato e restauração do
  mesmo UUID candidato, sob `global:ponto-workers-writer` e
  `ponto-surface-mutation`.

O resultado é o artefato GitHub Actions
`ponto-core-staging-candidate-<SHA>/ponto-core-staging-candidate.json`. O
recibo contém somente identidade de fonte, serviços, UUIDs, tags, exposição,
estado de readiness e IDs de rollback — todos marcados sem credenciais nem PII.

## Limites e recuperação

Não há upload de código, migration, secret, rota, Pages, recurso de produção
ou dado operacional neste workflow. Uma falha durante o drill só tenta
restaurar um candidato quando o plano de controle mostra o incumbent exato do
próprio drill; qualquer estado diferente falha fechado sem nova mutação.

Esse recibo não autoriza produção e não substitui o smoke sintético privado do
Ponto Pages. A validação Pages posterior é quem prova o caminho Core privado
via service binding e decide se o candidato de staging pode seguir no fluxo
governado.
