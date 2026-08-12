# Read-only provider transports

Status: source-complete for the analytics transport gate; staging verification
and a scoped credential are still required before any live collection. The
Influencer Intelligence flag, CRM grant, MCP registration, Orb workflow and
PostgreSQL migrations remain off/unapplied.

## Request path

```text
Influencer Intelligence provider router
  -> Meta Graph provider adapter (official first)
  -> Token Vault analytics operation
  -> Meta Graph HTTPS GET projection
  -> normalized provider envelope
  -> controlled instagrapi adapter only on explicit provider gaps
```

The domain transport is
[`transports/token-vault-meta-graph.mjs`](./transports/token-vault-meta-graph.mjs).
It sends an internal operation envelope to:

`POST /internal/token-vault/v1/analytics/operations`

The Token Vault operation is a command envelope only; its outbound provider
request is always an allowlisted `GET` to `https://graph.facebook.com/v20.0`.
There is no arbitrary Graph path, method, field projection, scraper, session
transport, media download, or Instagram write action.

## Credential custody and scope

- The analytics caller uses `TOKEN_VAULT_ANALYTICS_API_TOKEN`, never the
  operational n8n token.
- The request carries an opaque `credential_ref`; it never carries a clear
  access token or session.
- Token Vault reads only an active `instagram` credential whose metadata
  contains `analytics_scopes: ["influencer-intelligence"]`.
- The Meta credential is decrypted only inside Token Vault and is sent to
  Graph in an `Authorization: Bearer` header. It is never returned to the
  domain, logged, audited as a value, or placed in a URL.
- The existing D1 schema is sufficient; this gate adds no migration.

## Operations and safety

The fixed projection covers `resolve_creator`, `get_profile`,
`get_recent_media`, `get_media_metrics`, `get_comments_sample`, and
`get_profile_metrics`. Counts are copied only when Graph returns a validated
non-negative integer. Missing fields remain absent; an explicit Graph zero is
preserved as zero. Comment collection stores aggregate counts only and never
returns comment text or commenter identifiers.

The Worker applies a bounded request body, in-process active-request and
per-minute ceilings, a ten-second Graph timeout, and an audit event for every
attempt. Permission/coverage gaps are returned as an unavailable provider
candidate. Timeout, rate-limit, malformed-response and upstream failures are
structured errors so the router can apply its bounded retry/circuit policy.
Audit failure fails closed.

## Fallback policy

`provider-runtime.mjs` always constructs Meta first. The existing instagrapi
adapter is registered only when the caller injects the already-approved
read-only operation set from `social/instagram`; the module does not import
instagrapi, Instaloader, a simulator, or a new scraper. Fallback is permitted
only for the router's explicit gap classes. Policy, malformed-response and
unclassified failures remain terminal.

## Staging gate and rollback

1. Confirm the current staging Worker deployment and route before changing
   anything.
2. Add only the staging secret `TOKEN_VAULT_ANALYTICS_API_TOKEN` through the
   approved private stdin path; never place it in a file, argument, repository,
   or evidence bundle.
3. Deploy the Token Vault Worker to the staging environment only.
4. Check health/contract, exercise synthetic invalid-scope and bounded fixture
   requests, and perform at most one explicitly approved read-only Meta smoke
   if a scoped staging credential already exists.
5. Keep `INFLUENCER_INTELLIGENCE_ENABLED=false`, the grant absent, and all
   scheduling/CRM/MCP registrations inactive.

Rollback is redeployment of the previously recorded staging Worker version and
removal/rotation of only the staging analytics secret if required. Production
routes, production secrets, external providers and bulk collection are outside
this gate.
