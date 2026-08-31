# `schedule-public-read/v1`

This is the private, read-only compatibility boundary for the future
`skincos-workforce-schedule` repository. It remains pre-cut: there is no
production route, Website cutover, or deployed consumer in this source change.
The staging adapter configuration has an isolated Worker name and a
per-nonce Durable Object guard, but it is disabled by default. It remains
unusable until the canonical Schedule staging workflow records its explicit
core opt-in for the same immutable SHA and the adapter workflow passes its own
separate staging gates.

## Contract

The adapter exposes only `GET` requests across two distinct HMAC capabilities:

- `SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY` authenticates Website to the adapter
  with the `website-booking` service identity. It belongs only to Website and
  the adapter.
- `SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY` authenticates the adapter to Schedule
  core with the `schedule-public-read-adapter` service identity. It belongs
  only to the adapter and Schedule core.

The adapter fails closed unless both normalized key values are present and
different. The Website edge key therefore cannot authenticate a direct request
to the core, even while its existing hostname remains part of the legacy
deployment.

The exposed paths are:

- `GET /health` checks that the adapter is explicitly enabled and fully bound.
- `GET /schedule-public-read/v1/readiness` checks the Schedule core's D1 read.
- `GET /schedule-public-read/v1/availability?unit=<unit>&date=YYYY-MM-DD`
  returns a closed flag and display names scheduled for that day.
- `GET /schedule-public-read/v1/professionals?unit=<unit>` returns the public
  professional profile fields used by Website. Phone and email are never in this
  contract.

Every versioned request carries `x-skincos-schedule-read-*` headers. Its HMAC
binds the version, timestamp, nonce, `GET` method, exact path/query and fixed
service name. Signing and verification trim the configured key consistently.
This boundary is deliberately independent from `ESCALA_ACTOR_HMAC_KEY`, which
remains the CRM/Ponto writer-and-management credential.

After HMAC validation, the adapter sends the nonce to a dedicated Durable
Object selected deterministically by that nonce. Durable Object serialization
accepts it once, retains it only for the five-minute authentication window and
returns `409 SCHEDULE_PUBLIC_READ_REPLAYED` on another use. Guard failure is
`503`; it never turns into a read-through bypass.

## Staged cut prerequisites

The current Website still reads `SKINCOS_ESCALA_DB` directly and its booking
routes keep their existing behavior. Before a future consumer migration:

1. Provision two different normalized values: the edge key to Website and
   adapter only, and the core key to adapter and Schedule core only. The core
   key must be synchronized only by the canonical Schedule staging publisher,
   which emits same-SHA `schedule-public-read-core-opt-in-evidence`; the
   adapter never publishes or mutates the core. The staging Worker owns a
   per-nonce Durable Object guard; do not replace it with eventually consistent
   storage.
2. Compare direct-D1 and adapter responses for synthetic availability and
   profiles, then prove readiness and rollback.
3. Decide the customer-facing behavior when Schedule is unavailable: preserve
   the current fallback or return a booking-unavailable response. This contract
   does not make that product decision.
