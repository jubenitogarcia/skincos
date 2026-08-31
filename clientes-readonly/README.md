# Clientes Readonly boundary

This is the executable source boundary for the future private
`skincos-clientes-readonly` product. It remains unprovisioned: it owns no
database, has no Cloudflare bindings or routes, and cannot route production
traffic.

## Read-only contract

`clientes-readonly/v1` projects only `clientId`, `displayName`, `unitId`,
`status`, and `updatedAt`. The only data routes are `GET`/`HEAD
/v1/clientes` and `GET`/`HEAD /v1/clientes/:clientId`. Every other method is
rejected with `405 READ_ONLY_RUNTIME` before an adapter is called.

There is no fallback to the CRM runtime, commercial flows, Harmonia, Caixa, a
direct database, or an HTTP endpoint. The Worker entrypoint is limited to its
own runtime factory and all data comes from the explicitly injected
`CLIENTES_READONLY_READ_MODEL` interface.

## Required isolated adapters

The future deployment must configure both dependencies independently:

- `CLIENTES_READONLY_ACTOR_HMAC_KEY` stays in the isolated secret store. The
  actor adapter accepts only a short-lived HMAC envelope that is bound to the
  HTTP method and full path; browser identity headers are ignored.
- `CLIENTES_READONLY_ACTOR_REPLAY` implements `isReady()` and
  `claimNonce({ key, expiresAtMs })`. It is a dedicated replay ledger; an
  unavailable or repeated nonce fails closed.
- `CLIENTES_READONLY_READ_MODEL` implements `readiness()`,
  `listClientesReadonly()` and `getClienteReadonlyById()`, using
  `clientes-readonly/read-model/v1`. It receives the already-redacted actor
  and allowlisted query only. It owns its data and migrations separately from
  CRM.

Health is PII-free: `GET /health` is observable with HTTP 200 while disabled,
and `GET /readiness` plus data routes return 503 until the runtime, actor
adapter and read-model all prove ready.

## Staging and release gate

`wrangler.jsonc` declares only the standalone Worker name and a staging
environment with `CLIENTES_READONLY_DEPLOY_ENABLED=false`. It intentionally
contains no D1, KV, R2, service, route, trigger, secret, or production
environment. Consequently it cannot bind a CRM source or publish a ready
runtime by default.

`release/staging-gate.json` is the source-of-truth release declaration. It is
committed as not ready and `npm run release:gate` reports the missing facts.
Before a separate owner may add the sole deploy command, its plan must prove:

1. exact source and predecessor release SHAs, with a non-initial predecessor
   distinct from the release being evaluated;
2. a named single publisher/workflow, reused for rollback, and no public route;
3. a dedicated read-model service, data owner and migrations owner;
4. separate actor secret and replay-store custody;
5. a passing synthetic smoke and a tested rollback selection using the recorded
   predecessor artifact.

Rollback is never a redeploy from CRM. The gate requires a previously recorded
predecessor SHA distinct from the current source, a matching rollback artifact,
a recorded rollback test, and the same sole publisher workflow declared for the
release. A rollback operation must select that exact predecessor. The future
single publisher must keep the release disabled until those facts have external
evidence. No data rollback or destructive action is defined here.

## Local validation

```text
npm run check
npm run test
npm run smoke:synthetic
npm run release:gate
```

The synthetic smoke creates only in-memory data. It verifies health/readiness,
a signed list request, nonce replay rejection, field redaction, and the write
guard. It does not contact CRM, Cloudflare, a database, or any real identity.
