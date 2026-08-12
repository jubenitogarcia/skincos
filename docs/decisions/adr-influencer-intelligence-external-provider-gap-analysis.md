# ADR: Influencer Intelligence external-provider gap analysis

- Status: Accepted source-level analysis; live coverage decision pending runtime evidence; no external provider integrated
- Date: 2026-08-12
- Scope: `social/influencer-intelligence`
- Related architecture: `docs/decisions/adr-influencer-intelligence-architecture.md`

## Context

Influencer Intelligence already has an official-first provider contract,
controlled instagrapi fallback, append-only snapshots, deterministic analytics,
versioned scoring, Campaign Fit, comments/content projections, and a read-only
MCP/CRM boundary. The source is still off by default and runtime/provider
collection is governed. Adding a scraper or vendor before identifying and
measuring a use-case gap would duplicate infrastructure, weaken provenance, and
create a new compliance and cost surface. This ADR therefore records
source-level capability gaps; it does not assert live provider coverage,
accuracy, or commercial lift.

The existing Instagram module also contains an Instaloader content-download
path. That legacy capability is not an approved Influencer Intelligence
provider and is not promoted into the router.

## Decision

1. Do not integrate Apify, HypeAuditor, Modash, Instaloader, or another external
   provider in this milestone.
2. Keep Meta official as the first provider whenever the requested metric is
   available and sufficient.
3. Keep the existing instagrapi boundary as a controlled fallback only for
   explicitly classified gaps; do not duplicate its scraper/session logic.
4. Build SKINCOS-owned history and bounded derived signals first. Missing
   audience demographics, verified reach, or pre-first-snapshot history remain
   `unavailable`; they are not inferred from follower count or content text.
5. If a professional use case proves a material gap with governed runtime
   evidence, evaluate Modash first for audience/discovery/overlap and
   HypeAuditor separately for authenticity. Each
   evaluation must be a shadow-only, read-only, time-boxed POC with its own
   contract and calibration decision.

## Recommendation matrix

| Candidate | Gap it could fill | Incremental value now | Risk | Decision |
| --- | --- | ---: | --- | --- |
| Meta official | Authorized first-party insights | Essential | Permissions/coverage constrained | Continue |
| Existing instagrapi | Controlled fallback coverage | Medium | Session/ToS/semantic stability | Isolate and retain |
| Instaloader | Public content/download coverage | Low | Duplicate scraper and compliance risk | Reject |
| Apify | Generic public discovery/collection | Unproven | Actor quality, scraping, token/retention, lock-in | Reject generic integration |
| Modash | Audience demographics, overlap, discovery, collaborations | Potentially high | Vendor model, cost, coverage, lock-in | Conditional shadow POC |
| HypeAuditor | Audience credibility/authenticity and reports | Potentially high | Opaque model, false positives, contract/API/legal gates | Conditional shadow POC |
| Other | Unknown | Unknown | Unknown | Require named gap first |

The detailed priority matrix, comparison criteria, and admission gate live in
[`EXTERNAL_PROVIDER_GAP_ANALYSIS.md`](../../social/influencer-intelligence/EXTERNAL_PROVIDER_GAP_ANALYSIS.md).

## Consequences

Positive:

- The current provider boundary remains small and official-first.
- No external credentials, PII, scraping payloads, or vendor semantics enter
  the MVP.
- SKINCOS history becomes the source of truth for longitudinal behavior once
  the governed collector is enabled.
- A future provider can be compared on evidence, coverage, cost, and risk
  before it can influence a score.

Trade-offs:

- Arbitrary creators may have unavailable audience demographics, reach, or
  authenticity signals.
- SKINCOS cannot reconstruct historical data before its first snapshot.
- Discovery at large scale and cross-creator audience overlap remain deferred.

## Required gates for a future provider

The future change must provide: explicit allowlist/configuration; Token Vault
custody; bounded read-only adapter; provider-specific provenance and limitations;
timeouts, safe retries, circuit isolation, and rate/cost budgets; PII and
retention review; shadow evaluation; calibration; feature-flagged rollout; and
disable/rollback evidence. It must not change score weights or start a workflow
implicitly.

## M13 delivery record

- Risk: medium. The change is documentation, architecture metadata, and static
  contract tests; it does not add network, provider, database, workflow, or
  user-facing runtime behavior. The main residual risk is future readers
  mistaking a source-level gap for measured live coverage.
- Surfaces: `social/influencer-intelligence/EXTERNAL_PROVIDER_GAP_ANALYSIS.md`,
  its test, `architecture.mjs`, the Influencer Intelligence architecture test
  list and documentation workflow, the README, and the two ADRs.
- Migration: none. No PostgreSQL file is added or applied.
- Flag/grant: unchanged. The module remains off by default; no provider,
  scheduler, MCP, CRM, or external service is registered or called.
- Validation: focused architecture/M13 tests 19/19 using
  `node --test social/influencer-intelligence/tests/external-provider-gap-analysis.test.mjs social/influencer-intelligence/tests/architecture.test.mjs`;
  full Influencer Intelligence suite 166/166 using `node --test` from
  `social/influencer-intelligence`; PR #1365 final head
  `63c5fc931f5f20d305c33d1f468177b1ae8b94ba` technical checks green, including
  M13 contract run `31567103832`, architecture run `31567103859`, calibration
  run `31567103845`, CodeQL run `31567103876`, Semgrep/security run
  `31567103826`, autonomy run `31567103858`, CI smoke run `31567103861`, lint
  run `31567103795`, and integration gate run `31567103021`.
- Rollback: the candidate was based on parent
  `aa388342d4c3bb457faa33ad2b449061002c0b29`; before merge, discard the
  candidate branch. After the governed squash merge, revert that single M13
  merge commit if required. Rollback does not touch migrations, runtime flags,
  provider credentials, or historical data.

The delivery record is evidence for the source change only; it is not evidence
that the live collector, provider permissions, coverage rates, or commercial
accuracy are proven.

## Evidence

External product capabilities and API surfaces were checked on 2026-08-12:

- [Meta Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Modash Instagram Discovery API](https://docs.modash.io/products/discovery_api/openapi_doc/discovery/instagram)
- [HypeAuditor public API](https://hypeauditor.com/swagger/public-api/v1/)
- [Apify actor dataset API](https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post)

Commercial quotas, pricing, data rights, retention, and regional coverage are
not assumed from public product pages; they require procurement evidence before
any integration decision.
