# Influencer Score v0.1

`scoring.mjs` is a pure deterministic boundary over the versioned analytics
artifact. It does not call providers, an LLM, PostgreSQL, Orb, CRM, MCP, or a
network. A caller supplies optional comments, commercial-saturation, and
brand-fit values only as bounded structured signals with evidence references.

This is a backward-incompatible v0 algorithm revision: the algorithm version
is `influencer-intelligence-scoring/v0.1`; the weights remain
`influencer-intelligence-scoring-weights/v0`. Historical v0 artifacts remain
readable and are not rewritten.

The output always includes `overall_score`, `confidence_score`,
`data_coverage`, `algorithm_version`, `weights_version`, `calculated_at`,
`input_snapshot_keys`, `input_evidence_refs`, `input_fingerprint`, component
scores, and deterministic explanation codes. The result is frozen and can be
persisted as a new append-only score artifact.

## Components and weights

| Component | Weight | Source rule |
| --- | ---: | --- |
| `engagement_quality` | 0.20 | Median engagement rate, with comment/like ratio when available |
| `growth_integrity` | 0.14 | Profile growth history and bounded growth-pattern anomalies |
| `content_performance` | 0.16 | Engagement rate and views/follower ratio when available |
| `consistency` | 0.12 | Posting-interval dispersion and engagement volatility |
| `comment_quality` | 0.08 | Structured aggregate comment signal; unavailable by default |
| `commercial_saturation` | 0.08 | Structured saturation signal; unavailable by default |
| `brand_fit` | 0.08 | Structured campaign/brand signal; unavailable without a brief |
| `risk` | 0.08 | Bounded pattern/outlier indicators; never a fake-follower fact |
| `profile_integrity` | 0.06 | Profile metric coverage and history length |

Weights are configuration, not prompt instructions. When a component is
unavailable, its configured weight is excluded from the weighted mean and the
remaining weights are normalized. This avoids treating missing data as a zero
score; `data_coverage` and `confidence_score` expose the missing component and
limit decision confidence.

The score uses normalized rates and robust analytics, never absolute follower
count as a quality input. Ratio thresholds are versioned internal v0 scoring
configuration, not external benchmarks. Follower-tier benchmarks remain
unavailable until a governed SKINCOS calibration dataset exists.

## Confidence and coverage

`confidence_score` is an objective 0..100 envelope over history length, media
history, comment sample size, freshness, provider reliability, official-provider
availability, and analytics metric coverage. A one-snapshot or stale fallback
result therefore cannot receive high confidence even if a component can be
computed. More specifically, fewer than two metric-bearing profile observations
or fewer than two metric-bearing media observations applies the versioned
`shortHistoryConfidenceCap` of 0.55 (55/100); timestamp-only or unavailable
snapshots do not satisfy that gate. Missing risk signals remain unavailable: a penalty is calculated only
from the outlier or anomaly series that actually exists.

`data_coverage` combines analytics metric coverage (65%) with the configured
weight of components that have usable evidence (35%). `null` and
`unavailable` remain distinct from observed numeric zero.

The input fingerprint binds the analytics evidence state, coverage, providers
(including providers contributed by structured signals), provenance, snapshot
keys, and each component's value, confidence, model version, weight,
contribution, explanation, and evidence references. A change to audit metadata
therefore creates a distinct score artifact.

## Safety and explanations

Every component carries an evidence state, confidence, bounded references, and
a deterministic explanation `{ code, inputs, limitations }`. Growth and
outlier signals are pattern indicators only; the engine never labels a creator
or follower as fake from indirect evidence. LLM text or free-form rationale is
not accepted by this boundary.
