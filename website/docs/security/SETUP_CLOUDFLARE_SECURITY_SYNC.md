# Cloudflare Security Sync (WAF/rate limit) — Setup

Este repositório inclui um script versionado para manter configurações de segurança no Cloudflare consistentes:

- Bot Fight Mode (best-effort)
- Rate limiting para `POST /api/booking/request`

## Como roda

- Manual/agenda: workflow `Sync Cloudflare Security` (`.github/workflows/sync-cloudflare-security.yml`)
- Também roda no deploy (best-effort) após `npm run deploy` (`.github/workflows/deploy-cloudflare.yml`)

## Requisitos

GitHub Secret:
- `CLOUDFLARE_API_TOKEN`

O token deve ter permissões suficientes na zona `espacofacial.com` para:
- Ler zona
- Editar rulesets/rate limiting
- (Opcional) editar Bot Fight Mode

## Rodar manualmente

Local:
```bash
CF_ZONE_NAME=espacofacial.com npm run cf:security
```

## Observação

O step de sync no deploy usa `continue-on-error: true` para não quebrar a publicação caso o token/permissões não suportem alguma configuração.

