# Influencer Intelligence

Status: M0 contract-only, experimental, not exposed, and off by default.

This domain provides read-only intelligence about Instagram creators for
analysis, comparison, and campaign fit. It is not an engagement automation
surface, a publication surface, or a new scraping project.

## M0 decision

M0 establishes the boundary in
[`contracts.mjs`](./contracts.mjs). The contract is pure and versioned, and it
accepts only normalized evidence, structured signals, and score envelopes. It
does not make network calls, read secrets, persist data, schedule jobs, expose
HTTP, register a CRM module, or activate a feature flag.

The focused tests use only synthetic creator identifiers and provider-shaped
observations. They prove the contract rejects credentials, direct contact
identifiers, raw provider objects, query-string provenance, and unauditable
inferred signals.

## Concrete target architecture

```text
Codex
  -> skincos-influencer-intelligence skill (M7)
  -> read-only Influencer Intelligence MCP (M6)
  -> internal service/API (M2-M5)
  -> provider router
       -> Meta Graph official adapter (first preference)
       -> existing social/instagram instagrapi adapter (controlled fallback)
       -> optional future provider only after a documented gap (M13)
  -> PostgreSQL append-only snapshots (M1/M3)
  -> deterministic analytics and scoring (M4/M5)
  -> read-only CRM contract and dashboard (M8+)
  -> Orb scheduling/orchestration only (M3)
```

The provider boundary is intentionally closed in M0 to the two already
identified sources: `meta-graph` and `instagrapi`. No Apify, Modash,
Instaloader, or new scraper is introduced. The existing
`InstagramModuleSimulator` is not a source, and the temporary FastAPI surface
under `social/instagram/module/api/` must not be exposed as the domain API
without independent authentication, input, timeout, rate-limit, audit, and
deployment hardening.

### Incumbent integrations to reuse

- Official-first collection will wrap the existing CRM Graph adapter in
  `crm/console/functions/_lib/instagramGraph.ts` and its authenticated
  connection boundary in `instagramStore.ts`; the CRM UI must not call Graph
  or instagrapi directly.
- The controlled fallback will reuse the existing
  `social/instagram/module/instagram_site_sync.py` and its vendored instagrapi
  session path. It will not duplicate that implementation.
- Credentials belong in `platform/security/token-vault`. Clear tokens,
  cookies, authorization headers, and connection payloads never cross this
  contract. The existing Token Vault publish gateway is not silently treated
  as an analytics gateway; M2 must establish a separate read-only analytics
  allowlist/adapter before collection is implemented.
- Orb/n8n will schedule and resume jobs after the service contract exists. It
  will not become a provider, scoring engine, shell bridge, or arbitrary SQL
  executor.
- `website` Instagram cache data is not a historical intelligence source.
  Historical snapshots begin only when the additive PostgreSQL migration and
  retention policy are reviewed in M1/M3.

## Contract rules

`contracts.mjs` exposes these versioned shapes:

- `ProviderSnapshot`: an opaque internal creator key, optional canonical
  handle, one approved provider, one observation timestamp, metric
  observations, and provenance.
- `MetricObservation`: a scalar value, unit, explicit evidence state, bounded
  confidence, and provenance. Raw profiles, captions, comments, tokens, and
  contact fields are not values in this contract.
- `ScoreEnvelope`: a score from 0 to 100 or an explicit `null` when
  unavailable, confidence from 0 to 1, derived data coverage, provider list,
  provenance, timestamp, deterministic `algorithmVersion`, and structured
  signals.
- `StructuredSignal`: a bounded scalar, explicit evidence state, confidence,
  evidence references, and an optional model version. Free-form LLM rationale
  or prompt/completion text is not persisted here.

Every evidence-bearing shape uses exactly one of:

| State | Meaning | Allowed interpretation |
| --- | --- | --- |
| `observed` | Returned or directly measured by an approved provider | Evidence, not quality judgment |
| `derived` | Deterministically calculated from observed data | Reproducible with the algorithm version |
| `inferred` | A bounded interpretation or model signal | Must carry confidence, evidence references, and model version when model-derived |
| `unavailable` | The provider or permission did not supply the signal | Value is `null`; consumers must not impute it as zero |

Provenance references are opaque, bounded paths without query strings or
fragments. Timestamps are canonical ISO values. Coverage is calculated from
`availableMetrics / expectedMetrics`; callers cannot assert a more favorable
ratio.

## Analytics guardrails

- Absolute follower count is an observed scale signal, never a quality score.
- M4 must use time-bounded, post-level robust statistics and explicitly handle
  viral outliers; a single post must not dominate a creator comparison.
- The system must not state that an account has fake followers from indirect
  evidence. It may report a bounded, clearly labeled inferred signal such as
  `suspicious_growth_pattern` with confidence, coverage, provenance, and the
  algorithm/model version.
- Comments intelligence stores aggregate, minimized signals (for example
  topic, sentiment, safety, and spam proportions) rather than an unbounded
  comment archive. Raw text retention requires a separate privacy decision.
- A score is not complete without score, confidence, coverage, provenance,
  timestamp, provider identifiers, evidence state, and algorithm version.

## Rollout and access

The planned module flag is `INFLUENCER_INTELLIGENCE_ENABLED=false`. M0 does
not wire it. When the CRM surface is introduced, access must be independently
enforced by the server-side grant `module.influencer-intelligence.access` and
the module catalog; navigation visibility is not authorization.

The only permitted progression is:

```text
off -> shadow (synthetic or approved staging evidence) -> active (explicit gate)
```

No M0 artifact enables a real user, calls an external provider with business
effects, publishes content, sends engagement actions, or changes production
configuration.

## Milestone map

| Milestone | Deliverable | M0 status |
| --- | --- | --- |
| M0 | Architecture and normalized contracts | In progress |
| M1 | Creator registry and additive PostgreSQL schema | Pending; no migration in M0 |
| M2 | Official-first router and controlled collectors | Pending; no provider code in M0 |
| M3 | Append-only snapshots, retention, and Orb scheduling | Pending |
| M4 | Robust analytics and outlier-resistant metrics | Pending |
| M5 | Deterministic score, confidence, coverage, and provenance | Pending |
| M6 | Authenticated, sanitized, rate-limited read-only MCP | Pending |
| M7 | `skincos-influencer-intelligence` Codex skill | Pending |
| M8 | Read-only CRM contracts and dashboard | Pending |
| M9 | Minimized comments intelligence | Pending |
| M10 | Semantic content and Reels signals | Pending |
| M11 | Campaign and brand fit | Pending |
| M12 | Synthetic validation and calibration | Pending |
| M13 | Optional provider gap analysis | Pending; only if a measured gap remains |

## M0 risk, validation, and rollback

- Risk: medium, limited to a new social-domain contract and synthetic tests.
- Surfaces: `social/influencer-intelligence/**` plus one read-only test step in
  `.github/workflows/architecture-governance.yml`; no runtime, database, CRM,
  MCP, Orb, systemd, Cloudflare, or user-facing surface.
- Migration: none.
- Flag: declared for the future, not wired; default remains `false`.
- Validation: focused Node contract tests, architecture/domain-boundary
  checks, forbidden-surface/secret scan, and terminal hosted checks on the
  exact pull-request SHA.
- Rollback: close or revert the single-purpose change to the M0 base SHA. No
  user data or remote state is created by this milestone.
