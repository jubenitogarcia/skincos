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
| Worker | workflow `29931079252` publicou `skincos-api-staging` e `skincos-insumos-staging`; o smoke de produção foi ignorado | Recursos de staging somente |

## Estado das migrations após a reconciliação

O D1 de staging já continha uma baseline Financeiro compatível até a versão 6,
mas sem um diário que o domínio pudesse consumir com segurança. A reconciliação
explícita registrou `0001` a `0006` como `adopted`, depois aplicou `0007` a
`0011` como `applied`. A consulta remota de 2026-07-22 confirmou as onze linhas
e respectivos checksums em `finance_release_migrations`.

Uma primeira execução do workflow falhou após a escrita porque o script
identificava entries do JSON por formatação textual. O journal foi corrigido
para ser lido estruturalmente com Node; a aplicação repetida foi validada em D1
local e remoto, sem reaplicar migrations. O Worker ainda precisa ser publicado
por um workflow verde antes dos smokes autenticados.

O workflow também continha uma etapa opcional de recuperação de senha que,
quando acionada por `staging`, escrevia os segredos genéricos de CI no Worker
sem `--env`. Ela foi limitada a `main`: staging mantém somente os seus próprios
segredos preprovisionados e não exerce entrega de e-mail neste ciclo. A execução
anterior confirmou o risco pelo nome-base exibido pelo Wrangler; valores nunca
foram lidos ou registrados e a correção evita qualquer nova escrita cruzada.

## Autenticação e fronteiras verificadas

Uma identidade de controle criada somente no D1 de staging, com módulo
explícito `finance` e sem grant, passou pelo login normal do Worker de
Inventário e foi aceita pelo gateway Financeiro. O mesmo teste pelo proxy
Pages confirmou `200` em `/api/auth/login` e `/api/finance/bootstrap`, com
`moduleEnabled=false`, zero grants e `canAccess=false`.

No gateway, uma mutação sem `X-CSRF-Token` retornou `403`; com o token válido
ela chegou ao domínio e retornou `423 FINANCE_DISABLED`. Depois de incrementar
o `session_version` da identidade de controle, o cookie anterior retornou
`401`. Isso comprova sessão, CSRF e invalidação de sessão sem introduzir uma
credencial paralela. A identidade permanece desprovida de grants e será
desativada ao fim da matriz autenticada.

## Condição para smokes autenticados da versão atual

1. Reconfirmar flag desligada e zero grants antes de criar identidades de teste
   temporárias.
2. Executar a matriz autenticada de módulos, grants e escopos empresariais.
3. Manter o contexto pessoal inativo em todos os cenários.

## Procedimento de migrations

`finance/scripts/apply-d1-migrations.sh` mantém um journal próprio em
`finance_release_migrations`, com checksum e origem (`applied` ou `adopted`).
Em uma base Financeiro existente e sem journal, a adoção é uma ação explícita:
ela verifica os objetos das versões históricas antes de registrar `0001` a
`0006`, então aplica somente as migrations novas. Em uma base vazia, o comando
aplica todas em sequência. O script falha se detectar checksum diferente.

Nenhum recurso de produção foi consultado ou alterado nesta auditoria.
