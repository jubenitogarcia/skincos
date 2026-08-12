# ADR: Influencer Intelligence external-provider gap analysis

- Status: Accepted analysis; no external provider integrated
- Date: 2026-08-12
- Scope: `social/influencer-intelligence`
- Related architecture: `docs/decisions/adr-influencer-intelligence-architecture.md`

## Context

Influencer Intelligence already has an official-first provider contract,
controlled instagrapi fallback, append-only snapshots, deterministic analytics,
versioned scoring, Campaign Fit, comments/content projections, and a read-only
MCP/CRM boundary. The source is still off by default and runtime/provider
collection is governed. Adding a scraper or vendor before identifying a
measured gap would duplicate infrastructure, weaken provenance, and create a
new compliance and cost surface.

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
5. If a professional use case proves a material gap, evaluate Modash first for
   audience/discovery/overlap and HypeAuditor separately for authenticity. Each
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

## Evidence

External product capabilities and API surfaces were checked on 2026-08-12:

- [Meta Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Modash Instagram Discovery API](https://docs.modash.io/products/discovery_api/openapi_doc/discovery/instagram)
- [HypeAuditor public API](https://hypeauditor.com/swagger/public-api/v1/)
- [Apify actor dataset API](https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post)

Commercial quotas, pricing, data rights, retention, and regional coverage are
not assumed from public product pages; they require procurement evidence before
any integration decision.
