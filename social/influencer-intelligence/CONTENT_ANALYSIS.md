# Content analysis v1

M10 adds a bounded, evidence-bearing content projection for recent creator
media. It is a feature layer, not a scoring engine and not a media archive.

## Boundary

The analyzer receives at most 50 provider media candidates and selects at most
20 recent items, ordered by `published_at` descending with input order as the
deterministic tie-breaker. The default sample is 12 items. Each item may carry
an ephemeral bounded caption and transcript, plus at most three structured
representative-frame references. Binary media, download paths, URLs with query
strings, tokens, raw provider payloads, and unrestricted model text are
rejected.

The current source does not connect Agent Zero Whisper/vision, the Meta Ads
workflow nodes, a provider transport, or a new external model dependency.
Those capabilities are existing adjacent infrastructure, not an approved
Influencer Intelligence runtime boundary. A later governed adapter may inject
an analyzer implementing the closed
`influencer-intelligence-content-semantic/v1` schema.

## Output

Each item exposes the following signal objects, and the same fields are
aggregated across the bounded sample:

- `topics`
- `product_categories`
- `brands_mentioned`
- `competitors`
- `sponsored_signal`
- `promotion_coupon_signal`
- `skincare_affinity`
- `education_vs_entertainment`
- `claim_types`
- `content_format`
- `brand_safety_flags`

A signal has `value`, `evidence_state`, `confidence`, `evidence_refs`, and
`limitations`. Missing evidence is `value: null` with state `unavailable`;
an empty, derived label set means the bounded evidence was analyzed but no
label in the controlled vocabulary matched. An observed media format is not
overwritten by a model prediction.

The envelope always carries `algorithm_version`, `model_version` (null when
no semantic model was used), `data_classification`, `freshness`, `confidence`,
`coverage`, `provider_specific_evidence`, `evidence_refs`, and limitations.
When the injected analyzer returns a valid structured result, semantic fields
are labeled `inferred` and include the model version and bounded references.
Malformed model output is rejected; analyzer transport failures leave the
deterministic projection explicit and mark semantic inference unavailable.

## Deterministic baseline

The source-only baseline uses a small versioned controlled vocabulary over
caption/transcript text and accepts already-normalized context labels. It does
not claim that absence of a sponsorship marker proves absence of sponsorship;
the corresponding signal carries a limitation. Brands and competitors are
unavailable unless a bounded structured entity projection is supplied or a
future approved semantic analyzer returns them.

The output never contains `overall_score`, `campaign_fit_score`, weights, or
any other score decision. Influencer Score and Campaign Fit remain separate
versioned service computations.

## Persistence and retention

`analyzeAndPersistContentSample` reuses the existing append-only
`creator_analysis` PostgreSQL boundary. It persists only the safe
`persistence_metrics` projection: labels, aggregate signal metadata, media
keys, timestamps, sampling, confidence/coverage, model metadata, and evidence
references. Captions, transcripts, frame data, and input media are not passed
to the repository. Recomputations use a new ingest key and input fingerprint;
the existing repository idempotency contract makes a replay a no-op.

## Existing multimodal capabilities

SKINCOS already contains Whisper and vision helpers in Agent Zero and
transcript/video-analysis nodes in the Meta Ads publishing workflow. They are
not imported here because they own different runtime/context boundaries and
may load or temporarily process media. A production connection requires a
separate read-only analytics adapter, retention decision, timeout, cost/rate
limit, audit, and Token Vault review.

