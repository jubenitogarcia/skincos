# CRM Core — receipt de retirada do legado

**Estado:** `cutover-operacional-concluido-proxy-contrato-retido`

**Observado em:** 2026-09-22 (America/Sao_Paulo)

Este recibo fecha a classificação do CRM Core após o cutover. O produtor único
de implementação, dados, migrations, runtime, publicação e rollback é o
repositório privado `jubenitogarcia/crm`; o monorepo `skincos` não contém uma
cópia, mirror, submódulo ou publisher do CRM Core.

## Fonte e runtime canônicos

| Item | Readback |
| --- | --- |
| Repositório | `jubenitogarcia/crm` / `main` |
| Release | `e0fd9f487e95e065c73e5abf9e40bf127c588b67` |
| Artifact digest | `sha256:a7649125aae0b30f261b43a1a50649f97f9591d4e453170a78c13d0632d75d7b` |
| Core Worker | `skincos-crm-core` / versão `07fed280-7c14-4f0d-b48d-e0cc186a2a83` |
| Core deployment | `34ff8f2d-7bd2-47de-87f7-b5aadc385898` |
| Identity resolver | versão `8015274e-c7b0-472d-ace7-701169cfed0e` (R7, 100%) |
| Identity issuer | versão `24ff08eb-6e34-427d-ae19-514a523231cd` (R3, 0% na composição version-pinned) |
| API gateway | `skincos-api` / versão `eddc27ba-6ad4-4309-a371-059dfd1bc385` |
| API deployment | `ded7ab69-5d41-4e2d-97b1-11d2a9165cd4` |
| D1 | `skincos-crm-core` (`c8dae283-f23a-461e-bde0-0bbee0cc405a`) |

O D1 é exclusivo do CRM Core e mantém a linhagem `0001`–`0005`. A leitura de
produção permanece vazia (`crmRows=0`); nenhum dado de cliente foi copiado para
staging ou usado no smoke.

## Evidência de cutover

- `https://crm.skincos.com.br/health` e `/readiness` retornam `200` com o
  release e digest acima.
- `https://api.skincos.com.br/crm/session` e `/crm/projections` sem identidade
  retornam `401 CRM_IDENTITY_REQUIRED`.
- Smoke público sintético, com sessão em memória e sujeito sintético, atravessa
  o gateway, o emissor Ed25519 e o Core: `gatewayStatus=200`, `coreOk=true`.
  O endpoint temporário do smoke foi removido e o mesmo caminho retorna `404`.
- CORS permitido para `https://crm.skincos.com.br` retorna `204`; origem não
  permitida retorna `403`.
- O drill externo coordenado foi `API eddc -> a8c -> eddc`, `Core 07fed ->
  a267 -> 07fed` e `Identity R7/I3 -> resolver b2/I3 -> R7/I3`; cada estado
  respondeu health/readiness antes da restauração final.

## O que foi retirado do monorepo

Não existe mais no `skincos`:

- implementação de CRM Core, console do CRM Core ou D1/migrations do CRM Core;
- workflow/publisher que construa ou publique o Worker/Pages do CRM Core;
- importação por caminho local para `jubenitogarcia/crm`;
- segundo owner para os dados, release ou rollback do CRM Core.

## Superfície residual permitida

Os itens abaixo permanecem deliberadamente no monorepo e **não são runtime do
CRM**:

1. `api/src/gateway.js` — proxy de transporte e envelopes do API público;
2. `api/src/crm-core-production-receipt.js` — validação do recibo assinado e
   version override do service binding;
3. `api/wrangler.toml` — binding `CRM_CORE` usado pelo único gateway público;
4. testes de contrato/fail-closed para impedir fallback ao runtime antigo.

Esses itens pertencem ao owner `api`, não ao owner `crm`. Eles não publicam,
migram, armazenam dados ou implementam regras do CRM. O default versionado do
gateway permanece fail-closed (`CRM_CORE_PRODUCTION_ENABLED=false`); a ativação
operacional só existe na configuração protegida do deployment aprovado.

Retirar essa ponte agora quebraria a superfície pública `/crm/*`. Sua remoção é
uma evolução posterior do owner `api`, condicionada a todos os consumidores
migrarem para o endpoint do CRM e a um novo recibo de cutover; mantê-la como
proxy explícito não cria dupla publicação nem dependência de implementação.

## Ownership e rollback

- `jubenitogarcia/crm`: código, D1, migrations, Worker, Pages, secrets do
  runtime, release e rollback do CRM Core.
- `jubenitogarcia/skincos` (`api`): apenas gateway, autorização de rota,
  observabilidade de transporte e contrato público.
- Identity permanece owner do emissor/recebedor assinado; o CRM somente valida
  o envelope e o API obtém a versão pinned pelo recibo.

As versões anteriores continuam retidas como alvos de rollback. Nenhuma versão
temporária de smoke está ativa; a composição final é API `eddc` 100%, Core
`07fed` 100% e Identity R7 100% com I3 version-pinned.

Este documento é uma attestation operacional vinculada ao commit que o integra;
não contém secrets, tokens, JWS bruto, PII ou valores de chave privada.
