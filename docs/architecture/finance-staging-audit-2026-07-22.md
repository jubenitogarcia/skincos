# Auditoria do staging Financeiro — 2026-07-22

Esta é evidência de infraestrutura publicada, obtida sem escrever no ambiente.
Não é validação de uma nova versão do Financeiro.

## Recursos confirmados

| Superfície | Evidência | Estado |
| --- | --- | --- |
| Gateway | `skincos-api-staging`, rota `api-staging.skincos.com.br/*`, D1 `skincos-db-staging` (`4bdd7995-ad69-465a-917c-0aab22db5c4e`) | Separado de produção |
| Estado Financeiro | consulta remota a `finance_settings` retornou `module_enabled=false`; `finance_access_grants` retornou zero linhas | Seguro para preparação |
| Pages | projeto `skincos-staging`, branch `staging`, deployment `7b311683-cd93-42f4-b33f-bf5fc2956039` | Publicado, mas em commit anterior |
| Proxy | `GET /api/finance/bootstrap` no Pages e no gateway retornou `401` com `Cache-Control: no-store` e `x-request-id` | Encaminhamento autenticado, sem fallback público |
| Configuração de deploy | workflow copia `crm/console/.wrangler-staging/wrangler.toml`; este aponta ambos `FINANCE_API_TARGET` e `INSUMOS_API_TARGET` para `https://api-staging.skincos.com.br` | Isolamento configurado no artefato de staging |

## Bloqueio honesto para a próxima promoção

O deployment do Pages está no commit `f9a22cd` e o D1 não possui ainda a
tabela `finance_obligations`. Isso é esperado porque as migrations novas ainda
estão apenas na worktree/branch local. Não é seguro iniciar os smokes da versão
atual antes de publicar a migration aditiva e o Worker correspondentes no
staging.

## Condição para smokes autenticados da versão atual

1. Integrar a branch Financeiro revisada no branch `staging`.
2. Aplicar as migrations Financeiro em ordem no D1 de staging, registrando a
   versão aplicada fora do código de produção.
3. Publicar Worker e Pages de staging pelo workflow que usa a configuração
   isolada.
4. Reconfirmar flag desligada e zero grants antes de criar identidades de teste
   temporárias.

## Procedimento de migrations

`finance/scripts/apply-d1-migrations.sh` mantém um journal próprio em
`finance_schema_migrations`, com checksum e origem (`applied` ou `adopted`).
Em uma base Financeiro existente e sem journal, a adoção é uma ação explícita:
ela verifica os objetos das versões históricas antes de registrar `0001` a
`0010`, então aplica somente as migrations novas. Em uma base vazia, o comando
aplica todas em sequência. O script falha se detectar checksum diferente.

Nenhum recurso de produção foi consultado ou alterado nesta auditoria.
