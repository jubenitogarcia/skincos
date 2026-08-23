# Deterministic analytics v1

The analytics boundary is `analytics.mjs` and exports
`computeInfluencerAnalytics(input)`. It is a pure ESM module: it receives
normalized profile/media snapshots and a canonical `computedAt` timestamp, and
returns a frozen derived artifact. It does not call a provider, read a secret,
open a database connection, schedule work, or expose an HTTP route.

The architecture defines this domain as runtime-free ESM and the existing
provider, contract, repository, and test boundaries are Node ESM. Python would
introduce a second runtime boundary without a current SKINCOS dependency, so
this milestone deliberately stays in the existing Node boundary.

## Input and evidence rules

Each profile snapshot has an opaque `snapshotKey`, `provider`, `observedAt`, and
the normalized count fields `followersCount`, `followingCount`, and
`mediaCount`. Each media snapshot has an opaque `snapshotKey`, `mediaKey`,
`provider`, `observedAt`, optional `publishedAt`, `mediaKind`, and the count
fields `likesCount`, `commentsCount`, `viewsCount`, `reachCount`, and an
optional per-media `followersCount`.

Missing fields and explicit `null` are unavailable. A numeric zero is observed
and remains a usable value. The engine rejects a value paired with
`evidenceState: unavailable`; it never converts a missing value into zero.
Analytics output uses `evidenceState: derived` only for calculations with at
least one usable input. A missing denominator produces `value: null` and an
explicit reason such as `zero_or_missing_initial_followers`,
`zero_denominator`, or `no_media_with_complete_engagement_denominator`.

The engine uses an as-of join for engagement denominators: if a media snapshot
does not carry `followersCount`, it uses the latest observed profile follower
snapshot at or before that media snapshot's `observedAt`. It never uses a
future profile observation and never creates a pre-first-snapshot value.

## Statistics

For a finite series `x` of `n` available observations:

- `mean = sum(x) / n`.
- `median` is the 50th percentile.
- Percentiles `p10`, `p25`, `p50`, `p75`, and `p90` use sorted values with
  linear interpolation at position `(n - 1) * p`.
- `standardDeviation` is population standard deviation,
  `sqrt(sum((x - mean)^2) / n)`, and is reported only when `n >= 2`.
- `IQR = p75 - p25`.
- `MAD = median(abs(x - median))`.
- `trimmedMean` removes 10% from each tail when at least five observations
  permit removing a complete value from both tails.
- `winsorizedMean` replaces the lowest/highest 10% with the nearest retained
  boundary. When fewer than 10% can be removed, it equals the ordinary mean
  for a series with at least two observations.

The engine reports the available count, expected count, ratio, confidence, and
limitations alongside these values. Expected counts are never zero in the
output coverage envelope; an empty input uses a one-unit unavailable envelope
with an explicit reason, so no division by zero is hidden.

## Profile growth

Profile snapshots are ordered by `observedAt` and then `snapshotKey`.

- `absoluteDelta = lastFollowers - firstFollowers` requires two distinct
  timestamped follower observations and may legitimately be zero.
- `relativeGrowthRate = absoluteDelta / firstFollowers` is unavailable when
  the initial follower count is missing or zero.
- For adjacent usable observations,
  `growthVelocity = deltaFollowers / elapsedDays`.
- For adjacent velocity intervals,
  `growthAcceleration = (velocity2 - velocity1) / averageIntervalDays`.

Following and media count receive the same descriptive statistics but are not
treated as quality scores. Growth anomalies compare at least three valid
velocity intervals against a robust baseline: median ± 3 MAD when MAD is
positive, Tukey 1.5 IQR fences otherwise, and a distinct-from-constant rule
when both scales are zero. An anomaly is labeled only as a bounded
`growth_pattern_anomaly`; it is not a fake-follower determination.

## Posting cadence

Cadence uses one publication per distinct `mediaKey`, ordered by `publishedAt`.
Repeated metric snapshots for the same media do not create extra posts.

- `postingInterval` is the distribution of positive differences between
  adjacent publication timestamps, in days.
- `postsPerDay = distinctPublications / (lastPublishedAt - firstPublishedAt)`
  is unavailable for fewer than two distinct publications or a zero-length
  publication window.

## Engagement and media performance

- `engagementRate = (likes + comments) / followersAtObservation`.
- `commentLikeRatio = comments / likes`; it is unavailable when likes are
  missing or zero.
- `viewsFollowerRatio = views / followersAtObservation`.
- `medianViews` is the median of available views; missing views are not zero.

Follower, likes, comments, views, reach, and the ratio series all retain the
same robust summary shape. Reel/video performance is calculated only from
`reel`, `video`, `short`, and `live` media kinds. A provider that does not
return views or reach leaves the corresponding metric unavailable.

## Volatility, trend, and outliers

- `coefficientOfVariation = standardDeviation / mean` is reported only for a
  positive mean.
- `robustMadRatio = MAD / median` is reported only for a positive median.
- Trend is an ordinary least-squares slope per day over timestamped values.
  Direction is `up`, `down`, or `flat` from the slope sign. `rSquared` is
  unavailable for a constant series rather than being forced to zero.
- The ordinary outlier ratio uses Tukey fences
  `[p25 - 1.5*IQR, p75 + 1.5*IQR]`.
- The viral outlier ratio uses an upper robust fence
  `max(p75 + 3*IQR, median + 3*MAD)`. When both robust scales are zero, a
  value must be strictly above the median to be viral. Both ratios require at
  least three observations.

These rules are scale-normalized and do not classify a creator from an
absolute follower threshold or let one viral post replace the rest of the
series. A viral post remains observed evidence and is available for separate
inspection; robust summaries reduce its leverage.

## Follower-tier benchmark structure

The result always contains `followerTierBenchmark` with `source:
skincos_internal`, `status`, `tierKey`, `sampleSize`, and `metrics`. With no
governed internal benchmark dataset it is:

```json
{
  "evidenceState": "unavailable",
  "status": "unavailable",
  "source": "skincos_internal",
  "tierKey": null,
  "sampleSize": 0,
  "metrics": {},
  "unavailableReason": "no_internal_benchmark_dataset"
}
```

The engine does not define external tier cutoffs, import industry norms, or
claim that a sample is a benchmark. A later calibration milestone may supply a
governed internal benchmark artifact with its own provenance and version.

## Determinism and persistence handoff

The result carries `algorithmVersion`, `computedAt`, `window`,
`inputSnapshotKeys`, `providers`, and structured provenance. The caller may
persist it through the existing append-only analysis repository as a new
versioned artifact. Recomputing with the same input and `computedAt` produces
the same metrics; changing snapshots or the algorithm version produces a new
derived artifact rather than mutating history.
