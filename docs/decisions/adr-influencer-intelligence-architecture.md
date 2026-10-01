# ADR: Influencer Intelligence canonical architecture

- Status: accepted source contract; runtime remains registered but disabled.
- Version: `influencer-intelligence-architecture/v1`
- Scope: `social/influencer-intelligence/`.

This ADR records the read-only analytics boundary. It contains no database,
runtime, provider, session, user, or business mutation.

## 1. Decision and scope

Influencer Intelligence is a bounded, read-only analytics capability owned by
`social/influencer-intelligence`. It receives normalized evidence, produces
versioned analytics and score envelopes, and never publishes, engages, scrapes,
or stores credentials. Its consumers use contracts rather than local copies.

## 2. Current-state evidence

The existing Instagram integration owns OAuth, connection state and provider
transport. The new capability therefore uses injected adapters and accepts only
sanitized projections. The independent Orb project owns scheduling and retry;
its live workflow is the source of truth, not a repository snapshot.

## 3. Boundaries

`social/instagram` owns sessions and publication; this domain owns normalized
evidence, deterministic analytics and provenance; Token Vault owns credentials;
MCP and consumers are authenticated read-only presenters; PostgreSQL stores
minimal pseudonymous and append-only artifacts. No boundary forwards raw
provider payloads or direct contact identifiers.

## 4. Provider interface

Adapters expose `resolve_creator`, `get_profile`, `get_recent_media`,
`get_media_metrics`, `get_comments_sample`, and `get_profile_metrics` through
injected transports. Meta Graph is official-first; `instagrapi` is a bounded
fallback only after an explicit coverage gap. Policy and invalid-response
failures never fall back, and unavailable values remain `null`.

## 5. Canonical data model

The additive `influencer_intelligence` model contains a minimal creator
registry, provider bindings, append-only snapshots and metric observations,
derived analytics, score snapshots, structured signals and audit metadata.
Historical artifacts are immutable; recomputation creates a new version.

## 6. Provenance model

Every observation and derived artifact carries contract/provider/source type,
evidence state, observed/retrieved timestamps, opaque source reference,
algorithm/model version and bounded evidence references. Coverage is computed
from available and expected metrics; it is never caller-declared or zero-filled.

## 7. Score, confidence, and coverage contract

Score envelopes include score kind/value, confidence, coverage, evidence state,
providers, provenance, timestamp, algorithm version and structured signals.
Robust deterministic statistics limit viral outliers. Inferred signals carry
confidence, evidence references and model version and are never stated as
facts without evidence.

## 8. Internal API contract

The future internal service exposes bounded authenticated read routes for
creator analysis, dashboard projection, coverage, comparison and persisted
campaign fit. Inputs are opaque keys and bounded windows; arbitrary SQL,
credentials, provider account ids and mutation operations are rejected.

## 9. MCP read-only contract

MCP presents bounded search, profile, snapshot, media, analytics, score,
comparison and persisted Campaign Fit reads. It requires authentication and a
grant, sanitizes output, enforces limits/timeouts/rate limits, writes only
redacted audit metadata, and delegates to the internal service. It cannot call
providers, shell, SQL, or workflows directly.

## 10. Feature flag and release model

The server-side flag is `INFLUENCER_INTELLIGENCE_ENABLED=false` with
`off -> shadow -> active`. Runtime registration and a green test do not activate
users. Promotion requires an immutable release, exact dependency closure,
scope/grant evidence, authenticated smoke, SLO and rollback identity.

## 11. Privacy and data minimization

Only opaque creator keys, optional normalized public handles, scalar metrics,
bounded aggregates and provenance are retained. Credentials, cookies, raw
provider payloads, media binaries, raw comments and direct contact fields are
excluded by contract. Retention and deletion decisions are versioned and
auditable.

## 12. Observability and audit

Requests and provider attempts emit redacted request/correlation identity,
operation, provider, status, latency, coverage and algorithm metadata. Alerts
cover timeouts, unavailable spikes, fallback growth, coverage regression and
authorization/sanitization failures. Audit failure fails closed.

## 13. PostgreSQL and migration policy

Migrations are additive, destination- and role-checked, locked, timeout-bound,
idempotent and append-only where applicable. They run only through the owning
domain's controlled executor with a private checkpoint and readback. Rollback
repoints or records a marker; it never deletes historical evidence.

## 14. Implementation plan

M0--M13 deliver normalized contracts, provider routing, append-only evidence,
analytics, scoring, read-only MCP/CRM projections, privacy, calibration and
gap analysis. Each milestone has its own immutable source, disabled default,
validation, observability and rollback evidence.

## 15. Acceptance and rollback

Acceptance requires this ADR and the machine-readable manifest to agree on
providers, states, limits, privacy and rollout, with focused contract tests and
no live transport or mutation. Rollback is reverting the single-purpose source
change; it has no database, runtime, provider, session, user, or business data
impact.
