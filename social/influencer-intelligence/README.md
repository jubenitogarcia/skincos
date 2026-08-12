# Influencer Intelligence

Status: architecture v1 defined; M2 provider boundary, M4 deterministic
analytics, M5 deterministic scoring, M6 read-only MCP adapter, M7 Codex skill,
M8 CRM contract/dashboard source, M9 comments intelligence, and M10 bounded
content analysis are implemented in source control. Data model v1 plus scoring
metadata remain additive, unapplied artifacts, and all Influencer Intelligence
runtime/upstream registrations remain off.
The domain remains
experimental, not exposed, and off by default.

This domain provides read-only intelligence about Instagram creators for
analysis, comparison, and campaign fit. It is not an engagement automation
surface, a publication surface, or a new scraping project.

## Architecture v1

The canonical architecture decision is documented in
[`docs/decisions/adr-influencer-intelligence-architecture.md`](../../docs/decisions/adr-influencer-intelligence-architecture.md).
The versioned, runtime-free contract companion is
[`architecture.mjs`](./architecture.mjs). Together they define the provider
boundary, append-only data model, provenance and score envelopes, internal API,
read-only MCP tools, release/flag model, privacy rules, observability, and the
M0--M13 implementation gates.

The architecture and M0-M7 source milestones do not add provider transports,
live MCP registration, Orb workflow imports, or activation. M8 adds only the
bounded, authenticated CRM proxy/client/dashboard boundary; the upstream
target is not configured, `INFLUENCER_INTELLIGENCE_ENABLED` remains `false`,
and the domain stays off until later milestones prove their own gates.

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

M0 is merged as PR #1303 at merge SHA
`26b17ef3f64482ac1d3aa0182af597262bb633d1`. Its CI gate remains the owner of
the contract test and no runtime was enabled.

## M1 decision: registry and PostgreSQL artifact

M1 adds [`registry.mjs`](./registry.mjs) and the reviewed additive migration
[`20260810_influencer_intelligence_registry_v1.up.sql`](./migrations/20260810_influencer_intelligence_registry_v1.up.sql).
The registry stores only:

- an opaque internal `creator_key` and optional public canonical handle;
- a closed registry state (`candidate`, `paused`, `unavailable`);
- the approved provider identifier and a SHA-256 digest of the provider account
  reference, never the raw provider account id;
- explicit provider/evidence state, bounded timestamps, and an opaque source
  reference without query strings or fragments.

The migration is idempotent and additive. It creates the domain schema, a
schema-migration ledger, creator registry, provider registry, and narrow
indexes. It has no seed rows, no clear credentials, no direct contact fields,
no public grants, and no destructive rollback SQL. M1 does not apply the
migration to local, staging, or production PostgreSQL: the future runner must
first prove destination identity, role custody, checkpoint, lock/statement
timeouts, scoped grants, and post-apply verification. Until that runner exists,
the artifact is the source-controlled schema proposal only.

## M2 decision: official-first provider router

The M2 baseline adds [`provider-router.mjs`](./provider-router.mjs) and the two
explicit adapters under [`providers/`](./providers/). The router requires
`meta-graph` to be first and falls back to `instagrapi` only for explicit gap
codes (`provider_unavailable`, `permission_gap`, `coverage_gap`, `timeout`,
`circuit_open`, or `retry_exhausted`). Invalid responses, policy blocks, and
unclassified transport errors fail closed and do not trigger fallback.

The provider-router extension defines the typed operations
`resolve_creator`, `get_profile`, `get_recent_media`, `get_media_metrics`,
`get_comments_sample`, and `get_profile_metrics`. Every result is a bounded
envelope carrying `provider`, `retrieved_at`, `data_classification`,
`freshness`, `limitations`, and provider-specific evidence. Missing coverage is
returned as `unavailable` with `data: null`; the router never substitutes or
invents metrics. Adapters receive injected read-only transports and expose no
follow, like, DM, post, session, credential, or raw-payload surface.

Retries are bounded to safe transient transport/timeout classes, and circuit
state is isolated by provider and operation. Future external providers are
interfaces only until they are explicitly enabled and allowlisted after a
measured gap review. No new scraper, Instaloader path, or duplicate instagrapi
implementation is introduced.

The original M2 boundary is merged as PR #1305. The Meta adapter remains a
boundary around the existing official CRM integration, not a second HTTP
client; the instagrapi adapter remains a narrow boundary around the existing
`social/instagram` read path. This milestone continues to use synthetic,
injected transports only: it does not call Graph, instagrapi, Token Vault,
PostgreSQL, Orb, or any runtime endpoint. A future transport must establish a
separate read-only analytics allowlist and Token Vault custody before it can be
connected.

## Data model v1 decision

The persistent model is documented in [`DATA_MODEL.md`](./DATA_MODEL.md) and
implemented as the additive migrations
[`20260811_influencer_intelligence_data_model_v1.up.sql`](./migrations/20260811_influencer_intelligence_data_model_v1.up.sql)
and [`20260811_influencer_intelligence_snapshots_v1.up.sql`](./migrations/20260811_influencer_intelligence_snapshots_v1.up.sql).
It retains M1's `creator_registry` as the canonical creator relation and adds
provider-neutral identity, media, collector evidence, append-only profile/media
snapshots, aggregate comment intelligence, versioned analyses and scores,
campaign criteria, and campaign fit relations. Every historical ingest has a
unique `ingest_key`; derived rows carry coverage, confidence, providers,
algorithm/model versions, input fingerprints, and structured provenance.

The repository in [`repository.mjs`](./repository.mjs) is an injected,
parameterized PostgreSQL boundary. It validates bounded JSON, provider/source
slugs, timestamp ordering, unavailable/null rules, coverage, and idempotency
conflicts without reading secrets or opening a provider transport. Provider
slugs are open in persistence for future adapters, while the current runtime
allowlist remains official-first `meta-graph` with controlled `instagrapi`
fallback.

These migrations are not applied to local, staging, or production through an
operational runner; they are validated as source-controlled artifacts and
through synthetic repository tests. No UI, feature wiring, runtime, CRM, MCP,
systemd, or external provider call is included; the Orb source added by M3 is
inactive orchestration only.

## M4 decision: deterministic analytics

[`analytics.mjs`](./analytics.mjs) is a pure ESM engine over normalized profile
and media snapshots. It emits versioned, coverage-aware metrics for profile
growth, cadence, likes, comments, engagement, views/reach, video performance,
volatility, trends, robust outliers, and bounded growth anomalies. The formulas
and limitations are documented in [`ANALYTICS.md`](./ANALYTICS.md).

Missing values stay unavailable and zero denominators never produce a numeric
result. A viral post is retained as observed evidence but cannot replace the
robust series summary. Follower-tier benchmark output is an explicit
`skincos_internal` structure and remains unavailable until a governed internal
calibration dataset exists. The engine does not infer follower quality or fake
followers and does not connect providers, PostgreSQL, Orb, CRM, or runtime
routes.

## M3 snapshot operations and Orb source

The bounded internal operations in [`snapshots.mjs`](./snapshots.mjs) now provide
`snapshot_creator` and `snapshot_creator_media` over the injected provider router
and PostgreSQL repository. They create and finalize `collector_run` metadata,
persist provider failures as explicit `collector_evidence`, retain append-only
profile/media observations, and return freshness, coverage, limitations and
provider evidence. They do not schedule themselves and do not open a transport.

The inactive Orb export in [`orb/engine/workflows/influencer-intelligence-snapshot.json`](../../orb/engine/workflows/influencer-intelligence-snapshot.json)
is orchestration-only. It selects explicitly opted-in identities, sends one
bounded batch to the internal snapshot service, and emits a redacted result
receipt. The six-hour trigger, one-at-a-time service lease, feature flag,
two-attempt retry policy, and 30-second timeout are conservative source
defaults; the workflow is not imported or activated by this milestone.

Snapshot artifact keys are deterministic for creator/provider/media/observed-time
bucket. A repeat in the same bucket is a no-op; a later bucket records a new
observation. Provider `null`/missing fields remain `null`, while an explicit zero
is retained as zero. Profile collection requires an existing internal identity;
media collection is bounded to 50 items and records publication timestamps when
the provider supplies them. The default mode is `shadow`, and the module flag
remains off.

The operation tests use only injected fixtures and cover first collection,
replay, metric changes, fallback/partial coverage, timeout, nonexistent and
private profiles, unavailable media metrics, provenance classification and
credential rejection. Token Vault transport wiring, migration application,
service route mounting, live Orb import and real provider calls remain later
operational gates.

## Concrete target architecture

```text
Codex
  -> skincos-influencer-intelligence skill (M7)
  -> read-only Influencer Intelligence MCP (M6)
  -> internal service/API (M2-M5)
  -> provider router
       -> Meta Graph official adapter (first preference; M2 boundary)
       -> existing social/instagram instagrapi adapter (controlled fallback; M2 boundary)
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

## M6 decision: read-only MCP adapter

[`mcp-readonly.mjs`](./mcp-readonly.mjs) implements the domain-side adapter for
the existing `orb/engine/mcp-readonly-gateway` pattern. It exposes bounded
`search_creators`, `get_creator_profile`, `get_creator_snapshots`,
`get_creator_media`, `get_creator_analytics`, `get_creator_score`, and
`get_campaign_fit` and `compare_creators` tools through an injected internal
read service. `get_campaign_fit` reads a persisted, versioned projection and
does not accept a raw campaign brief or start computation.

The adapter requires authentication, the server-side domain grant, opaque
actor scope, closed input schemas, bounded windows/pages/comparisons, timeout,
abort propagation, concurrency control, rate limiting, sanitized output, and
mandatory audit. It returns explicit classification, freshness, provenance,
confidence, coverage, limitations, and unavailable/null states. It never calls
Meta, instagrapi, Token Vault, PostgreSQL, SQL, shell, Orb, or a scoring engine;
it cannot mutate Instagram, workflows, or persisted scores. The source and
protocol tests are present, while runtime registration remains pending.

See [`MCP_READONLY.md`](./MCP_READONLY.md) for the internal service contract,
limits, sanitization boundary, and rollback posture.

## M7 decision: Codex skill

[`skills/skincos-influencer-intelligence/SKILL.md`](../../skills/skincos-influencer-intelligence/SKILL.md)
is the concise, versioned instruction boundary for creator analysis requests.
It requires MCP/data consultation before conclusions, preserves observed,
derived, inferred, unavailable and stale states, uses the persisted
deterministic score without mental weight recalculation, and always reports
confidence, coverage, provenance and limitations. It separates general
creator quality from campaign fit and treats followers, viral posts and growth
spikes as context rather than proof of quality or fraud.

The skill is read-only: it cannot call providers, expose credentials or PII,
run SQL/shell, start Orb jobs, scrape, or perform Instagram engagement. Its
UI metadata is generated by the skill-creator template, and a contract test
guards triggers, output format, evidence states and forbidden bypasses.
MCP/runtime registration and user grants remain governed by later gates.

### Incumbent integrations to reuse

- Official-first collection will wrap the existing CRM Graph adapter in
  `crm/console/functions/_lib/instagramGraph.ts` and its authenticated
  connection boundary in `instagramStore.ts`; M2 only defines the injected
  projection boundary, and the CRM UI must not call Graph or instagrapi
  directly.
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
  provenance, timestamp, deterministic `algorithmVersion`, `weightsVersion`,
  and structured signals.
- `StructuredSignal`: a bounded scalar, explicit evidence state, confidence,
  evidence references, and an optional model version. Free-form LLM rationale
  or prompt/completion text is not persisted here.
- `CreatorRegistryEntry`: a minimal registry projection that accepts only
  pseudonymous provider digests and the state needed to decide whether a
  future collector may observe the creator.

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
  topic, sentiment, safety, spam proportions, duplicate ratios, language
  coverage, and bounded comment quality) rather than an unbounded comment
  archive. Raw text retention requires a separate privacy decision. M9's
  formulas and semantic schema are documented in [`COMMENTS.md`](./COMMENTS.md).
- A score is not complete without score, confidence, coverage, provenance,
  timestamp, provider identifiers, evidence state, and algorithm version.

## M10 decision: bounded semantic content analysis

[`content-analysis.mjs`](./content-analysis.mjs) selects a bounded recent media
sample and emits versioned features for topics, product categories, brand and
competitor mentions, sponsorship/promotion signals, skincare affinity,
education versus entertainment, claim types, format, and brand safety. The
full contract and retention decisions are documented in
[`CONTENT_ANALYSIS.md`](./CONTENT_ANALYSIS.md).

The baseline is deterministic and controlled-vocabulary based. A future
approved analyzer may be injected only through the closed structured semantic
schema; it returns features and evidence, never an Influencer Score. Captions
and transcripts are ephemeral inputs, while only safe features, bounded media
keys, model metadata, and evidence references reach the existing append-only
`creator_analysis` repository boundary. Existing Agent Zero Whisper/vision and
Meta Ads workflow capabilities were inspected but are not connected because
they are different runtime boundaries and may own media processing.

## Rollout and access

The planned module flag is `INFLUENCER_INTELLIGENCE_ENABLED=false`. M0 through
M2 do not wire it. When the CRM surface is introduced, access must be independently
enforced by the server-side grant `module.influencer-intelligence.access` and
the module catalog; navigation visibility is not authorization.

The only permitted progression is:

```text
off -> shadow (synthetic or approved staging evidence) -> active (explicit gate)
```

No M0/M1/M2 artifact enables a real user, calls an external provider with
business effects, publishes content, sends engagement actions, or changes
production configuration.

## Milestone map

| Milestone | Deliverable | Status |
| --- | --- | --- |
| M0 | Normalized contracts | Merged in #1303 |
| M1 | Creator registry and additive PostgreSQL schema | Merged in #1304; registry artifact only, not applied |
| Architecture | Canonical architecture v1 | Merged in #1310; runtime-free manifest |
| M2 | Official-first router and controlled collectors | Canonical router #1324 (supersedes #1305); injected synthetic transports only |
| M3 | Append-only snapshots, retention, and Orb scheduling | Data model #1322, snapshots #1331, and inactive Orb scheduler #1335; artifacts/import/runtime pending |
| M4 | Robust analytics and outlier-resistant metrics | Merged in #1333; pure deterministic engine, golden fixtures, and formula documentation |
| M5 | Deterministic score, confidence, coverage, and provenance | Merged in #1334; versioned weights, confidence factors, explanations, additive persistence metadata, and golden tests |
| M6 | Authenticated, sanitized, rate-limited read-only MCP | Source adapter and protocol tests implemented; runtime registration pending |
| M7 | `skincos-influencer-intelligence` Codex skill | Versioned skill, UI metadata and contract tests implemented; runtime/user access remains governed |
| M8 | Read-only CRM contracts and dashboard | Source implemented; gated shadow UI, upstream/runtime off |
| M9 | Minimized comments intelligence | Source implemented; additive quality/sampling migration and synthetic tests; runtime/provider wiring remains off |
| M10 | Semantic content and Reels signals | Source implemented; bounded feature projection, closed semantic schema, fixtures and persistence boundary; media/runtime adapter remains off |
| M11 | Campaign and brand fit | Source implemented; deterministic engine, additive fit metadata, persisted MCP read, CRM query surface, and golden tests; compute/runtime remains off |
| M12 | Synthetic validation and calibration | Pending |
| M13 | Optional provider gap analysis | Pending; only if a measured gap remains |

## M2 risk, validation, and rollback

- Risk: high because this milestone defines the provider boundary, but no
  network, database, runtime, or session operation occurs.
- Surfaces: `social/influencer-intelligence/**` and the focused architecture
  workflow test; no CRM, MCP, Orb, systemd, Cloudflare, or user-facing surface.
- Migration: none in M2; the additive M1 SQL artifact remains unapplied.
- Flag: declared for the future, not wired; default remains `false`.
- Validation: focused M0/M1/M2 Node tests, provider static surface scan,
  architecture/domain-boundary checks, secret scan, and terminal hosted checks
  on the exact pull-request SHA.
- Rollback: close or revert the single-purpose change to merge SHA
  `f0dcab87d5348941d5c28e690c8a689a3bad8a3d`. No user data, provider session,
  network state, or remote database state is created by this milestone.

## M6 risk, validation, and rollback

- Risk: high because the adapter is a security boundary, but the change is
  source-only and has no transport or runtime registration.
- Surfaces: `social/influencer-intelligence/mcp-readonly.mjs`, its protocol
  tests, architecture manifest/docs, and the architecture governance test
  list; no provider, database, CRM, Orb, systemd, or user-facing surface.
- Migration: none; existing additive migration artifacts remain unapplied.
- Flag/grant: `INFLUENCER_INTELLIGENCE_ENABLED=false`; the grant is validated
  by the adapter but not assigned to users and `mcpRuntimeRegistered=false`.
- Validation: protocol/security tests, architecture/domain-boundary validators,
  focused M0--M5 regression tests, diff hygiene, and terminal hosted CI on the
  exact PR SHA.
- Rollback: revert or close the single-purpose change. No database, credential,
  provider session, workflow, or external business effect is created by M6.

## M7 risk, validation, and rollback

- Risk: medium because the Skill guides model behavior, but it has no transport,
  provider, database, workflow, credential, or user-grant authority.
- Surfaces: `skills/skincos-influencer-intelligence/**`, its contract test,
  architecture manifest/docs, and the architecture governance test list.
- Migration/runtime: none; `INFLUENCER_INTELLIGENCE_ENABLED=false` and
  `mcpRuntimeRegistered=false` remain unchanged.
- Validation: skill-creator `quick_validate.py` in Ubuntu-24.04, contract tests,
  focused Influencer Intelligence regression tests, architecture/domain-boundary
  checks, and terminal hosted CI on the exact PR SHA.
- Rollback: revert or close this single-purpose Skill change; no runtime state
  or user data is created.

## Data model risk, validation, and rollback

- Risk: high because the change adds persistent relations and immutable
  lifecycle rules, but the migration remains unapplied and no runtime path can
  write to it.
- Surfaces: `social/influencer-intelligence/**` and the focused architecture
  workflow test; no database credentials, grants, CRM, MCP, Orb, systemd,
  Cloudflare, or user-facing surface.
- Migration: additive M2-dependent artifact only. A future destination runner
  must prove database identity, migration order, checkpoint/restore, lock and
  statement timeouts, least-privilege roles, and post-apply verification.
- Flag: `INFLUENCER_INTELLIGENCE_ENABLED=false`; no grant or runtime wiring is
  added.
- Validation: focused repository/migration tests, disposable PostgreSQL apply
  with synthetic rows and append-only trigger rejection, architecture/domain
  boundary checks, security checks, diff hygiene, and terminal hosted CI on
  the exact pull-request SHA.
- Rollback: before any future apply, disable collection and retain the prior
  schema checkpoint; this PR itself rolls back by closing or reverting its
  single-purpose change without touching a live database.
