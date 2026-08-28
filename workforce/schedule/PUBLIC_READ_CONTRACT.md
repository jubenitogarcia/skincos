# `schedule-public-read/v1`

This is the private, read-only compatibility boundary for the future
`skincos-workforce-schedule` repository. It is source-only in this change:
there is no route, deployment, hostname, D1 migration, secret provisioning or
Website cutover.

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

Nonce format and timestamp skew are verified today, but this source-only stage
does not retain consumed nonces. A valid signed request can therefore still be
replayed inside the permitted skew window. Replay protection is an explicit
cutover prerequisite; no replay store or binding is introduced by this change.

## Staged cut prerequisites

The current Website still reads `SKINCOS_ESCALA_DB` directly and its booking
routes keep their existing behavior. Before a future consumer migration:

1. Create isolated staging resources and provision two different normalized
   values: the edge key to Website and adapter only, and the core key to
   adapter and Schedule core only.
2. Select, provision and test bounded nonce replay protection before enabling
   either capability, route or consumer cutover.
3. Compare direct-D1 and adapter responses for synthetic availability and
   profiles, then prove readiness and rollback.
4. Decide the customer-facing behavior when Schedule is unavailable: preserve
   the current fallback or return a booking-unavailable response. This contract
   does not make that product decision.
