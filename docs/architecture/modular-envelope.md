# Modular Envelope

Skincos is moving from top-level technical buckets to a domain-first envelope.

## Canonical module roots

- `website/`
- `crm/console/`
- `crm/api/`
- `ads/meta/`
- `messaging/channels/whatsapp/`

Orb/n8n is an external product boundary maintained in
[the independent Orb repository](https://github.com/jubenitogarcia/orb); this
envelope keeps only its integration contracts and observability references.

## Transitional roots

- `backend/` remains active only for shared infrastructure and modules not yet
  redistributed by domain

## Cross-cutting roots

- `platform/`: shared reusable code and contracts
- `ops/`: repo-level orchestration and runtime guidance
- `archive/`: rollback-only or deprecated material

The root `package.json` should behave as an orchestrator and expose module-aware
commands rather than encoding technical-root assumptions.
