# OBS Alert Webhook

Webhook endpoint for uptime alerts.

## What it does
- Accepts `POST` JSON alerts.
- Validates `X-OBS-Token`.
- Creates a GitHub issue in `jubenitogarcia/skincos`.

## Deploy
```bash
cd platform/observability/alert-webhook
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put WEBHOOK_TOKEN
npx wrangler deploy
```

## Request format
Headers:
- `Content-Type: application/json`
- `X-OBS-Token: <token>`

Body example:
```json
{
  "source": "uptime-slo",
  "text": "[SLO][FAIL] run url ..."
}
```
