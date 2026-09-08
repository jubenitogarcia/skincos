# Mount central de staging do CRM Core

## Objetivo e limite

Esta mudança prepara somente o gateway Worker de staging `skincos-api-staging`
para encaminhar o prefixo público `https://api-staging.skincos.com.br/crm/*`
ao Worker independente `skincos-crm-core-staging`. O PR não publica nada por si
só; a publicação foi feita depois, exclusivamente pelo workflow oficial de
staging. Na mudança do PR não houve deploy, mudança de rota, migração, segredo,
dado de cliente ou alteração de produção.

O binding está declarado exclusivamente em
[`api/wrangler.toml`](../../api/wrangler.toml) como `CRM_CORE` dentro de
`[env.staging]`. O runtime também retorna `404 crm_core_staging_only` fora de
`ENVIRONMENT=staging`, inclusive se alguém introduzir um binding indevido no
futuro. Não existe contraparte em produção.

## Contrato da rota

O gateway preserva integralmente `/crm/*` e sua query ao chamar o service
binding. O Worker Core é o único componente que traduz esse caminho público
para o alvo canônico privado `/api/crm/*`; não há redirecionamento ou fallback
para `/inventory/*`.

Antes de encaminhar, o gateway cria uma nova lista explícita de somente quatro
cabeçalhos públicos: `Accept`, `Content-Type`, `Origin` e `x-request-id`.
`Origin` permite a política CORS que pertence ao Core, `Content-Type`/`Accept`
preservam a semântica HTTP do navegador e `x-request-id` preserva a correlação.
Um `x-identity-delivery` recebido do navegador nunca prossegue. Todo outro
cabeçalho — inclusive `Cookie`, `Authorization`, CSRF, tokens de serviço,
proxy/Cloudflare e futuros cabeçalhos de credencial — também é descartado.
Respostas não encaminham `Set-Cookie`.

`GET /crm/session` e `GET /crm/projections?units=<csv-canônico-ordenado>` são
as duas capacidades Identity de staging deste mount. O gateway central resolve
a sessão Identity ainda dentro do seu limite privado, extrai somente
`identitySubject` opaco, `role` e `scopes`, e pede ao emissor Identity de
staging um envelope novo, via service binding e HMAC exclusivo do caller
`crm-api-staging-v1`. O envelope emitido é então o único valor interno
adicionado como `x-identity-delivery` para o Core. A sessão é vinculada ao alvo
exato `GET /api/crm/session`, sem query e sem corpo.

Para projeções, o gateway aceita somente `GET`, um único parâmetro `units` e
uma CSV já ordenada de slugs canônicos, sem duplicata, espaço, alias, parâmetro
extra ou outra codificação. O envelope é vinculado ao alvo interno exato
`GET /api/crm/projections?units=<a-mesma-csv>`. O Core ainda faz a interseção
autoritativa com os `scopes.units` verificados e devolve somente a resposta
opaca `crm-core/projection-read/v2`; o navegador não escolhe outro alvo, não
fornece JWS e não recebe cookie, perfil, nome de usuário ou e-mail.

As únicas origens de navegador autorizadas para essas capacidades de staging são
`https://crm-core-staging.skincos.com.br` (Console exclusivo) e
`https://crm-staging.skincos.com.br` (incumbente preservado durante a transição).
O gateway responde CORS com credenciais somente para a origem exata recebida
e inclui as falhas de sessão e projeções nessa mesma política, para
que o Console possa distinguir uma sessão ausente de uma falha de rede. O
preflight é limitado a `GET`, aos cabeçalhos `Accept` e `Cache-Control`, e ao
alvo de sessão ou de projeção já canônico; ele não resolve Identity, não emite
envelope e não chama o Core. Qualquer outra origem, método, query ou cabeçalho
é recusado sem ampliar a superfície CORS. Quando um pedido de navegador traz
uma origem diferente, ele também é recusado antes de consultar Identity ou o
Core; pedidos internos sem `Origin` preservam a capacidade de smoke sintético
autenticado por serviço.

Antes de pedir um envelope para projeções, o gateway rejeita unidades fora do
escopo explícito do ator, inclusive para `ADMIN`; o Core repete a decisão
autoritativa. A resposta do Core é limitada a 128 KiB e três segundos de leitura
do corpo, 100 projeções e ao contrato v2 fechado. Versão, correlação, unidades,
contagem, identificadores opacos, revisão, operação, data e duplicatas são
verificados antes de reconstruir a resposta. Campos extras, erros arbitrários,
cookies e cabeçalhos privados do upstream nunca são refletidos ao navegador.
Não há CORS com credenciais para `pages.dev`, produção ou wildcard. Esta
extensão é somente código até publicação governada e smoke do artefato exato.

Assim, depois de uma publicação de staging explicitamente autorizada, os
smokes sem identidade são:

```text
GET https://api-staging.skincos.com.br/crm/health
GET https://api-staging.skincos.com.br/crm/ready
```

Eles devem refletir o artefato e o D1 dedicados do CRM Core. A rota não ativa
módulos, escrita ou cutover: a leitura de projeções permanece limitada ao
contrato opaco v2, à interseção de unidades e aos gates próprios do Core.

Quando os três artefatos de staging estiverem no SHA liberado (gateway, emissor
Identity e Core), a primeira prova adicional é `GET /crm/session`: ela deve
responder somente a projeção verificada `{ ok, identity, requestId }`, sem PII
e sem cookie. A leitura de projeções exige depois a mesma cadeia Identity e uma
CSV de unidades canônica, e continua fechada enquanto o Core não estiver pronto
ou o escopo não for autorizado. Caller ausente, sessão sem subject opaco, query
ou método inválidos, binding indisponível ou assinatura inválida devem falhar
fechados.

## Readback da publicação de staging (2026-09-07)

O gateway foi publicado pelo workflow oficial com `unit=api`, usando o SHA
canônico `15c0f2f0bf45530f5f7ebb15b0a3e91cefc74aff` e o preview imutável
`34164739551`. A execução de staging foi `34165396727`; o lease global foi
liberado com sucesso. O readback externo final observou:

- `/crm/health`: `200`, `ok=true`, CRM Core `def3d5c8f714ff30e223c052e759f0d00cb97054`, digest `sha256:0d13042c00f00354497c6a64707211d6f7622dc3d8f7abfa97d6a055c456562e`;
- `/crm/ready`: `200`, `ok=true`, `reason=CRM_STAGING_READY`;
- `/crm/modules`: `200`, estado `pre-cut`, todos os módulos ainda indisponíveis;
- `/api/crm/health`: `404`, mantendo o prefixo legado fechado;
- cabeçalhos do gateway: ambiente `staging`, release `15c0f2f0bf45530f5f7ebb15b0a3e91cefc74aff`, sincronização `current`, sem `Set-Cookie`.

O rollback de staging foi ensaiado reimplantando o incumbente
`8126987694a2096cb1a5a3142939dd227132adc9` no workflow `34165274174`: as
rotas `/crm/health` e `/crm/ready` retornaram `404`, e `/api/crm/health`
continuou `404`. O candidato foi restaurado no workflow `34165396727`, com
gateway version id `2a6b9014-834c-45d4-8fd8-c4a3f0ace6a1`. Nenhuma dessas
execuções alterou produção, Site, Booking ou dados reais.

## Publicação de staging e owner operacional

O owner continua sendo o monorepo, pelo workflow
`.github/workflows/deploy-core-workers.yml`, com `unit=api` e `target=staging`.
Ele exige a promoção do SHA exato, o UUID de afinidade de Timekeeping e os
gates/credenciais Cloudflare já custodidos pelo ambiente. Nenhum segredo novo
do CRM Core é necessário para o service binding, mas a mudança não deve ser
publicada fora desse fluxo.

O caller persistente acrescenta dois segredos de staging com o mesmo valor
interno gerado uma única vez: `CRM_IDENTITY_ISSUER_CALLER_HMAC` no gateway e
`IDENTITY_CRM_DELIVERY_CALLER_HMAC` no emissor. Eles pertencem ao runtime
Cloudflare, nunca ao Git, ao navegador ou ao Core. O HMAC de smoke já existente
(`IDENTITY_CRM_DELIVERY_REQUEST_HMAC`) não é girado nem substituído. Ambos os
manifestos mantêm o caller desligado por padrão; uma ativação exige deploy de
staging no SHA exato, custódia confirmada nos dois Workers e readback da sessão
autenticada e negada. Não existe flag, binding ou rota de produção para essa
capacidade.

Para próximas publicações, registrar a versão ativa de `skincos-api-staging` e
o rollback correspondente; depois, conferir os dois smokes acima, a rejeição
de `/api/crm/*`, a ausência de `Set-Cookie` e a preservação de todas as rotas
Inventory, Finance e Ponto. A rota do shell `crm-staging.skincos.com.br`
continua deliberadamente fora deste PR.

## Estado do caller persistente

O contrato de caller persistente está implementado e coberto por testes no
owner correto: o monorepo Identity/gateway. Ele permanece propositalmente
desligado até a publicação coordenada dos três artefatos e a provisão de seus
segredos internos. Mesmo depois do smoke de sessão, isto não ativa UI de
negócio, backfill, leitura de domínio, escrita ou cutover de produção.

O workflow canônico `.github/workflows/identity-crm-delivery.yml` torna essa
prova repetível sem adicionar autoridade de produção. Ele aceita apenas um SHA
que já seja `main` e separa as operações em quatro etapas deliberadas:

- `bootstrap` gera uma única chave HMAC interna somente quando os dois nomes de
  segredo ainda não existem, grava-a nos dois Workers de staging sob a custódia
  global existente e deixa ambos os callers desativados;
- `activate` exige o SHA e o digest do Core que já estejam visíveis no readback
  externo, captura as versões incumbentes, habilita primeiro o emissor e depois
  o gateway, e restaura apenas uma versão que ainda esteja sob sua posse caso a
  ativação falhe;
- `session-smoke` cria uma identidade estritamente sintética no D1 de staging,
  comprova login e `GET /crm/session` sem cookie ou PII no relatório, e remove
  a fixture no mesmo run mesmo se o smoke falhar;
- `disable` desativa primeiro o caller do gateway e depois o caller do emissor,
  mantendo a entrega já ativa do emissor e sem apagar a chave necessária para
  uma recuperação controlada.

Cada mutação revalida o lease `global:ponto-workers-writer` ou
`global:staging-d1` imediatamente antes de ocorrer. A automação está pronta
como código, mas não é uma autorização para executá-la: enquanto o Core de
staging estiver em reconciliação concorrente, nenhum bootstrap, ativação ou
smoke autenticado deve ser despachado. Não há operação, segredo ou alvo de
produção nesse fluxo.

## Atualização do gateway ativo e prova de projeções

`identity-crm-delivery.yml` também fornece `refresh-gateway`, restrito ao
gateway de staging já ativo. Não é bootstrap nem nova ativação do emissor.
O dispatch exige `release_sha` igual ao `main` atual, tentativa 1,
`confirmation=refresh-crm-gateway-staging`, `crm_core_release_sha`,
`crm_core_artifact_digest`, `expected_api_version_id` e
`expected_issuer_version_id`. Os UUIDs são obtidos do readback imediatamente
anterior; não reutilizar valores de um relatório antigo.

O fluxo captura deployment e versão incumbentes, exige os dois callers ativos,
mantém a afinidade Timekeeping observada e sobe uma versão API ainda sem tráfego.
O upload explicita `CRM_IDENTITY_ISSUER_CALLER_ENABLED:true` e o caller canônico:
`--keep-vars` sozinho não substitui o `false` declarado no TOML. Antes do switch,
compara o conjunto completo de bindings tipados, inclusive nomes/tipos de
segredos, serviços, D1, R2 e namespaces, permitindo somente `APP_VERSION` novo.
Também exige a mesma compatibilidade. Nenhum valor secreto é lido ou escrito;
os valores de variáveis não são incluídos no relatório, somente seu digest.

Cada upload, switch e rollback exige o lease remoto existente e a posse
observada. A troca de tráfego usa somente a API de deployments do Worker
`skincos-api-staging`, sem a atualização auxiliar de settings do Wrangler.
O emissor não é publicado, e não há operação de segredo, migração ou dados.
Depois do switch, o readback comprova versão, bindings, emissor inalterado e
`401` com CORS nas duas origens exatas para sessão/projeções.

Falhas posteriores ao switch restauram o incumbente API somente quando o
deployment exato criado pela execução ainda detém o candidato a 100%. Um avanço
de `main` não impede esse rollback: continuam obrigatórios o checkout original,
o lease e a posse exata. Se a resposta de criação do deployment for incerta,
não há retry nem rollback presumido; o relatório registra a incerteza para
reconciliação. Upload recusado antes do switch deixa uma versão sem tráfego,
sem alterar o incumbente. O artefato `crm-gateway-refresh-<release_sha>` contém
apenas `crm-gateway-refresh-report.json`, com checkpoint e resultado sanitizados.

O smoke existente mantém `operation=session-smoke` e
`confirmation=smoke-crm-identity-staging`. `smoke_profile=session` permanece
padrão, preserva exatamente o relatório de sessão v1 e consome duas entregas
Identity. A prova original do Core deve continuar usando esse perfil.

Para comprovar a nova origem e as projeções, usar
`smoke_profile=session-and-projections`, com SHA/digest Core e os dois UUIDs
ativos exatos. Há readback tipado API/emissor antes das fixtures e depois do
teardown. As mesmas fixtures canônicas `nh`, `bss`, `both` e `admin` são
autenticadas pelo login Inventory; nenhuma permissão ou bypass é acrescentado.
A sessão NH deve continuar com zero permissões. As duas sessões usam as origens
nova e incumbente. Quatro leituras de projeção comprovam NH, BSS, união das duas
unidades e repetição NH na origem incumbente; origem Pages real, produção,
lookalike e `null` são rejeitadas, assim como ampliação de unidade e ADMIN vazio.

Esse perfil adiciona **quatro** receipts de projeções, além dos **dois** de
sessão: **seis no total**, sem escrever projeções ou alterar backfill. Uma unidade
sem eventos é um resultado válido, mas a união deve conter pelo menos um evento
opaco já disponível. O relatório não persiste eventos, referências, identidade,
cookie ou credenciais. O relatório de sessão continua v1, sem campos novos.

A prova adicional está em
`crm-identity-projection-smoke-<release_sha>/crm-identity-projection-smoke-report.json`.
Seu `schemaVersion` é 1; o contrato transportado é
`crm-core/projection-read/v2`. O parser exportado
`validateCrmProjectionSmokeReport` em
`scripts/crm-identity-staging-projection-smoke.mjs` exige os pins
`sourceSha`, `coreReleaseSha`, `coreArtifactDigest`, `gatewayVersionId`,
`issuerVersionId`, timestamp UTC canônico, origens exatas e contagens coerentes.
Os consumidores ainda devem comprovar o run GitHub terminal, SHA, tentativa,
teardown e liberação de lease; o arquivo isolado não concede autoridade.

Esses testes HTTP não equivalem a login/renderização no navegador: a inspeção
do console publicado e o uso do cookie existente no navegador continuam sendo
uma verificação separada. Não há fallback legado nem autoridade de produção.
