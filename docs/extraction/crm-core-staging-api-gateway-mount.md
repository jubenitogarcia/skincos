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

Para próximas publicações, registrar a versão ativa de `skincos-api-staging` e
o rollback correspondente; depois, conferir os dois smokes acima, a rejeição
de `/api/crm/*`, a ausência de `Set-Cookie` e a preservação de todas as rotas
Inventory, Finance e Ponto. A rota do shell `crm-staging.skincos.com.br`
continua deliberadamente fora deste PR.

## Pendência conhecida

O emissor Identity de staging ainda não tem caller persistente sob custódia do
CRM para emitir envelopes de navegação/negócio. Portanto este mount permite
health/readiness sem credencial de identidade, mas não é uma ativação de UI,
backfill, leitura de domínio, escrita ou cutover de produção.
