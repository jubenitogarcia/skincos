# ADR: Influencer Intelligence canonical architecture

- Status: accepted as the implementation contract; runtime remains off
- Version: `influencer-intelligence-architecture/v1`
- Scope: `social/influencer-intelligence/`
- Decision owner: SKINCOS product and platform maintainers
- This ADR is architecture-only. It does not expose a route, apply a
  migration, register a CRM module, connect a provider, change an Orb workflow,
  or enable a user-facing feature.

The machine-readable companion is
[`social/influencer-intelligence/architecture.mjs`](../../social/influencer-intelligence/architecture.mjs).
It is pure ESM and has no network, secret, database, scheduler, or runtime
side effect.

## 1. Decision and scope

SKINCOS will implement Influencer Intelligence as a read-only analytics domain
under `social/influencer-intelligence/`. The domain consumes the existing
Instagram infrastructure through bounded provider adapters and exposes
versioned internal contracts to a future MCP surface and CRM read-only module.

The canonical flow is:

```text
Codex skill
  -> authenticated read-only MCP
  -> internal Influencer Intelligence service
  -> official-first provider router
       -> Meta Graph adapter
       -> existing social/instagram instagrapi adapter (controlled fallback)
  -> PostgreSQL registry and append-only evidence snapshots
  -> deterministic analytics and scoring
  -> read-only CRM contract and dashboard
  -> Orb scheduling, retry, resume, and recovery only
```

The architecture is provider-agnostic at the analytics boundary. Meta Graph,
instagrapi, and any future provider return the same normalized contracts. No
provider-specific response shape may leak into scoring, CRM, MCP, or Orb.

The architecture PR versions the boundaries, provider interface, data model,
provenance, score envelope, API contract, MCP tools, feature/release model,
privacy rules, observability requirements, and M0--M13 implementation plan. It
does not implement the future service layers.

## 2. Current-state evidence

The following facts were inspected in the current checkout before this ADR was
written:

| Surface | Current evidence | Architectural consequence |
| --- | --- | --- |
| Existing Instagram module | `social/instagram/module/instagram_main.py` combines instagrapi, Instaloader, OSINT, downloads, and engagement behavior. `instagram_site_sync.py` owns an authenticated instagrapi sync path and builds a broad profile payload. | Reuse only a narrow, read-only adapter. Do not duplicate the session/scraper implementation or carry the broad payload into this domain. |
| Simulator and temporary API | `social/instagram/module/instagram_api_server.js` contains `InstagramModuleSimulator` and simulated OSINT/download/engagement endpoints. `social/instagram/module/api/instagram_api.py` is a broad temporary FastAPI surface with background OSINT/download behavior. | Neither surface is a source of real evidence or the new domain API. They require independent hardening and authorization before any unrelated use. |
| Official Graph integration | `crm/console/functions/_lib/instagramGraph.ts` provides Graph GET and POST helpers and places connection material in the incumbent transport request. Instagram routes use it for metrics, media, comments, publishing, OAuth, and status. | The official source is preferred, but the existing helper is not an analytics-only boundary. A future read-only transport must isolate fields, secrets, timeouts, errors, and audit. |
| Instagram connection state | `crm/console/functions/_lib/instagramStore.ts` reads and writes encrypted R2 connection state for the CRM integration. | Connection custody remains with the incumbent integration or an approved Token Vault action; the analytics contract receives no credential material. |
| Token Vault | `platform/security/token-vault/src/index.js` and `social-publish.js` implement internal authenticated credential storage and social publication forwarding. | The existing publish-oriented gateway must not silently become an analytics gateway. A separate read-only analytics action and provider allowlist are required. |
| MCP gateway pattern | `orb/engine/mcp-readonly-gateway/server.mjs` and its sanitizer/role policy implement authentication, bounded tools, rate limiting, abort/timeout, sanitized output, read-only SQL policy, and JSONL audit. | Influencer Intelligence MCP must reuse the pattern and delegate to the domain service; it must not add scraping, shell, arbitrary SQL, or workflow mutation. |
| Orb source of truth | `orb/engine/README-WORKFLOWS.md` states that local workflow files are snapshots/exportations and the current browser/live n8n workflow is canonical. Orb runtime is PostgreSQL-backed and native-release based. | Orb schedules and recovers domain jobs only. Local JSON is never imported as live workflow truth by this mission. |
| PostgreSQL conventions | The M1 registry artifact is additive and scoped. `crm/api/server/clinical/clinicalApprovalMigration.js` demonstrates destination checks, advisory locking, timeouts, schema ledgers, append-only triggers, and non-destructive rollback. | Future snapshot tables must follow additive migration, destination/grant gates, append-only evidence, and evidence-preserving rollback. No migration is applied by this ADR. |
| Module/release policy | `docs/architecture/module-catalog.md` and `module-catalog.json` keep new modules experimental and require a disabled flag, grants, evidence, fallback, SLO, and rollback. CRM authorization is server-side in `crm/console/authPolicy.ts` and `crmRoleAccess.ts`. | Influencer Intelligence remains under the social capability and experimental/off until a later CRM milestone adds the required catalog and grant evidence. |
| Runtime topology | `CODEX_CONTEXT.md`, `orb/engine/CODEX_CONTEXT.md`, and the delivery policies require immutable native releases, private runtime state, isolated worktrees, exact SHA evidence, and no production claim from health alone. | Architecture is source-controlled and runtime-free. Any future promotion must use the existing immutable release and rollback controls. |

## 3. Boundaries

The following ownership is normative:

| Boundary | Owns | Must not do |
| --- | --- | --- |
| `social/instagram` | Existing OAuth, connection state, transport/session lifecycle, publication, engagement, and incumbent Instagram routes | Own Influencer Intelligence scores or become a second analytics database |
| `social/influencer-intelligence` | Normalized evidence, minimal registry, snapshots, analytics, scores, campaign/brand fit, provenance, and future internal API | Read credentials, persist raw provider payloads, scrape, publish, engage, or execute shell/SQL |
| Provider router/adapters | Official-first ordering, gap classification, bounded projections, provider adapter version | Expose provider-specific payloads or silently fall back on policy/validation failures |
| Token Vault | Credential custody, least-privilege action selection, provider allowlist, secret audit | Return credentials or unrestricted connection state to domain contracts |
| Internal service | Session/authentication, flag and grant checks, input validation, correlation, bounded read-only envelopes | Become a public unauthenticated FastAPI surface or proxy arbitrary provider calls |
| MCP | Authenticated, sanitized, bounded read-only tool presentation and audit | Scrape, call providers directly, run arbitrary SQL/shell, mutate workflows, publish, or engage |
| CRM | Read-only contract consumer and dashboard projection | Call Graph/instagrapi directly or infer authorization from navigation visibility |
| Orb | Scheduling, retries, resume, correlation, and operator recovery | Own analytics/scoring, persist canonical evidence, or import stale local workflow JSON as live truth |
| PostgreSQL | Minimal registry and append-only historical evidence | Store raw profiles/comments/media/credentials or rewrite historical scores in place |

The existing top-level module catalog continues to describe `social` as the
product capability in this architecture PR. A dedicated catalog entry, route,
service, and CRM navigation contract are deferred to M8, when there is an
actual deployable surface to govern.

## 4. Provider interface

The interface is a logical contract, not a new provider implementation:

```text
ProviderAdapter {
  id: ProviderId
  officialFirst: boolean
  capabilities: ReadOnlyCapability[]
  collect(request: ProviderRequest): Promise<ProviderResult>
}
```

`ProviderRequest` contains only an opaque `creatorKey`, optional approved
canonical handle, requested normalized fields, observation/retrieval
timestamps, time window, and correlation id. It does not contain a raw
provider account reference, credential material, session material, arbitrary
query, engagement instruction, or publication instruction.

`ProviderResult` is either `collected` or `unavailable` and contains the
provider id, provider adapter version, bounded scalar observations, and
provenance. It never contains a raw provider object, direct contact field,
raw comment text, media binary, credential, or session.

The v1 provider allowlist and order are closed:

1. `meta-graph` is the first preference whenever the requested signal is
   available through the official Graph contract.
2. `instagrapi` may be used only through the existing
   `social/instagram` read path and only after an explicit gap from Meta.
3. A future provider is not part of the MVP. M13 may evaluate one only after a
   measured coverage/permission gap, privacy review, cost/risk review, and a
   separate contract/PR.

The only fallback reason codes in v1 are
`provider_unavailable`, `permission_gap`, `coverage_gap`, and `timeout`.
`policy_block`, `invalid_response`, and unclassified transport failures fail
closed and do not trigger a fallback. A provider response with a missing or
invalid metric is an explicit unavailable observation, never a fabricated
zero.

The M2 provider boundary already implements this injected-transport shape for
synthetic tests. The architecture PR adds no real transport, HTTP client,
session use, or provider call.

## 5. Canonical data model

The PostgreSQL schema is `influencer_intelligence`. M1 currently provides only
the reviewed registry artifact; M3 will add snapshot persistence after a
separate migration review.

| Resource | Lifecycle | Canonical content |
| --- | --- | --- |
| `creator_registry` | Minimal operational binding; current state may transition under policy | Opaque creator key, optional normalized public handle, registry state, timestamps |
| `creator_provider_registry` | Minimal current provider binding | Provider id, provider-account digest, availability/evidence state, last observation/retrieval, opaque source reference |
| `provider_snapshots` | Append-only | Creator, provider, adapter/contract versions, observation/retrieval times, retention policy version, snapshot identity |
| `metric_observations` | Append-only child of a snapshot | Scalar metric, unit, value or null, evidence state, confidence, provenance |
| `analytics_results` | Append-only derived artifact | Time window, input snapshot identities, deterministic algorithm version, coverage, provenance, computed time |
| `score_snapshots` | Append-only derived artifact | Influencer Score, Campaign Fit, Brand Fit, or Risk envelope with all audit fields |
| `structured_signals` | Append-only evidence-bearing projection | Bounded scalar signal, state, confidence, evidence references, optional model version |

Historical records are immutable. A recomputation creates a new analytics or
score artifact with a new algorithm version; it does not update or erase an
older result. The registry is allowed to maintain a minimal current binding,
but it is not a raw provider cache.

The canonical evidence states are:

| State | Meaning | Consumer rule |
| --- | --- | --- |
| `observed` | Returned or directly measured by an approved provider | Treat as evidence, not as a quality judgment |
| `derived` | Deterministically calculated from observed inputs | Reproduce from input identities and algorithm version |
| `inferred` | Bounded model or analytical interpretation | Carry confidence, evidence references, and model version when model-derived |
| `unavailable` | Provider, permission, or coverage did not supply the signal | Value is `null`; never impute zero |

## 6. Provenance model

Every evidence-bearing observation, analysis, signal, and score carries a
versioned provenance envelope:

```text
{
  contractVersion,
  provider,
  providerAdapterVersion?,
  sourceType,
  evidenceState,
  observedAt,
  retrievedAt,
  sourceRef,
  algorithmVersion?,
  modelVersion?,
  evidenceRefs?
}
```

`sourceRef` is an opaque bounded path without query strings or fragments. It
must not embed credentials, session material, raw provider ids, or an upstream
request URL. Provider account identity is represented only by the registry's
approved digest. `providers` on a score are unique, stable identifiers; the
full provenance list explains the contributing evidence.

Coverage is computed, not caller-declared:
`availableMetrics / expectedMetrics`, with both counts and the bounded ratio
returned. A missing provider permission or unavailable metric reduces
coverage and is visible to consumers. It is never converted into a healthy
zero or hidden inside a confidence value.

## 7. Score, confidence, and coverage contract

The v1 score envelope requires:

```text
scoreKind
score                 // 0..100 or null
confidence            // 0..1 evidence confidence
coverage              // available, expected, ratio
evidenceState
providers
provenance
timestamp
algorithmVersion
signals               // structured and auditable
```

The score engine is deterministic-first. Its first implementations must use
time-bounded, post-level robust statistics, report the observation window, and
limit the influence of a single viral post. Median/trimmed or otherwise
explicitly documented robust estimators are preferred over a raw average when
the distribution is heavy-tailed. Every algorithm change creates a new
`algorithmVersion` and is calibrated against synthetic fixtures before a
shadow evaluation.

Absolute follower count is an observed scale signal, not a quality score. The
engine must combine coverage-aware, engagement, consistency, audience, content,
and campaign criteria only when each signal has a declared state and
provenance. It must not compare a high-coverage creator as equivalent to a
low-coverage creator merely because both have a numeric score.

Indirect evidence may produce an inferred signal such as
`suspicious_growth_pattern`, with confidence, evidence references, and a model
version. The system must never state that an account has fake followers as a
fact without direct evidence and an approved policy. LLM signals are bounded
structured fields; prompts, completions, and free-form rationales are not
persisted by this contract.

## 8. Internal API contract

The future service is an internal authenticated read-only contract. The
architecture PR does not mount these routes:

| Method | Path | Semantics |
| --- | --- | --- |
| `GET` | `/internal/influencer-intelligence/v1/creators/{creatorKey}/analysis` | One creator's analysis envelope |
| `GET` | `/internal/influencer-intelligence/v1/creators/{creatorKey}/coverage` | Availability and provenance coverage |
| `POST` | `/internal/influencer-intelligence/v1/compare` | Bounded comparison query; POST is transport for a read, not mutation |
| `POST` | `/internal/influencer-intelligence/v1/campaign-fit` | Bounded Campaign Fit computation; no campaign is created or dispatched |

Every response uses:

```text
{
  contractVersion,
  requestId,
  generatedAt,
  data,
  coverage,
  provenance,
  errors
}
```

The server requires an authenticated session, the disabled-by-default domain
flag, the explicit module grant, and any approved data scope before reading or
computing. It accepts only opaque creator keys or an approved canonical-handle
resolver, a bounded metric set, and a bounded time window. The initial limits
are 20 creators and 365 days per request. It rejects provider account ids,
credentials, raw comments/media, and arbitrary query fragments.

Errors are stable and sanitized: `AUTH_REQUIRED`, `GRANT_REQUIRED`,
`INVALID_INPUT`, `NOT_FOUND`, `UNAVAILABLE`, `RATE_LIMITED`, `UPSTREAM_GAP`,
and `INTERNAL`. There is no create, update, delete, publish, engage, or
provider-debug endpoint in this contract.

## 9. MCP read-only contract

M6 will expose four bounded tools through the existing
`orb/engine/mcp-readonly-gateway` security pattern:

| Tool | Input | Output |
| --- | --- | --- |
| `influencer_intelligence_get_creator_analysis` | creator key, window, metric set | Analysis envelope |
| `influencer_intelligence_compare_creators` | up to 20 creator keys, window, metric set | Comparison envelope |
| `influencer_intelligence_get_campaign_fit` | creator keys, structured campaign criteria, window | Campaign Fit envelope |
| `influencer_intelligence_get_data_coverage` | creator key, window | Coverage/provenance envelope |

Each tool requires authentication and the domain grant. Tool input uses a
closed JSON schema with `additionalProperties: false`, bounded sizes, bounded
windows, and no provider ids or free-form raw comments. The gateway applies
sanitization, a domain rate limit, a 12-second timeout/abort path, an audit
event, and a read-only database role. The response is sanitized again before
leaving the gateway.

MCP delegates to the internal service. It cannot call Meta Graph or
instagrapi, retrieve Token Vault material, run arbitrary SQL or shell, scrape,
publish, engage, or mutate Orb/n8n workflows. Errors are reduced to stable
codes and never include raw upstream payloads.

## 10. Feature flag and release model

The server-side module flag is:

```text
INFLUENCER_INTELLIGENCE_ENABLED=false
grant=module.influencer-intelligence.access
rollout=off -> shadow -> active
```

The flag is not wired by this PR or by M0--M2. A future CRM surface must add
the module catalog evidence, server-side grant, explicit data scope, owner,
fallback, SLO, smoke, and rollback identity before it can be activated.
Navigation visibility, a frontend flag, a generic role, a direct URL, or a
successful health check is not authorization.

Shadow means synthetic fixtures or an explicitly approved staging cohort. It
does not mean real-user collection, publication, engagement, or business
automation. Active requires a reviewed immutable release SHA, exact dependency
closure, authenticated journey evidence, coverage/quality thresholds, and a
documented rollback. A merge to `main` never activates this domain.

## 11. Privacy and data minimization

The minimum retained projection is an opaque creator key, optional normalized
public handle, scalar metrics, bounded aggregate comments signals, provider
account digest, and versioned provenance/audit metadata. The domain never
persists raw provider account identity, direct contact fields, credentials,
cookies, sessions, raw profile payloads, media binaries, or raw comments by
default. Raw comments require a separate privacy decision and are not part of
the M9 contract.

Every historical artifact carries a reviewed finite `retentionPolicyVersion`.
No indefinite raw cache is allowed. Privacy deletion or tombstoning is a
separate controlled policy that preserves an auditable decision and does not
silently rewrite historical evidence. Backups, recovery artifacts, and logs
must obey the same minimization and redaction rules.

The domain reports evidence states, not personal or commercial certainty. In
particular, indirect growth or engagement patterns are not a factual
declaration of fake followers. LLM-derived signals must include provenance,
confidence, and model version and must not retain unrestricted prompts or
completions.

## 12. Observability and audit

Every service/MCP request and provider attempt records redacted structured
metadata: request id, correlation id, actor scope, grant, operation, provider,
attempt status, reason code, latency, timeout, fallback use, coverage,
algorithm/model version, result identity, and timestamp. No credential, raw
provider payload, session, contact field, raw comment, or unrestricted model
text enters logs or audit.

The minimum metrics are request count/latency, provider attempts and gap
counts, fallback count, unavailable count, coverage ratio, score generation,
rate limits, and timeouts. Alerts cover unexpected fallback growth, coverage
regression, unavailable/timeout spikes, and authorization or sanitization
failures. An audit storage failure must not expose request data; an operation
without the required audit evidence is not considered proven.

## 13. PostgreSQL and migration policy

M1's migration
[`20260810_influencer_intelligence_registry_v1.up.sql`](../../social/influencer-intelligence/migrations/20260810_influencer_intelligence_registry_v1.up.sql)
is an unapplied, additive proposal for the minimal registry. M3 may add
snapshot and evidence tables only in a separate migration-focused change.

Future migrations must:

- verify destination identity, role custody, checkpoint, lock/statement
  timeouts, and prerequisites before apply;
- be additive and idempotent, with no destructive rollback or history rewrite;
- deny public access and use explicit collector/read roles;
- protect historical snapshots, observations, analytics, scores, signals, and
  audit events with append-only constraints/triggers where the database role
  permits;
- record migration identity and verification in the domain schema ledger;
- preserve evidence on rollback by disabling/repointing code or recording a
  non-destructive rollback marker rather than deleting rows.

This architecture PR creates no table, grants no role, runs no SQL against a
database, and changes no runtime schema.

## 14. Implementation plan

| Milestone | Deliverable | Gate |
| --- | --- | --- |
| Architecture | This ADR and `architecture.mjs` | Contract/documentation tests; no runtime effect |
| M0 | Pure normalized evidence/provenance/coverage/signal/score contracts | Merged in PR #1303; no network or persistence |
| M1 | Minimal pseudonymous registry and additive PostgreSQL artifact | Merged in PR #1304; artifact only, not applied |
| M2 | Official-first Meta router and controlled instagrapi boundary | Merged in PR #1305; injected synthetic transports only |
| M3 | Append-only snapshots, retention policy, and Orb job contract | Separate additive migration, dry-run/shadow scheduling, recovery tests |
| M4 | Robust analytics and outlier-resistant metrics | Synthetic time-series fixtures and explicit unavailable coverage |
| M5 | Deterministic score/confidence/provenance engine | Versioned algorithms and calibration evidence |
| M6 | Hardened authenticated read-only MCP | Tool schema, auth/grant, sanitization, limits, timeout, audit, read-only role |
| M7 | `skincos-influencer-intelligence` skill | Skill uses only the approved MCP contract and cannot bypass boundaries |
| M8 | Read-only CRM API/dashboard | Server-side flag/grant, module catalog, shadow UI, direct-provider negative tests |
| M9 | Minimized comments intelligence | Aggregate-only topics/sentiment/safety/spam signals and retention evidence |
| M10 | Semantic content and Reels signals | Approved bounded media projection and model provenance |
| M11 | Campaign/brand fit | Structured criteria, deterministic base, labeled inferred signals |
| M12 | Synthetic validation and calibration | Outlier, coverage, confidence, privacy, authorization, and fallback tests |
| M13 | Optional provider gap analysis | Measured gap report before any external provider is considered |

Each milestone remains off by default, uses a dedicated worktree/branch and
single-purpose PR, records risk/surfaces/flag/migration/validation/rollback,
and retains exact SHA evidence through terminal CI. No milestone may activate
real users or engagement automation merely because its tests are green.

## 15. Acceptance and rollback

This architecture milestone is accepted when:

1. the ADR and machine-readable manifest describe the same version and the
   same provider order, states, score fields, API routes, MCP tools, privacy
   rules, rollout, and M0--M13 plan;
2. focused tests prove the manifest is runtime-free, closed, versioned, and
   consistent with this ADR;
3. existing M0/M1/M2 contract tests and repository architecture/security
   validators remain green;
4. the diff contains no runtime route, provider transport, migration apply,
   grant, flag wiring, CRM module registration, MCP registration, Orb workflow,
   systemd, Cloudflare, network, session, or production mutation;
5. the PR reaches terminal required checks on its exact head SHA and merges
   only through the global merge authority.

Rollback for this milestone is closing or reverting the single-purpose PR to
the base merge `19c7fcced2b27fdfe96e1b23c70f1953fcbca217`. Because the change is
documentation, a pure manifest, a focused test, and a workflow test-list
addition, it has no database, runtime, provider, session, user, or business
data impact. If a later implementation contradicts this ADR, that milestone
stops at the architecture gate and requires a new versioned ADR/manifest
decision before implementation continues.
