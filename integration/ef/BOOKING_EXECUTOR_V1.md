# Private Website booking executor v1

This is an opt-in receiver in the existing EF integration, not a Selenium runtime
in Website. It reuses `BookingRequest`, `execute_booking`, verified unit selection,
and the existing `BOOKING_LOCK`. The legacy `/api/agenda/book` routes and their
authentication are unchanged. The new route defaults to **503 / disabled**.

## Contract

`POST /booking-executor/v1/dispatch` accepts UTF-8 JSON, at most 64 KiB, with exactly
`{contract: "booking-executor/v1", deliveryId, reservation}`. Query parameters,
chunked bodies, duplicated authentication headers, duplicate JSON keys, and extra
payload fields are rejected. There is no public polling/status endpoint for this
private ledger. All results contain only fixed codes and no patient information.

Reservation has exactly:

- `id`, `idempotencyKey`, `state: "provisional"`, `unitSlug`, `doctorSlug`,
  `doctorName`, `serviceId`, integer `startAtMs` and `endAtMs`;
- `patient: {name, whatsapp, cpf?}`: name 1–160 characters, WhatsApp optional `+`
  followed by 10–20 digits, CPF exactly 11 digits when present;
- `service: {name, candidates?}`: canonical selected-catalog name, up to 20
  canonical candidate strings (each at most 200 characters);
- optional `notes` (at most 2,000 characters; tabs/newlines permitted).

The sender resolves the service and professional from its canonical private
dispatch query. Do not add this enrichment to public reservation/status APIs.
Only the explicitly configured subset of `barrashoppingsul` / `novo-hamburgo` is
accepted; the receiver never substitutes a default unit or arbitrary service.

Headers are `x-skincos-booking-executor-{version,service,ts,nonce,signature}`.
Values are `v1`, `booking`, timestamp in milliseconds, a 16–128 character nonce
(`[A-Za-z0-9._-]`), and unpadded base64url HMAC-SHA256. Timestamp skew is at most
60 seconds. Signing exactly matches the Website client:

```text
digest = base64url(SHA256(UTF8(exact HTTP body)))
canonical = ["booking-executor/v1", ts, nonce, "POST",
             "/booking-executor/v1/dispatch", "booking", digest].join(".")
signature = base64url(HMAC-SHA256(UTF8(secret), UTF8(canonical)))
```

The HTTP receiver performs no browser work in the request thread. Successful
durable admission returns 202 with `{ok:true, contract, status:"pending",
retryAfterMs:1000}`. The Website binding bridge must preserve this response, use
a bounded transport deadline, and **repeat the same deliveryId/reservation with
a fresh signed nonce**. It must not POST to the legacy job endpoint on timeout.

An existing delivery is read back, never executed twice. Reused nonce or changed
reservation fingerprint for a delivery returns 409. Terminal readback returns
200 with `{ok:true, contract, outcome, providerReference:null, detail:{code}}`.
`confirmed` requires `BookingResult.verified_in_agenda == true`, which is set only
after EF agenda readback succeeds; dry runs and unverified `ok` cannot confirm.
Ambiguous errors return `manual_review`. The protocol reserves `failed` for a
future proven-no-side-effect failure; this implementation conservatively uses
manual review for all non-verified executor results.

## Durable custody and lifecycle

Enable only through a separately approved operational release with:

| Configuration | Requirement |
| --- | --- |
| `BOOKING_EXECUTOR_V1_ENABLED` | Exact `true`; otherwise disabled |
| `BOOKING_EXECUTOR_HMAC_KEY` | Internal secret, at least 32 characters, never in Git/logs/argv |
| `BOOKING_EXECUTOR_V1_UNITS` | Explicit comma-separated allowed unit slugs |
| `BOOKING_EXECUTOR_V1_LEDGER` | Absolute Linux path outside the repo, canonical parent owned by runtime uid and mode 0700 |

The ledger and its `.owner` lock must be regular, non-symlink, single-link files
owned by the runtime uid with mode 0600. SQLite full-synchronous transactions
persist only delivery ID, SHA-256 reservation fingerprint, status/timestamps,
and short-lived replay nonces. Payloads and provider responses are not persisted
in this ledger. The private execution context suppresses existing EF logs,
exception detail, HTML and screenshot diagnostics in that thread; unrelated
legacy work retains its existing behavior. The browser continues to use the
EF runtime's existing credential/profile custody; this PR does not provision,
inspect, copy, or change that custody.

One process owns the ledger for its lifetime. Up to 16 pending callbacks are
admitted, serialized with legacy EF work. Restart turns all accepted/running
records into terminal `manual_review`: the receiver cannot know whether a
previous browser request reached EF. No recovered row triggers another booking.
At 30 minutes pending, readback becomes `manual_review`; queued work rechecks its
age and state **after** acquiring the execution lock before making any EF call.
Graceful close stops admission and retains ownership until all callbacks exit.
Private callbacks are non-daemon threads, so orderly interpreter shutdown waits
for an active callback instead of terminating its browser operation mid-submit.
Forced process termination remains uncertain and is recovered as `manual_review`.

Only the private adapter opts into strict slot readback: a reopened event modal
must match the patient/service and expose the exact requested date, start and
end, plus one visible, fully matching selected professional in the injector
control. Missing/ambiguous professional controls, partial professional names,
missing date/time fields, whole-agenda text matches and readback exceptions
cannot produce a durable `confirmed`. Legacy callers keep their existing success
behavior, but do not set the new strict `verifiedInAgenda` flag.

Do not delete, truncate, restore an older copy of, or switch the ledger when
rolling back source: losing delivery history permits duplicate appointments.
Rollback is to disable the new route/stop its sender while retaining the ledger
and handling uncertain work manually. A fresh ledger is not a safe retry.

## Verification and operational boundary

Linux synthetic checks, with the repository's locked dependencies installed in
an isolated Linux environment:

```sh
cd integration/ef
python -B -m unittest -v test_booking_executor tests_test_booking test_auth_unit_selection
ruff check --no-cache espacofacial/booking_executor.py espacofacial/private_operation.py test_booking_executor.py
```

Tests cover the actual SQLite ledger and HTTP server, a Website JavaScript HMAC
test vector, concurrency, restart/uncertain work, replay, owner/permission gates,
shutdown, no private data in ledger/responses, disabled configuration, legacy
authentication, and the real EF request mapper with a mocked browser/executor.
No test logs into EF or submits an appointment. Separate live eligibility still
requires the private service-binding bridge, managed authentication/custody,
same-source runtime rollout, controlled end-to-end readback, and rollback
evidence. This source PR does not deploy or activate the receiver.
