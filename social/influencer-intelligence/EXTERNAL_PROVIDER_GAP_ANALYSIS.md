# Influencer Intelligence external-provider gap analysis

Status: source-only analysis. No external provider is integrated, configured, or
called by this milestone. This is a source-level capability review, not a live
coverage study; observed coverage rates and commercial decision impact remain
unproven until the governed collector/runtime exists.

Review date: 2026-08-12.

## Decision in one paragraph

The current stack is sufficient for deterministic, read-only analysis of
first-party Meta accounts when the official permissions and metrics are
available, and for building SKINCOS-owned history, content features, comment
aggregates, analytics, and scores. It is not sufficient for reliable
professional evaluation of arbitrary creators when the decision depends on
audience demographics, cross-creator audience overlap, discovery at scale,
verified reach, or a vendor's audience-credibility model. No external service
should be added to fill those gaps yet: the current source has no production
collection/runtime wiring, the score is still calibrated only on synthetic
data, and a generic scraper would add compliance and provenance risk without a
stable contract. A narrowly scoped, shadow-only vendor POC may be reconsidered
after the gates in this document are met.

## Scope and evidence boundary

This review covers the source currently present in:

- `social/influencer-intelligence`: provider router, snapshots, analytics,
  scoring, comments, content analysis, Campaign Fit, MCP adapter, CRM
  projection, scheduler source, calibration, and persistence contracts;
- `social/instagram`: existing Meta/private transport boundary and the legacy
  module that contains instagrapi and an Instaloader content-download path;
- `platform/security/token-vault`: existing credential custody boundary;
- the independent Orb repository: authenticated, bounded read-only gateway
  contract.

The analysis does not treat fixtures, the legacy simulator, or an uncollected
snapshot as live evidence. Historical data cannot be reconstructed before the
first SKINCOS snapshot. No public creator was scraped for this review.

The provider router currently allows only `meta-graph` and `instagrapi`, in that
order. Future providers must be explicitly configured, allowlisted, and
reviewed; the current milestone does not widen that runtime allowlist.

## Current stack and remaining boundary

| Source | What it can contribute now | Material limitation for professional evaluation | Decision |
| --- | --- | --- | --- |
| Meta Graph / Instagram official | First-party profile/media metrics and eligible insights for authorized professional accounts; strongest provenance and compliance posture | Access, permissions, account type, metric availability, and historical depth are constrained; it is not a universal arbitrary-public-creator database | Keep as first preference; improve official coverage and evidence before adding vendors |
| Existing `social/instagram` / instagrapi | Controlled fallback for the already-approved private transport boundary and bounded profile/media observations | Session/challenge/rate-limit/ToS risk; coverage and metric semantics are less stable than official data; must not be treated as equivalent to official insights | Keep only as an isolated fallback; no duplicate implementation |
| Existing Instaloader path | Legacy module capability for content download, located in `social/instagram/module/instagram_main.py` | Not an approved Influencer Intelligence provider; download/scrape behavior is not a professional metric provenance contract and may be unbounded if reused incorrectly | Do not add or call from this domain |
| SKINCOS history | Append-only profile/media observations, growth velocity/acceleration, cadence, outliers, freshness, provider provenance | Cannot backfill before first snapshot; current source/runtime is not yet connected to a production collector | First investment; this is the most defensible source for longitudinal signals |
| Content intelligence | Bounded topics, categories, brand/competitor mentions, sponsored/promotion signals, format and safety features with model/version evidence | Derived/inferred features; media availability and model coverage are bounded; it is not audience demographics or fraud proof | Keep; do not buy a duplicate content classifier |
| Comment intelligence | Bounded aggregate sample quality, duplication, language, generic/spam and semantic-relevance signals | Sampling bias; no individual bot/fraud fact; no full-audience inference; raw text is intentionally minimized | Keep; do not replace with a larger comment scraper without a measured gap |

Meta's own API material describes the professional-account and permission
boundary for profile and insight access; it is not evidence that an arbitrary
consumer account can be evaluated through the official API. See the [Meta
Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
and its [Insights collection](https://www.postman.com/meta/instagram/folder/23987686-f659d7d1-74ec-44e4-9192-9b1e8694c511)
(reviewed 2026-08-12).

## Source-level gaps and what remains unproven

“Gap” here means that the current source/contracts cannot guarantee the
capability. Priority means the impact on a professional creator decision, not
how easy the gap is to purchase. This report does not claim live coverage
percentages, vendor accuracy, or commercial lift.

| Gap | Priority | Can be resolved by SKINCOS history? | Derived metric? | Official API? | Apify | HypeAuditor | Modash | Recommendation |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Audience geography, age, gender, language, and interests for arbitrary creators | critical | No | No, not without evidence | Yes, for eligible first-party accounts | Possibly modeled/collected, but not equivalent | Yes, subject to account/API contract | Yes, subject to provider coverage | Keep unavailable when absent. Candidate for a measured vendor POC only if campaign decisions require it |
| Audience authenticity / credibility signal | high | Partly: anomaly history and bounded pattern signal | Partly, but never a factual fake-follower claim | Usually not as a public arbitrary-creator quality score | Possible through actor/model, with high provenance and ToS risk | Strongest apparent specialist fit | Credibility/quality data may be available depending on product/contract | Do not integrate until benchmark, false-positive review, legal review, and evidence semantics exist |
| Verified reach, impressions, saves, shares, and story insights for arbitrary creators | high | Only after collection | Ratios cannot create unavailable absolute reach | Yes for eligible accounts/insights | May estimate or collect public proxies, not equivalent | May provide modeled or reported metrics | May provide report metrics depending on account | Official-first; external only for a documented measurement requirement |
| Creator discovery and normalized search across a large eligible universe | high | No, not at useful scale | No | Limited by owned/authorized graph | Yes, but actor-specific and scraping-risky | Yes, commercial discovery API | Yes, Discovery API | Defer until a real campaign workflow proves discovery is the bottleneck |
| Audience overlap / deduplicated reach between creators | medium | Not from current scalar history | No | Not a general public capability | Possible but identity/quality risk | Product/API dependent | Documented as a Discovery API capability | Modash is the best candidate for a shadow POC; do not affect score weights |
| Historical sponsored posts, collaborations, and brand/category footprint beyond collected media | high | Yes, progressively, from first snapshot | Yes, with bounded content signals | Partly for eligible first-party data | Possible but actor/model-dependent | Report/social-listening APIs advertise this class | Product/API documentation advertises collaboration/brand data | Build SKINCOS history first; external only if the missing lookback changes a decision materially |
| Population benchmarks by market, tier, and category | medium | Yes, once representative SKINCOS data exists | Yes, after sample-size gates | Not generally a universal benchmark source | Not a stable benchmark authority | May supply vendor benchmarks | May supply normalized reports/benchmarks | Do not import opaque external benchmarks into v0; keep unavailable until SKINCOS has enough data |
| Cross-platform identity and performance | medium | No, current domain is Instagram-focused | No | Platform-specific | Possible | Advertised multi-network discovery/report coverage | Advertised multi-network discovery/report coverage | Out of scope until product explicitly becomes cross-platform |
| Comment/content feature extraction | low | Yes, with current bounded modules | Yes | Not needed | Duplicative | Duplicative | Duplicative | No integration |
| Contact enrichment / creator email or personal identity | low | No, intentionally | No | Not needed | Possible | API/product may expose unlock/email operations | Product-specific | Reject for this domain; unnecessary PII and not required for scoring |
| Batch freshness, throughput, and operational capacity | high operational gap | Yes, with collector/runtime work | No | Limited by permissions/rate limits | Async actor/dataset execution can add scale | Vendor-specific | Credit/API limits and vendor capacity | First fix SKINCOS collector, leases, metrics, and Token Vault action; do not hide runtime gaps behind a vendor |

## Candidate comparison

The comparison is qualitative where commercial quotas, pricing, or contractual
limits are not public or are plan-specific. Exact limits must be verified during
procurement and stored as configuration/evidence, never guessed in code.

| Candidate | Quality / coverage | Stability | Compliance / risk | Cost / API / limits | Lock-in | Incremental value | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Meta official | Highest provenance for authorized professional accounts; first-party insights | Highest semantic stability for supported fields | Best fit for official-first policy; still requires permission/data-retention review | Meta API access and infrastructure cost; permissions and rate limits are account/app dependent | Platform/API semantics lock-in, but required source | Essential, not optional | Continue and prioritize |
| Existing instagrapi fallback | Useful controlled fallback for current private transport | Lower; sessions and upstream behavior can fail or change | Highest operational/compliance risk among current sources; no engagement actions | Existing infrastructure; bounded calls, retries, and circuit breaker required | Existing implementation coupling | Coverage when official data is unavailable, not new professional truth | Keep isolated and conservative |
| Instaloader | Potential public content coverage | Community/library behavior can drift | Scraping/ToS and rate-limit risk; no approved II provenance contract | Library/runtime and target-site limits; no vendor SLA | New duplicate path and data model | Low over existing legacy capability, high risk | Do not integrate |
| Apify | Broad actor ecosystem and asynchronous dataset API; quality varies by actor | Actor-specific; no single semantic SLA | Public scraping, session/token handling, retention, and actor supply-chain risks | Usage/compute/storage plus actor-specific pricing; API supports bounded actor runs/datasets; limits vary | High actor/data-shape lock-in | Could fill public discovery/collection gaps, but not official insight equivalence | No generic actor; only a future allowlisted, gap-specific POC |
| HypeAuditor | Specialist discovery, reports, audience, historical activity, and authenticity-oriented product surface | Commercial API/SLA must be verified | Requires DPA, retention, model/evidence semantics, and false-positive review | API access and pricing are contract/plan dependent; limits not assumed | High proprietary model/report lock-in | Potentially high for authenticity and professional audience analysis | Conditional POC only after vendor due diligence |
| Modash | Official docs expose discovery/report, audience, overlap, and collaboration-oriented capabilities; strong fit for demographics/overlap gaps | Product/API version and coverage must be verified per market | Vendor model provenance, retention, and data-subject/legal review required | Bearer API and credit-based product documentation are public; exact quota/pricing still requires commercial validation | High proprietary audience/search schema lock-in | Highest apparent incremental value for audience data, discovery, overlap, and collaboration history | Candidate for time-boxed shadow POC, not production integration |
| Other provider | Unknown until a specific measured gap and contract are named | Unknown | Unknown | Unknown | Unknown | Cannot be evaluated generically | Do not add |

Modash publishes a Discovery API surface covering Instagram discovery/report
and related audience/collaboration data; this is a capability claim, not a
guarantee of coverage for every creator or market. See the [Modash Instagram
Discovery API](https://docs.modash.io/products/discovery_api/openapi_doc/discovery/instagram)
(reviewed 2026-08-12). HypeAuditor publishes a recruitment API and describes
report/discovery integrations, but commercial access, quotas, model
definitions, and retention still require vendor validation; see its [public
OpenAPI](https://hypeauditor.com/swagger/public-api/v1/) and [API integration
overview](https://hypeauditor.com/api-integration/).

Apify is a generic actor execution and dataset platform rather than a single
Instagram truth source. Its API documents bounded actor runs and dataset
retrieval, while actor quality, target-site compliance, and output semantics
remain actor-specific. See the [Actor run dataset endpoint](https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post)
and [JavaScript API examples](https://docs.apify.com/api/client/js/docs/guides/examples).

## Recommendation matrix

| Horizon | Action | Gate | Expected value | Explicitly not allowed |
| --- | --- | --- | --- | --- |
| Now | Keep Meta official-first, existing isolated instagrapi fallback, append-only SKINCOS history, deterministic analytics/scoring, bounded comments/content intelligence | Complete runtime/service/Token Vault/staging gates and calibration evidence before commercial use | Better provenance, longitudinal stability, and lower compliance risk | No new scraper, no external call, no score activation |
| Now | Add collection observability and coverage dashboards for the gaps already modeled as unavailable | Runtime must expose provider attempts, latency, gap codes, freshness, partial coverage, and audit | Distinguishes a data gap from a bad creator | No imputation and no benchmark invention |
| Conditional POC A | Evaluate Modash for audience demographics, audience overlap, discovery, and collaboration history | 20–50 approved real creator identities; synthetic identities only for adapter/contract tests; read-only shadow adapter; Token Vault; cost/rate budget; field-level provenance; agreement study against Meta/own history; no score weight changes | Tests the most material current campaign-fit gaps | No production routing, no silent fallback, no automatic score inputs |
| Conditional POC B | Evaluate HypeAuditor for audience credibility/authenticity and professional reports | Contract/API access, DPA/legal review, model definitions, false-positive/ground-truth protocol, retention and deletion contract | Tests the highest-value unresolved integrity signal | Never label a creator or follower as fake based only on a vendor score |
| Later | Evaluate cross-platform provider | Product scope and campaign demand explicitly expand beyond Instagram | Potential broader creator universe | No cross-platform schema expansion by assumption |
| Reject | Generic Apify actor or new Instaloader path | None; reject for current MVP | Low incremental value relative to risk and duplication | No unbounded scraping or actor-specific payloads |

## External-provider admission gate

An external provider may be added only if every item below is evidenced in a
   separate, single-purpose change:

1. A named gap remains after Meta official, SKINCOS history, and deterministic
   derived metrics are measured against the requested use case.
2. The provider is explicitly configured and allowlisted; default is disabled.
3. Credentials are held by `platform/security/token-vault`; no token or session
   enters the router, MCP, CRM, Orb payload, logs, fixtures, or evidence.
   4. The provider implements the existing typed operation/result contract,
   including provider, retrieval time, classification, freshness, limitations,
   evidence, and data. Structured errors, timeout, safe retry, circuit state,
   and attempt classification remain the separate router/observability response
   contract; they must not be implied as fields of provider data or silently
   dropped at the adapter boundary.
5. Inputs and outputs are bounded, read-only, auditable, and retention-reviewed;
   raw provider payloads and unnecessary PII are not persisted.
6. The provider is shadow-only until coverage, disagreement, false-positive,
   freshness, cost, and rate-limit behavior are measured on approved data.
7. The score and Campaign Fit algorithms do not consume the new signal until a
   versioned calibration/weights change is separately reviewed.
8. The provider can be disabled by configuration and rolled back without
   rewriting existing snapshots or scores.

## Conclusion

There is material future value in a provider that supplies audience
demographics/overlap and, separately, a validated authenticity model. There is
not enough evidence to integrate one into the current production path. The
recommended next artifact, if commercial demand justifies it, is a Modash
shadow POC focused on audience data and overlap; HypeAuditor remains a higher
risk, higher-governance POC for authenticity. Apify, Instaloader, and external
comment/content services do not currently demonstrate enough incremental value
over the SKINCOS stack.
