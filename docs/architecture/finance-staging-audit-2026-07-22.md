# Auditoria do staging Financeiro — 2026-07-22

Este documento reúne evidências de infraestrutura publicada e de janelas
controladas de validação no staging. Ele não autoriza produção.

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
`0011` como `applied`. O journal usa a coluna `id` (não `version`); a consulta
remota de 2026-07-22 confirmou as onze linhas e respectivos checksums em
`finance_release_migrations`.

Uma primeira execução do workflow falhou após a escrita porque o script
identificava entries do JSON por formatação textual. O journal foi corrigido
para ser lido estruturalmente com Node; a aplicação repetida foi validada em D1
local e remoto, sem reaplicar migrations. O Worker foi publicado com sucesso
no workflow `29931079252` antes dos smokes autenticados.

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

## Matriz autenticada controlada — primeira execução

Durante uma janela com a flag habilitada exclusivamente em staging, foram
criadas identidades de controle sem qualquer vínculo pessoal. O resultado da
matriz de API foi:

| Cenário | NH | BSS | Pessoal | Resultado |
| --- | --- | --- | --- | --- |
| Sem módulo `finance` | 403 | 403 | 403 | bloqueado antes do domínio |
| Com módulo, sem grant | 403 | 403 | 403 | bootstrap sem acesso |
| Grant NH | 200 | 403 | 403 | isolamento de unidade confirmado |
| Grant BSS | 403 | 200 | 403 | isolamento de unidade confirmado |
| Grants NH e BSS | 200 | 200 | 403 | consolidação somente dos escopos concedidos |

No cenário NH foram exercitados conta caixa, conta de compensação, categorias,
favorecido, tag, centro de custo, receita, despesa e transferência. Todas as
criações retornaram `201`; a repetição da mesma chave de idempotência retornou
o resultado reaproveitado e a mesma chave com payload diferente retornou `409`.
Uma consulta ao D1 não encontrou desequilíbrio nas três partidas de razão
criadas; a API de auditoria devolveu seis eventos de movimento.

A janela foi encerrada no mesmo ciclo: `module_enabled=false`, zero linhas em
`finance_access_grants` e zero identidades de controle ativas. Lançamentos,
partidas e auditoria foram preservados como evidência de staging; o escopo
pessoal continuou inativo e sem grant.

## Smoke autenticado do Pages — Financeiro

O comando `npm run finance:staging:ui-smoke` é deliberadamente travado para
`https://skincos-staging.pages.dev` e exige confirmação explícita do operador
e credenciais fornecidas apenas em ambiente. Ele autentica pela tela real do
CRM, confirma o bootstrap, a navegação Financeiro, as três abas principais e
a troca de escopo para BarraShoppingSul. Não faz mutações financeiras.

Na execução controlada de 2026-07-22, o bootstrap devolveu exclusivamente os
grants empresariais Novo Hamburgo e BarraShoppingSul; as requisições Financeiro
(`bootstrap`, contas, categorias, favorecidos, tags, centros de custo,
movimentações e resumos) retornaram `200`. Após o teste, a flag retornou a
`false`, os dois grants temporários foram removidos e todas as identidades
`finstage*` permaneceram inativas.

Após a publicação da aba **Títulos**, o smoke foi reforçado para não aceitar
apenas o cabeçalho estático: ele aguarda explicitamente `GET
/api/finance/obligations` e exige `200`. A repetição controlada confirmou a
sessão CRM, os dois grants empresariais, a troca para BarraShoppingSul e as
abas Visão geral, Movimentações, Títulos e Cadastros. O trace registrou `200`
para `bootstrap`, contas, cadastros, resumo, movimentações e títulos. A limpeza
posterior confirmou novamente `module_enabled=false`, zero grants e a identidade
temporária desativada com `session_version` incrementado.

O resumo gerencial de títulos foi publicado no SHA `d6b8d86e`, com os deploys
de Worker e Pages concluídos. Em uma janela posterior, o smoke autenticado
confirmou a aba **Títulos**, a mensagem “Posição e previsão de 30 dias” e
`GET /api/finance/obligations/summary` com `200` pelo proxy Pages. A execução
terminou com a flag novamente em `false`, zero grants e zero identidades de
teste ativas. A consulta usa somente o escopo concedido e separa valores por
moeda; não cria movimentos de caixa.

A migration aditiva `0012_finance_obligation_recurrences.sql` foi aplicada ao
D1 de staging pelo journal Financeiro antes da validação das rotas de
recorrência. A conferência remota registrou a migration como `applied`, com a
flag ainda desligada e zero grants. Regras recorrentes continuam sendo somente
templates de títulos; não há execução automática, nem escrita no razão nesta
etapa.

O shell atual também disparou seis `503` de superfícies não Financeiras
(`instagram/status` e referências/relatórios de Atendimento). Eles não
afetaram nenhuma rota Financeiro e não autorizam ignorar a dívida do ambiente:
o smoke registra esses endpoints na evidência privada para acompanhamento dos
respectivos módulos.

## Importações controladas pela API de staging

O comando `npm run finance:staging:import-smoke -- --source <tipo> --fixture
<arquivo>` executa login CRM real, propaga cookie e CSRF ao gateway e faz
somente o staging normalizado por padrão. Ele exige confirmação explícita
`FINANCE_STAGING_SMOKE_ACK=1`, destino fixo
`https://api-staging.skincos.com.br` e credenciais/escopo fornecidos apenas no
ambiente privado do operador. `--commit --undo` exige também IDs de conta e
categorias do cenário controlado; não há valor padrão, secret, cookie ou alvo
de produção no script.

Na segunda janela de 2026-07-22, o CSV genérico passou por staging,
reimportação exata, decisão de transferência, commit idempotente e undo: duas
linhas committed, uma `exact_duplicate`, duas reversões e operações `commit`/
`undo`. O MoneyWiz criou um lote `moneywiz/v1` com candidatos de transferência
e nenhuma linha de razão. O Caixa EF criou um lote `ef-caixa/v1`; uma linha
válida foi committed e compensada, enquanto duas permaneceram em revisão. A
consulta ao D1 confirmou que o único movimento EF terminou `cancelled` e que as
operações `commit` e `undo` são append-only.

## Condição para smokes autenticados da versão atual

1. Reconfirmar flag desligada e zero grants antes de criar identidades de teste
   temporárias.
2. Reexecutar a matriz completa pela interface, incluindo estados de vazio,
   erro, navegação e bloqueio de URL direta.
3. Cobrir em staging CSV, MoneyWiz, Caixa EF, splits, parcelas, estornos,
   conciliação, anexos por metadados e AP/AR antes de considerar a validação
   integral concluída.
4. Manter o contexto pessoal inativo em todos os cenários.

## Procedimento de migrations

`finance/scripts/apply-d1-migrations.sh` mantém um journal próprio em
`finance_release_migrations`, com checksum e origem (`applied` ou `adopted`).
Em uma base Financeiro existente e sem journal, a adoção é uma ação explícita:
ela verifica os objetos das versões históricas antes de registrar `0001` a
`0006`, então aplica somente as migrations novas. Em uma base vazia, o comando
aplica todas em sequência. O script falha se detectar checksum diferente.

Nenhum recurso de produção foi consultado ou alterado nesta auditoria.
