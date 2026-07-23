# Isolated staging foundation

This is a non-production control surface for the next domain-separation phase.
It owns no customer or staff data and is intentionally not mounted on a
`skincos.com.br` route. Each domain receives an independent Workers URL, D1,
R2 bucket, KV namespace, source queue and dead-letter queue.

`fixtures.sql` creates only synthetic control rows. `module_enabled` is written
as the literal string `false` in every KV namespace before deployment. The
only Worker secret is `STAGING_CONTROL_TOKEN`; its value is generated outside
Git and never appears in this repository.

The control endpoint accepts a queue probe only with that secret and records a
non-personal receipt in its own D1. This proves binding and asynchronous
delivery without enabling a product capability.

The actual Identity, Inventory and Finance runtimes are not rebound by this
foundation: doing so requires their individual data migration and promotion
gates. The inventory, API, Pages and workforce staging services already remain
separate deployment units and are listed in the inventory.

## Operating contract

- No route under `skincos.com.br` is attached to these Workers. Their only
  ingress is the individual `workers.dev` address recorded in
  [`staging-resource-inventory.json`](./staging-resource-inventory.json).
- Every domain has its own D1, R2 bucket, KV namespace, source queue and DLQ.
  It must not be rebound to another domain's resource.
- `STAGING_CONTROL_TOKEN` is a Cloudflare Worker secret. It is intentionally
  absent from Git, build logs and this inventory. `DOMAIN`, `ENVIRONMENT` and
  `APP_VERSION` are non-secret variables committed in each Wrangler file.
- The only seeded D1 row is a synthetic control fixture with
  `contains_personal_data = 0`. Production exports, backups and customer data
  are prohibited unless an approved sanitisation run is recorded separately.
- `module_enabled` is `false` in each remote KV namespace. This foundation
  does not activate any product module.

## Repeatable validation

Run from Ubuntu-24.04 with the Cloudflare account already authenticated:

```bash
ALLOW_STAGING_SECRET_ROTATION=1 bash platform/staging-foundation/validate.sh
```

The command explicitly rotates the staging-only probe secret for each Worker,
then validates health, readiness, feature-flag default, fixture privacy and the
source-queue-to-consumer round trip. Rotation creates a new **staging** Worker
version, so record the execution in the change log; it never touches a
production Worker. The resulting deployed version can be inspected with
`npx wrangler deployments list --name <worker> --json`.

Use `npx wrangler deploy --dry-run --config <file>` to validate bindings without
deploying. PostgreSQL bootstrap is intentionally separate: apply
`postgres-bootstrap.sql` as a local PostgreSQL administrator, then generate
login credentials only at the domain runtime cutover and store them in the
approved secret manager.
