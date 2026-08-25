# Influencer Intelligence internal runtime registration

This milestone registers the internal service/API and the read-only MCP as
loopback systemd units. Registration is not activation: the installer leaves
both units disabled, the generated private configuration defaults the module
flag to `false`, and empty tokens fail closed. No production unit, user grant,
Token Vault secret, live Orb workflow, or provider call is changed by the
source registration.

## Registered surfaces

| Surface | Source | Default | Boundary |
| --- | --- | --- | --- |
| Internal service/API | `runtime/server.mjs` | loopback `127.0.0.1:8899`, flag off | owns fixed routes, auth, grant, PostgreSQL boundary, audit and snapshot operation dispatch |
| Read-only MCP | `runtime/mcp-server.mjs` | loopback `127.0.0.1:8767`, flag off and bearer empty | validates bearer/grant and delegates every tool to the internal service |
| CRM upstream | `crm/console/functions/api/influencer-intelligence/[[path]].ts` | server flag false; no grant assignment | signs only allowlisted internal paths with actor scope and the fixed module grant; public `/analysis` maps to CRM-only `/dashboard` |
| Orb scheduler | independent Orb repository (`https://github.com/jubenitogarcia/orb`) | `active: false`, shadow source only | selects, bounds, retries and records; it never owns providers, analytics or scoring |

The external Orb read-only gateway remains a separate gateway for Orb
inspection tools. The Influencer Intelligence MCP unit does not widen that
surface; it reuses the same read-only controls through the domain adapter and
delegates to the internal service.

## Authentication and gates

The service checks the flag before opening the read path. CRM requests require
the HMAC actor headers and signature version `2`; the signed payload includes
method, internal path, query, actor scope and
`module.influencer-intelligence.access`. Orb and MCP service-to-service calls
require a private environment token, the fixed grant header, and an explicit
caller (`orb-scheduler` or `mcp-readonly`). The MCP transport additionally
requires its private bearer token.

Tokens are read from a private environment file and are never committed,
placed in a URL, returned in a response, or written to audit. Empty or missing
tokens are invalid. Every accepted operation produces a redacted JSONL audit
event; audit failure returns `AUDIT_UNAVAILABLE` instead of a successful
result.

The service exposes only fixed, bounded paths. The dashboard projection is
available only to the signed CRM caller; MCP receives the narrower analysis
route. It does not accept provider URLs, SQL, shell, raw media/comments,
credential material, arbitrary workflow operations, or Instagram write actions.
Snapshot dispatch accepts only the
versioned shadow scheduler contract and reuses per-creator/time-bucket
idempotency keys. Active collection mode is rejected by the binding.

The official Meta Graph path is composed lazily through
`provider-runtime.mjs` and the existing Token Vault analytics transport only
after the flag, grant, Orb caller, database boundary, and all private Token
Vault configuration values are present. The current runtime does not create a
duplicate scraper or session. The existing instagrapi fallback remains an
injected bridge and is not registered from environment strings.

## Installation and default-off behavior

Use `scripts/runtime/install-influencer-intelligence-runtime.sh` for the
controlled registration. Dry-run renders both units and runs
`systemd-analyze verify`. Applying requires an immutable
`/opt/skincos/releases/<sha>/source` target. It refuses to replace an active
unit, installs only the two exact unit files, creates the private env file only
when absent, reloads systemd, and explicitly leaves both units disabled. It
never runs `systemctl enable` or starts a service.

The private file is intentionally blank for:

```text
INFLUENCER_INTELLIGENCE_SERVICE_TOKEN
INFLUENCER_INTELLIGENCE_MCP_BEARER_TOKEN
INFLUENCER_INTELLIGENCE_ACTOR_HMAC_KEY
INFLUENCER_INTELLIGENCE_TOKEN_VAULT_BASE_URL
INFLUENCER_INTELLIGENCE_TOKEN_VAULT_CREDENTIAL_REF
TOKEN_VAULT_ANALYTICS_API_TOKEN
```

The Token Vault base URL, opaque credential reference, analytics caller token,
and analytics database URL are operator-supplied private configuration. They
are not defaults and are not needed for health or registration checks. The
service consumes the caller token only when it composes the Meta Graph
transport after all runtime gates pass; the Meta access token remains inside
Token Vault.

The Token Vault Worker remains independently gated by
`INFLUENCER_INTELLIGENCE_ANALYTICS_MODE=off|shadow|active`. Registration does
not change that setting; the first controlled transport smoke uses `shadow`
with the CRM grant, Orb workflow, service units, and production routes still
disabled.

## Validation, promotion and rollback

Validation for this milestone is source and staging-contract validation only:

- focused Influencer Intelligence tests, including MCP transport and service
  flag/auth tests;
- all Influencer Intelligence contract tests with synthetic fixtures;
- JavaScript syntax checks for the runtime files;
- dry-run systemd unit rendering and `systemd-analyze verify`;
- workflow JSON/static checks proving `active: false`, private service auth,
  bounded retry, and no Instagram write action.

There is no production activation claim from unit installation, a health
response, a green PR, or a workflow export. Before any staging shadow run, an
operator must separately provision a least-privilege runtime database role,
deploy/verify the staging Token Vault analytics action, place scoped secrets
through the approved custody path, and assign the grant to an approved
staging actor. No such grant or secret is part of this PR.

Rollback is reversible: disable both exact units, restore the prior immutable
release, and preserve the private env file for operator review. No migration
rollback or historical deletion is required. If a service was already active,
the installer refuses registration rather than stopping it implicitly.
