# Influencer Intelligence snapshots

`snapshots.mjs` implements the internal, bounded collection operations
`snapshot_creator` and `snapshot_creator_media`. It is deliberately not a
scheduler: Orb or another trusted caller invokes one operation at a time and
owns cadence, queueing, concurrency and resume policy.

## Persistence contract

- A collector run is created before a provider call and finalized as
  `completed`, `partial`, `unavailable` or `failed`.
- A crashed worker cannot leave a run permanently claimable: an unexpected
  operation failure finalizes the run as `failed`, and a still-`running` row is
  reclaimable only after the bounded 180-second lease expires. A failed run is
  retryable only within the bounded attempt budget. Each attempt has a private
  lease token, so a superseded worker cannot finalize the reclaimed run or write
  evidence/snapshots after its lease is lost. A live run is still deduplicated
  and is never run concurrently under the same key.
- Provider attempts that fail are recorded as `collector_evidence` with a
  normalized gap code. A failure never becomes a metric value.
- Successful profile and media observations are written through the repository
  into append-only snapshot tables. The migration triggers reject update,
  delete and truncate on historical evidence.
- Artifact `ingest_key` values include creator, provider, media (when
  applicable), observed-time bucket and operation. Repeating a request in the
  same bucket is a no-op; a later bucket creates a new historical row. Existing
  rows are never rewritten to reflect changed metrics. Evidence keys are
  attempt-scoped on retries, so a new provider response cannot point at an
  immutable evidence row left by a failed partial attempt.
- Fenced evidence, identity and snapshot writes lock the collector lease row
  before checking its token. Reclamation and persistence therefore serialize;
  a superseded worker cannot win a write race after a retry takes ownership.
- `null` is used for a missing metric. Zero is persisted only when the provider
  explicitly returns zero.
- The operation uses the provider's observed timestamp and never synthesizes a
  timestamp for a period before collection began. A caller-supplied timestamp is
  an observation request boundary, not a backfill authority.
- Freshness, coverage, limitations, data classification, provider evidence and
  structured failures are returned to the caller. Bounded freshness metadata is
  retained with available normalized metrics.

## Profile collection

`snapshot_creator` requires the existing internal `identityKey` so an observed
profile cannot be persisted without a registry identity. It records followers,
following and media count independently; a private or partially covered profile
therefore remains visible without converting unavailable fields to zero.

## Media collection

`snapshot_creator_media` selects at most 50 recent media items, then requests
metrics for that bounded set. Publication timestamps are retained on the media
identity and in the media snapshot's normalized metadata when present. Likes,
comments, shares, saves, views, reach and impressions remain independent nullable
fields. Missing media or metric fields produce explicit unavailable coverage.

Provider transports, credentials, sessions, HTTP clients, scraping, engagement,
publication and scheduling are outside this module. The provider router remains
official-first and performs its own bounded timeout, retry and circuit handling.
