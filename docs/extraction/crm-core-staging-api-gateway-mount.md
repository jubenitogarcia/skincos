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

`GET /crm/session` é a única capacidade de sessão adicionada a esse mount. O
gateway central resolve a sessão Identity ainda dentro do seu limite privado,
extrai somente `identitySubject` opaco, `role` e `scopes`, e pede ao emissor
Identity de staging um envelope novo, via service binding e HMAC exclusivo do
caller `crm-api-staging-v1`. O envelope emitido é então o único valor interno
adicionado como `x-identity-delivery` para o Core. Ele é vinculado ao alvo
exato `GET /api/crm/session`, sem query e sem corpo; o Core continua
responsável pela assinatura, alvo canônico, expiração e proteção contra replay.
Não há cookie, perfil, nome de usuário, e-mail ou envelope fornecido pelo
navegador nesse tráfego.

O único navegador autorizado para essa capacidade de staging é
`https://crm-staging.skincos.com.br`. O gateway responde CORS com credenciais
somente para essa origem e inclui as falhas de sessão nessa mesma política, para
que o Console possa distinguir uma sessão ausente de uma falha de rede. O
preflight é limitado a `GET` e aos cabeçalhos `Accept` e `Cache-Control`; ele
não resolve Identity, não emite envelope e não chama o Core. Qualquer outra
origem, método ou cabeçalho é recusado sem ampliar a superfície CORS. Quando
um pedido de navegador traz uma origem diferente, ele também é recusado antes
de consultar Identity ou o Core; pedidos internos sem `Origin` preservam a
capacidade de smoke sintético autenticado por serviço.

Assim, depois de uma publicação de staging explicitamente autorizada, os
smokes sem identidade são:

```text
GET https://api-staging.skincos.com.br/crm/health
GET https://api-staging.skincos.com.br/crm/ready
```

Eles devem refletir o artefato e o D1 dedicados do CRM Core. A rota não ativa
módulos, leituras de domínio ou escritas: o Core mantém esses caminhos fechados
até que seus contratos e gates próprios estejam completos.

Quando os três artefatos de staging estiverem no SHA liberado (gateway, emissor
Identity e Core), a prova adicional é `GET /crm/session`: ela deve responder
somente a projeção verificada `{ ok, identity, requestId }`, sem PII e sem
cookie. Um caller ausente, uma sessão sem subject opaco, query, método diferente
de `GET`, binding indisponível ou assinatura inválida devem falhar fechados.

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
- `disable` desativa primeiro o caller do gateway e depois o emissor, sem
  apagar a chave necessária para uma recuperação controlada.

Cada mutação revalida o lease `global:ponto-workers-writer` ou
`global:staging-d1` imediatamente antes de ocorrer. A automação está pronta
como código, mas não é uma autorização para executá-la: enquanto o Core de
staging estiver em reconciliação concorrente, nenhum bootstrap, ativação ou
smoke autenticado deve ser despachado. Não há operação, segredo ou alvo de
produção nesse fluxo.
