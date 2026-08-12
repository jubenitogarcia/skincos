# Comments intelligence v1

M9 adds a bounded, aggregate-only analysis boundary. It does not fetch
comments, own provider sessions, invoke a provider, schedule a job, or expose
raw text through the MCP or CRM. An approved collector supplies a temporary
sample and this module returns minimized aggregates. The PostgreSQL migration
`20260812_influencer_intelligence_comments_v1.up.sql` is additive and remains
unapplied until the governed database gate is satisfied.

## Sampling

`sampleCommentRecords` accepts at most 200 candidate records and selects at
most 100 comments. The default is 50. `bounded_recent` consumes the provider's
bounded order; `deterministic_uniform` selects evenly spaced records. The
result includes a versioned audit object with strategy, requested limit,
candidate count, selected count, truncation, source order, and aggregate-only
retention. There is no implicit request for all comments.

Comment text exists only for the duration of lexical or semantic analysis. A
commenter digest, when needed for repeated-commenter metrics, must already be
a domain-scoped SHA-256 digest. Raw provider IDs, usernames, contact fields,
and comment text are rejected from the persistence path.

## Deterministic metrics

All ratios use the selected sample as their denominator unless the metric
requires a labeled subset. A metric that has no usable labels is
`unavailable` with `value: null`; it is never silently converted to zero.

- `unique_commenter_ratio`: unique commenter digests divided by labeled
  commenter digests.
- `emoji_only_ratio`: comments containing only emoji, variation selectors,
  modifiers, joiners, marks, and whitespace divided by sample size.
- `duplicate_ratio`: duplicate occurrences after Unicode normalization,
  case-folding, punctuation normalization, and whitespace collapse divided by
  sample size.
- `near_duplicate_ratio`: non-exact comments with a peer at normalized
  Levenshtein distance at most 0.12 or token Jaccard similarity at least 0.8,
  divided by sample size. Exact duplicates are not counted again.
- `generic_short_comment_ratio`: comments of at most 24 characters matching
  the bounded generic phrase lexicon divided by sample size.
- `repeated_commenter_ratio`: comments authored by a digest occurring at least
  twice divided by labeled commenter comments. This is an aggregate pattern,
  not an individual bot or fraud classification.
- `comment_length_distribution`: count, mean, median, and fixed length bins.
- `language_distribution`: labeled language counts and explicit unknown count.
- `comment_like_distribution`: fixed like-count bins, mean, median, and
  explicit missing count when like counts are partially available.

## Semantic interface

An optional injected analyzer receives only `sample_index` and ephemeral text.
It must return the closed schema
`influencer-intelligence-comments-semantic/v1` with a model version,
confidence, four aggregate relevance counts (`relevant`, `generic`,
`spam_like`, `unknown`), bounded evidence codes, and opaque evidence refs.
Free-form notes, arbitrary scores, raw text, identity labels, and individual
bot claims are rejected. Semantic output is `inferred`, while lexical metrics
remain `derived`.

## Comment quality and confidence

`comment_quality_score` is independent from the Influencer Score. Its
deterministic components are:

```text
originality = 1 - (0.60 * duplicate_ratio + 0.40 * near_duplicate_ratio)
substance = 1 - (0.60 * generic_short_comment_ratio + 0.40 * emoji_only_ratio)
audience_diversity = unique_commenter_ratio (when available)
semantic_relevance = relevant / sample_size (when the structured analyzer is available)
```

The configured weights are originality 0.30, substance 0.30, audience
diversity 0.20, and semantic relevance 0.20. Missing components are excluded
from the weighted numerator and denominator, while the independent confidence
falls. Confidence combines sample size (50 comments for the full factor),
metric coverage, commenter-label coverage, semantic confidence, freshness,
and the declared provider reliability. Therefore a small or partial sample
cannot receive high confidence merely because one metric looks favorable.

The persisted row stores `sampling_version`, `sampling_config`,
`algorithm_version`, `quality_score`, `quality_confidence`, and optional
`model_version`; the JSON aggregate contains only bounded metrics, factors,
coverage, freshness, provenance references, and limitations.

## Scope and rollout

This milestone changes no provider adapter, workflow, CRM route, MCP tool, or
feature flag. It is source-only, synthetic-testable, and compatible with the
existing append-only `creator_comment_sample` relation. The module remains off
by default and does not initiate engagement actions.

