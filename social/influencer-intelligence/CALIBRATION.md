# Influencer Intelligence calibration report

Status: passed for the synthetic dataset `influencer-intelligence-calibration-golden/v1`.

This report validates deterministic policy guardrails for analytics, Influencer
Score v0, confidence/coverage, and Campaign Fit. It is not a claim that the
score predicts commercial outcomes. No provider, network, external creator,
database, workflow, or real-user data is used.

## Run identity

- Calibration contract: `influencer-intelligence/calibration/v1`
- Analytics algorithm: `influencer-intelligence-analytics/v1`
- Score algorithm: `influencer-intelligence-scoring/v0`
- Score weights: `influencer-intelligence-scoring-weights/v0`
- Campaign Fit algorithm: `influencer-intelligence-campaign-fit/v1`
- Campaign Fit weights: `influencer-intelligence-campaign-fit-weights/v1`
- Calculated at: `2026-08-12T12:00:00.000Z`
- Adjustments made for this run: none

## Cases

| Case | Expected behavior | Actual behavior | Result |
| --- | --- | --- | --- |
| small-stable-baseline | Scoreable baseline, but sparse history and missing optional signals prevent high confidence. | Score `57.053`, confidence `65.5`, coverage `91.6`; derived and finite. | PASS |
| follower-scale-normalization | Absolute followers do not dominate normalized quality. | Scale-transformed score `57.053` vs base `57.053`; max component delta `0.000000`; large fixture `54.698` remains contextual only; no raw follower shortcut. | PASS |
| viral-outlier-resistance | Viral post is visible, while robust summaries bound its effect. | Likes mean `104.182`, median `15`, trimmed mean `15.111`; score delta after removing viral post `7.261`. | PASS |
| follower-spike-pattern-only | Spike is a growth-pattern anomaly, never a factual fake-follower conclusion. | Anomaly ratio `0.25`; interpretation `growth_pattern_anomaly`; risk `82.5`; no factual phrase. | PASS |
| partial-and-missing-metrics | Missing views/engagement remain unavailable and reduce coverage. | No-views coverage `83.9`; incomplete-series coverage `52`; unavailable values remained `null`. | PASS |
| short-history-confidence | Few posts do not manufacture cadence/outlier statistics; confidence is lower. | Confidence `53.5`, coverage `79.7`; posting interval and outlier ratio unavailable. | PASS |
| irregular-engagement-volatility | Irregular engagement produces explicit robust volatility/outlier signals. | Engagement CV `1.6524`, likes outlier ratio `0.125`, no non-finite values. | PASS |
| zero-denominator-extreme | Observed zero remains zero; ratios with zero denominators are unavailable. | Likes mean `0`; engagement rate unavailable/null; growth rate unavailable/null. | PASS |
| score-confidence-separation | A sparse score may be bounded without high confidence. | Score `88.485`, confidence `58.6`, coverage `88.1`; one media item and comment sample factor `0.01`. | PASS |
| campaign-fit-separation-and-missing-demographics | Campaign Fit is separate; conflict/saturation reduce fit and missing demographics reduce confidence. | Good `84.650/95.280/100`; conflict `51.059/41.274/85`; control `62.824/41.274/85`; missing demographics `57.867/40.149/75`; high saturation `49.422/40.149/75`. | PASS |

The machine-readable source of truth is `runInfluencerCalibration()` in
`calibration.mjs`; the test suite asserts all cases, versions, determinism,
finite arithmetic, and an empty divergence/adjustment set.

## Interpretation and known limitations

The suite intentionally checks invariants and policy boundaries instead of
selecting weights to hit desired example scores. It does not establish:

- population calibration against real creators;
- predictive validity for conversions, reach, or campaign outcomes;
- provider-level reliability distributions or production freshness behavior;
- a trustworthy follower-tier benchmark, which remains unavailable;
- correctness of a live provider, database, MCP registration, CRM upstream, or
  Orb runtime, because those surfaces remain off and are outside this synthetic
  calibration run.

Run the focused suite with:

```text
node --test social/influencer-intelligence/tests/calibration.test.mjs
```
