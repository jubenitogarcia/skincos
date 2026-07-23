# Topologia de publicação canônica — 2026-07-23

## Baseline e decisão

Este inventário foi revalidado contra `main` no commit `f02271d503e1c58e986ec159a7dcf9ee0d9339e7`.
O catálogo executável é `platform/deploy/operational-units.json`; o CI o valida por
`.github/scripts/validate-deploy-topology.mjs` dentro de
`.github/workflows/architecture-governance.yml`.

Uma unidade operacional tem exatamente um publisher de código. Todos os
publishers GitHub são manuais, usam `environment` explícito e serializam por
unidade/ambiente com `cancel-in-progress: false`. Um commit ou merge não publica
Workers, serviço nativo ou migration. O Pages também exige o controle externo
registrado abaixo, pois uma integração Git do fornecedor é outro publisher.

## Publishers de código e dados associados

| Unidade | Publisher canônico | Recursos publicados | Bancos/migrations inventariados | Segredos (somente nomes) |
| --- | --- | --- | --- | --- |
| Core Workers | `deploy-core-workers.yml` | `skincos-api`, `skincos-insumos` | `skincos-db`, `skincos-db-staging`; `inventory/migrations` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| CRM Pages | `deploy-crm-pages.yml` | Pages `skincos`, `skincos-staging` | sem migration | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Escala | `deploy-escala-api.yml` | Workers `skincos-escala`, `skincos-escala-staging` | D1 `skincos-escala`, `skincos-escala-staging`; `workforce/schedule/migrations-d1` | Cloudflare e `ESCALA_ACTOR_HMAC_KEY` |
| Ponto | `deploy-timekeeping.yml` | Workers `skincos-timekeeping`, `skincos-timekeeping-staging` | D1 `skincos-timekeeping`, `skincos-timekeeping-staging`; `workforce/timekeeping/migrations` | Cloudflare, chaves `PONTO_*`, `ESCALA_ACTOR_HMAC_KEY`, checkpoint D1 |
| Social Publisher | `deploy-social-publisher-worker.yml` | Worker Social Publisher | sem migration | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Meta Ads Report | `deploy-meta-ads-report-worker.yml` | Worker `skincos-meta-ads-performance-report` | D1 produção/staging; `ads/meta/apps/report-ingest-worker/migrations` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Site público | `deploy-website-cloudflare.yml` | Workers Espaço Facial, legal hub e ESFA redirector | D1 `espacofacial-booking`; `website/migrations` | Cloudflare e `CLOUDFLARE_SECURITY_API_TOKEN` |
| Runtime nativo | `docs/runbooks/lifecycle-runtime-cutover.md` | `orb`, `orb-proxy`, `messaging-whatsapp`, `crm`, `booking`, `cloudflare-orb`, `cloudflare-runtime` | PostgreSQL `n8n_runtime`; migrations de Orb, Atendimento e Booking | `/etc/skincos` (fora do GitHub) |

`skincos-api` e `skincos-insumos` permanecem uma única unidade de release: o
contrato e o D1 ainda são compartilhados. Ponto não publica mais o gateway/API.

## Superfícies inventariadas que não publicam código por GitHub

- Sincronizadores de configuração/secrets: `cloudflare-pages-sync-escala.yml`,
  `cloudflare-pages-sync-meta-ads-report-secret.yml`,
  `cloudflare-pages-sync-ponto.yml`,
  `cloudflare-sync-integrations-encryption-secret.yml`,
  `cloudflare-workers-sync-ponto-secrets.yml`,
  `sync-website-cloudflare-security.yml` e `website-instagram-sync.yml`.
  Eles podem alterar configuração e por isso continuam sujeitos a environments;
  o validador proíbe que passem a conter comando de publicação de código.
- Token Vault: Workers/D1 de produção e staging, migrations em
  `platform/security/token-vault/migrations`; não há publisher GitHub. O
  procedimento controlado está em `platform/security/token-vault/README.md`.
- Alert webhook: `platform/observability/alert-webhook/wrangler.toml`; sem
  publisher GitHub declarado. Está retido até possuir runbook de promoção
  verificável.
- Configuração do relatório Meta Ads em
  `orb/engine/cloudflare/meta-ads-performance-report/wrangler.jsonc`; não é
  publisher. A publicação desse Worker é exclusivamente o workflow Meta Ads.

Não há leitura de valores de secrets nesta auditoria. A separação efetiva de
valores entre os environments precisa continuar sendo confirmada no GitHub e
Cloudflare antes de cada promoção.

## Reconciliação externa de Pages

Após o merge da PR inicial, a leitura de `Cloudflare Pages` identificou que o
projeto `skincos` ainda estava ligado ao repositório `jubenitogarcia/skincos`
com deploys automáticos de produção e preview ativos. Isso publicou o preview
do commit `85f1ea5` e a produção do merge `a5e1c65`, fora de GitHub Actions.

O controle foi corrigido diretamente no projeto, sem criar deployment:

- `production_deployments_enabled=false`;
- `preview_deployment_setting=none`;
- `deployments_enabled=false`.

O catálogo exige esses valores esperados e a reconciliação operacional deve
consultar a configuração remota antes de qualquer promoção. O projeto
`skincos-app` também tem Git Provider, mas aponta para
`jubenitogarcia/insumos`; é uma superfície externa, fora desta `main`, e não
foi alterado.

## Caminhos removidos nesta mudança

Foram removidos apenas publishers redundantes quando a unidade já possui o
publisher acima: reconciliações de Core/CRM/Escala/Social, publisher legado de
Insumos, dispatcher pós-automerge, fallback pós-automerge e a via SSH do CRM.
O catálogo mantém essa lista como caminhos aposentados e o CI falha se qualquer
um voltar ao repositório.

## Critérios de aceite

1. O validador rejeita workflow que publique fora do caminho canônico, trigger
   automático, ausência de `environment`, concorrência incorreta ou recurso com
   dois publishers declarados.
2. A alteração é verificada por CI sem `workflow_dispatch`, sem `wrangler deploy`
   local e sem migration remota.
3. Após o merge, os workflows do commit de merge não incluem publisher de deploy
   e o Pages `skincos` está com seus deploys Git automáticos desabilitados; só
   uma execução manual aprovada pode iniciar promoção.

## Riscos conhecidos e próximos passos

- P1: a unidade Core ainda compartilha API, Inventory e D1; sua separação exige
  contratos e banco próprios antes de liberar publishers independentes.
- P1: Token Vault e alert webhook têm fonte/recurso inventariado, mas não um
  pipeline GitHub canônico. Não criar um segundo script; primeiro formalizar uma
  única promoção e testá-la em staging.
- P2: os sincronizadores de secrets/configuração não publicam código, mas ainda
  são mutações operacionais; mantê-los manuais, com environment e revisão.
- P2: a auditoria de workflow é estática e versionada. Mudanças diretas no
  dashboard ou no servidor nativo continuam exigindo reconciliação operacional
  separada; o controle de Pages acima é uma primeira verificação remota.
