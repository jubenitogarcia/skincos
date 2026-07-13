# Modular Envelope

Skincos is moving from top-level technical buckets to a domain-first envelope.

## Canonical module roots

- `modules/site-public/website/`
- `modules/crm/web/`
- `modules/crm/api/`
- `modules/automations/n8n/`
- `modules/meta-ads/meta-ads/`
- `modules/whatsapp/whatsapp/`

## Transitional roots

- `backend/` remains active only for shared infrastructure and modules not yet
  redistributed by domain

## Cross-cutting roots

- `platform/`: shared reusable code and contracts
- `ops/`: repo-level orchestration and runtime guidance
- `archive/`: rollback-only or deprecated material

The root `package.json` should behave as an orchestrator and expose module-aware
commands rather than encoding technical-root assumptions.
