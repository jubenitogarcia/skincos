# Booking

Booking owns patient availability, reservation requests and the durable
reservation lifecycle. It is intentionally separate from `integration/ef`,
which owns only external browser/session execution, and from `website`, which
owns the public experience.

The first migration artifact is the D1 ledger and outbox contract in
`migrations/0001_booking_ledger.sql`. It is additive and is not applied to a
remote database by this source-only wave. A gateway route is enabled only after
the binding, status-token contract and Orb dispatch identity are proven in
staging.

## Lifecycle

`provisional` is returned after the request and outbox event are atomically
stored. Orb dispatches to the serialized EF executor, and only that result can
advance a request to `confirmed`, `failed` or `manual_review`.

The unique idempotency key is the duplicate-submission guard. The outbox lease
is the retry/recovery source; a browser process and a best-effort webhook are
not durable sources of truth.
