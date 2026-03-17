# Cloudflare Security Sync (WAF/rate limit) — Setup

Este repositório inclui um script versionado para manter configurações de segurança no Cloudflare consistentes:

- Bot Fight Mode (best-effort)
- Rate limiting para `POST /api/booking/request`

## Como roda

- Manual/agenda: workflow `Sync Website Cloudflare Security` (`.github/workflows/sync-website-cloudflare-security.yml`)
- Também roda no deploy após `npm run deploy` (`.github/workflows/deploy-website-cloudflare.yml`)

## Requisitos

GitHub Secret:
- `CLOUDFLARE_SECURITY_API_TOKEN` (preferido)
- `CLOUDFLARE_API_TOKEN` (fallback)

O token deve ter permissões suficientes na zona `espacofacial.com` para:
- Ler zona
- Editar rulesets/rate limiting
- (Opcional) editar Bot Fight Mode

## Rodar manualmente

Local:
```bash
CF_ZONE_NAME=espacofacial.com npm run cf:security
```

Validação de drift:
```bash
CF_ZONE_NAME=espacofacial.com npm run cf:security:check
```

## Observação

O deploy valida o estado final com `cf:security:check`; falha de segurança deve bloquear publicação.
