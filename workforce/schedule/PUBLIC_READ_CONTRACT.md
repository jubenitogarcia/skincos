# `schedule-public-read/v1`

This is the private, read-only compatibility boundary for the future
`skincos-workforce-schedule` repository. It is source-only in this change:
there is no route, deployment, hostname, D1 migration, secret provisioning or
Website cutover.

## Contract

The adapter exposes only `GET` requests, authenticated with a distinct
`SCHEDULE_PUBLIC_READ_HMAC_KEY` and the `website-booking` service identity:

- `GET /health` checks that the adapter is explicitly enabled and fully bound.
- `GET /schedule-public-read/v1/readiness` checks the Schedule core's D1 read.
- `GET /schedule-public-read/v1/availability?unit=<unit>&date=YYYY-MM-DD`
  returns a closed flag and display names scheduled for that day.
- `GET /schedule-public-read/v1/professionals?unit=<unit>` returns the public
  professional profile fields used by Website. Phone and email are never in this
  contract.

Every versioned request carries `x-skincos-schedule-read-*` headers. Its HMAC
binds the version, timestamp, nonce, `GET` method, exact path/query and fixed
service name. It is deliberately independent from `ESCALA_ACTOR_HMAC_KEY`,
which remains the CRM/Ponto writer-and-management credential.

## Staged cut prerequisites

The current Website still reads `SKINCOS_ESCALA_DB` directly and its booking
routes keep their existing behavior. Before a future consumer migration:

1. Create isolated staging resources and provision the new key to the adapter,
   Schedule core and Website only.
2. Compare direct-D1 and adapter responses for synthetic availability and
   profiles, then prove readiness and rollback.
3. Decide the customer-facing behavior when Schedule is unavailable: preserve
   the current fallback or return a booking-unavailable response. This contract
   does not make that product decision.
