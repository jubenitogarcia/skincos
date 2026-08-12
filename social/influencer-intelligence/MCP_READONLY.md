# Influencer Intelligence MCP read-only adapter

M6 defines the domain adapter for the existing
`orb/engine/mcp-readonly-gateway` security pattern. It is source-controlled but
not registered in a live transport, imported into Orb, or enabled for users.
The adapter accepts an already authenticated context and an injected internal
read service. It never opens a provider connection, reads PostgreSQL directly,
executes SQL or shell, calls Token Vault, or starts a collection job.

## Boundary

The existing gateway owns transport, upstream authentication, local request
limits, process isolation, and JSONL audit conventions. This adapter owns the
Influencer Intelligence tool registry, closed input schemas, domain grant
check, bounded output contract, provider-neutral provenance, and fail-closed
sanitization. Keeping the adapter free of transport and provider imports
prevents UI/Codex callers from bypassing the internal service or the official-
first provider router.

The factory requires a read service with these read-only methods:

| MCP tool | Internal service method |
| --- | --- |
| `search_creators` | `searchCreators` |
| `get_creator_profile` | `getCreatorProfile` |
| `get_creator_snapshots` | `getCreatorSnapshots` |
| `get_creator_media` | `getCreatorMedia` |
| `get_creator_analytics` | `getCreatorAnalytics` |
| `get_creator_score` | `getCreatorScore` |
| `get_campaign_fit` | `getCampaignFit` |
| `compare_creators` | `compareCreators` |

M11 registers `get_campaign_fit` only as a read of a persisted, versioned
Campaign Fit projection. It accepts a bounded campaign key/version and an
optional bounded creator list; it never accepts a raw brief, recalculates a
fit, starts collection, or dispatches a campaign.

## Request controls

Every request requires `authenticated: true`, the server-side grant
`module.influencer-intelligence.access`, and an opaque `actor_scope`. Tool
arguments reject unknown properties and sensitive fields. Creator keys are
opaque internal identifiers; provider ids, tokens, sessions, raw comments, and
free-form provider payloads are not accepted.

The adapter measures and enforces a 64 KiB serialized request limit even when a
transport does not provide byte metadata. If a transport provides its own byte
count, both that count and the adapter's parsed-request measurement must be in
limit; they are not required to be byte-identical because equivalent JSON may
use different whitespace, escaping, or key ordering. The adapter also enforces a
512 KiB sanitized response limit,
50-item pages, at most 20 creators per comparison, at most a 365-day window,
four concurrent calls, a 12-second timeout/abort, and a fixed 60 requests per
minute per actor scope. Audit is mandatory and audit failure is fail-closed.
The injected service receives an abort signal and correlation/request id.

## Response contract

The service must return an envelope with `data`, `data_classification`,
`freshness`, `retrieved_at`, `confidence` or `confidence_score`, `coverage`,
`providers`, `provenance`, and `limitations`. The adapter normalizes the
envelope and emits `confidence_score` and `data_coverage` from bounded values.
`observed`, `derived`, `inferred`, and `unavailable` remain explicit. Missing
data is `null`, never numeric zero; unavailable results have zero confidence
and an explicit limitation. `stale` is represented by the freshness field and
must not be hidden by a successful response state.

Provenance is restricted to bounded provider/source references with timestamps
and evidence state. Raw payloads, credentials, authorization material,
unnecessary public identity fields (display names, biographies, locations and
account ids), PII, sessions, query-string URLs, and diagnostic upstream bodies
are rejected or removed before a result leaves the adapter. Provider-specific evidence is
therefore an opaque, bounded reference rather than a raw provider response.

The adapter only returns persisted or service-owned read projections. It does
not recalculate analytics, scores, weights, benchmarks, or campaign fit, and it
does not upgrade an inferred signal to observed. Campaign Fit remains separate
from the overall Influencer Score and returns its own confidence, coverage,
components, algorithm/weights versions, conflicts, and provenance.

## Runtime status and rollback

This milestone adds no migration, route, systemd unit, Orb import, provider
call, credential access, grant assignment, or feature-flag change. Keep
`INFLUENCER_INTELLIGENCE_ENABLED=false`, `mcpRuntimeRegistered=false`, and the
domain in `off` until the internal service and later M7/M8 gates are proven.

Rollback is a revert or closure of the single-purpose M6 change. No database,
provider session, workflow, or user-visible state is created by this adapter.
