# Influencer Intelligence data model v1

Status: source-controlled additive PostgreSQL artifact; not applied to local,
staging, or production by this milestone.

The canonical schema is `influencer_intelligence`. The base migration is
`migrations/20260811_influencer_intelligence_data_model_v1.up.sql` and depends
on the M1 registry migration. Snapshot collection metadata is added
additively by `migrations/20260811_influencer_intelligence_snapshots_v1.up.sql`.

## Naming and boundaries

The existing M1 names are retained to avoid a destructive rename:

| Concept | PostgreSQL relation | Role |
| --- | --- | --- |
| creator | `creator_registry` | One current, opaque creator record; optional public handle only |
| creator identity | `creator_identity` | Provider-neutral, pseudonymous provider binding |
| legacy provider registry | `creator_provider_registry` | M1 compatibility projection; not a raw provider cache |
| profile snapshot | `creator_profile_snapshot` | Append-only normalized profile observation |
| media | `creator_media` | Stable media identity without raw provider ID or binary |
| media snapshot | `creator_media_snapshot` | Append-only normalized media metrics |
| comment sample | `creator_comment_sample` | Aggregate-only comment intelligence; no raw text |
| analysis | `creator_analysis` | Append-only derived time-window artifact |
| score | `creator_score` | Append-only deterministic score envelope |
| score component | `creator_score_component` | Append-only explainable score component |
| campaign | `campaign` | Versioned structured criteria, not a dispatch record |
| campaign fit | `campaign_creator_fit` | Append-only creator/campaign projection |
| collector run | `collector_run` | Idempotent collection execution metadata |
| collector evidence | `collector_evidence` | Append-only provenance and gap evidence |

The schema contains no provider credential, session, cookie, direct contact
field, raw profile payload, raw media, caption, or raw comment text. Provider
names are deliberately slug-shaped rather than an Instagram-only enum, so a
future TikTok or YouTube adapter does not require a table redesign. The current
provider contract still controls which providers may be used by the runtime.

## Invariants

- Every collected artifact carries provider, evidence state, observed time,
  retrieved time, source reference, retention policy version, and an evidence
  key. M3 snapshot rows additionally retain explicit coverage and freshness
  metadata. `timestamptz` is used everywhere and the migration session is UTC.
- `observed` is provider evidence; `derived` is deterministic computation;
  `inferred` requires a model version and evidence references; `unavailable`
  stores null values and is never treated as zero.
- Historical evidence, snapshots, analyses, scores, score components, and fits
  have an idempotent `ingest_key` and immutable triggers. A retry with the same
  key is a no-op; a new computation receives a new key and remains comparable.
- Derived records carry `algorithm_version`, coverage, confidence, providers,
  input fingerprint, and structured provenance. Scores are not based on raw
  follower count as a quality judgment.
- Comment intelligence is aggregate-only (`topic_key`, sentiment/safety
  labels, counts, ratios, and bounded metrics). Indirect growth signals must be
  labeled `inferred`; they cannot be stated as proof of fake followers.
- Current operational rows (`creator_identity`, `creator_media`, `campaign`,
  and `collector_run`) may change state under a later controlled repository
  operation. Their historical children cannot be updated or deleted.
- `collector_run` retains final coverage, freshness and failure count. Profile
  and media snapshots retain their own coverage/freshness metadata; unavailable
  rows retain null metrics and an explicit unavailable evidence state.

## Retention and cardinality policy

Retention is explicit in `retention_policy_version`; these are the v1 defaults
for a later runner and are not a claim that any live database has been changed:

| Artifact | Expected cardinality | Default retention |
| --- | --- | --- |
| creator / identity | 1 creator; up to 8 provider bindings | Current registry while governed; quarterly review |
| profile snapshot | At most 1 per creator/provider/collector run | 365 days |
| media / media snapshot | Bounded media selection; 1 snapshot per media/run | Identity current; metrics 90 days |
| comment sample | At most 5 aggregate samples per media/run | 90 days |
| collector run/evidence | 1 run per idempotency key; bounded evidence per response | 90 days |
| analysis | 1 per creator/window/algorithm/input fingerprint | 365 days |
| score/components | Up to 4 score kinds and 32 components per score input | 365 days |
| campaign/fit | 1 versioned campaign; at most 1 fit per creator/version/input | Campaign lifecycle plus 365 days |

The collector must enforce the bounded per-run limits before persistence. No
indefinite raw cache is permitted. Privacy deletion or tombstoning is a
separate reviewed operation; it must not silently rewrite historical evidence.

## Migration and access gates

This PR adds no database connection, seed row, grant, runtime registration, or
production apply. A future runner must:

1. prove the exact PostgreSQL database and migrator/owner roles;
2. take and retain a restore-verified checkpoint;
3. set lock and statement timeouts and serialize the migration;
4. apply the M1 registry, then the data model and snapshot metadata migrations
   in one controlled destination;
5. verify relations, constraints, indexes, append-only triggers, migration
   identity, and least-privilege runtime access;
6. record a rollback identity. Rollback is operationally fail-closed: disable
   collection and retain evidence rather than deleting historical rows.

The repository module uses parameterized SQL and an injected PostgreSQL
`query`/client boundary. It does not load `DATABASE_URL`, secrets, shell
commands, or provider transports. The module is ready for a later controlled
runner and remains inactive by default.
