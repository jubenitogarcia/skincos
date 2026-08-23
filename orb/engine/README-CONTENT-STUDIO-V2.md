# Content Studio n8n v2

O v2 recebe `production_request` e devolve `content_package`. O pacote não publica, agenda ou ativa anúncios.

Fonte de verdade: `scripts/build-campaign-creative-generator-v2.js`, contratos em `content-studio-v2/schemas`, serviços em `services/` e fixtures em `content-studio-v2/fixtures`. O builder legado permanece em `scripts/build-campaign-creative-generator.js` e no baseline.

```bash
npm run workflow:campaign-creative:v2:build
npm run workflow:campaign-creative:v2:validate
npm test
npm run workflow:campaign-creative:v2:dry-run
```

Execute estes comandos no WSL Ubuntu-24.04 deste host. Durante desenvolvimento mantenha `dry_run=true`, `provider_policy.mode=mock` e `max_cost=0`.
