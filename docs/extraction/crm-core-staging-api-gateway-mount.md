# Mount central de staging do CRM Core

## Objetivo e limite

Esta mudança prepara somente o gateway Worker de staging `skincos-api-staging`
para encaminhar o prefixo público `https://api-staging.skincos.com.br/crm/*`
ao Worker independente `skincos-crm-core-staging`. Ela não publica nada por si
só: não houve deploy, mudança de rota Cloudflare, migração, segredo, dado de
cliente ou alteração de produção.

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

Antes de encaminhar, o gateway cria uma nova lista explícita de somente cinco
cabeçalhos: `Accept`, `Content-Type`, `Origin`, `x-request-id` e
`x-identity-delivery`. `Origin` permite a política CORS que pertence ao Core,
`Content-Type`/`Accept` preservam a semântica HTTP do navegador e
`x-request-id` preserva a correlação. O único envelope de identidade que pode
prosseguir é `x-identity-delivery`; o Core continua responsável por verificar
assinatura, alvo canônico, expiração e replay. Todo outro cabeçalho — inclusive
`Cookie`, `Authorization`, CSRF, tokens de serviço, proxy/Cloudflare e futuros
cabeçalhos de credencial — é descartado. Respostas também não encaminham
`Set-Cookie`.

Assim, depois de uma publicação de staging explicitamente autorizada, os
smokes sem identidade são:

```text
GET https://api-staging.skincos.com.br/crm/health
GET https://api-staging.skincos.com.br/crm/ready
```

Eles devem refletir o artefato e o D1 dedicados do CRM Core. A rota não ativa
módulos, leituras de domínio ou escritas: o Core mantém esses caminhos fechados
até que seus contratos e gates próprios estejam completos.

## Publicação futura de staging

O owner continua sendo o monorepo, pelo workflow
`.github/workflows/deploy-core-workers.yml`, com `unit=api` e `target=staging`.
Ele exige a promoção do SHA exato, o UUID de afinidade de Timekeeping e os
gates/credenciais Cloudflare já custodidos pelo ambiente. Nenhum segredo novo
do CRM Core é necessário para o service binding, mas a mudança não deve ser
publicada fora desse fluxo.

Antes de qualquer deploy, registrar a versão ativa de `skincos-api-staging` e
o rollback correspondente; depois, conferir os dois smokes acima, a rejeição
de `/api/crm/*`, a ausência de `Set-Cookie` e a preservação de todas as rotas
Inventory, Finance e Ponto. A rota do shell `crm-staging.skincos.com.br`
continua deliberadamente fora deste PR.

## Pendência conhecida

O emissor Identity de staging ainda não tem caller persistente sob custódia do
CRM para emitir envelopes de navegação/negócio. Portanto este mount permite
health/readiness sem credencial de identidade, mas não é uma ativação de UI,
backfill, leitura de domínio, escrita ou cutover de produção.
