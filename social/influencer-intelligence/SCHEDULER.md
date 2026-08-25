# Influencer Intelligence snapshot scheduler

The scheduler is a bounded external Orb orchestration contract, not a provider
or analytics runtime. The pure contract lives in [`scheduler.mjs`](./scheduler.mjs)
and the inactive n8n export is maintained in the [independent Orb repository](https://github.com/jubenitogarcia/orb).

## Safety boundary

- `INFLUENCER_INTELLIGENCE_ENABLED` is false by default. The checked-in
  workflow is `active: false` and starts in `shadow` mode.
- The SQL node selects only identities with an explicit `monitoring_enabled`
  opt-in, `identity_state = 'active'`, and observed identity evidence. The
  additive scheduler migration defaults the opt-in to false.
- Orb processes one creator at a time (`splitInBatches` batch size 1). The
  internal service owns the provider router, Token Vault access, snapshot
  transaction, collector-run persistence, and service-side lease.
- The workflow posts only to the internal snapshot service. It has no provider
  URL, credential field, Instagram write operation, scraping node, score, or
  analytics formula.
- A transient timeout, rate limit, upstream 5xx, or transient network failure
  may be retried at most twice with the same idempotency key. Not-found,
  private, authorization, policy, validation, and unknown failures are not
  retried by this contract.
- The receipt contains status, coverage, freshness, failure count, and
  idempotency metadata only. Missing coverage remains `null`/`unavailable`; it
  is not changed to zero.

## Configuration

The versioned default is a six-hour interval, one-at-a-time processing, a
maximum of 25 creators per run, 20 media items per creator, a 30-second service
timeout, and two total attempts. The workflow remains inactive until the
service route, migration, flag, grant, lease, and staging evidence are
independently proven.

The service route is an internal mutation boundary for historical collection.
The runtime registration supplies a loopback binding, but it remains disabled
and accepts only the Orb caller, private service token, fixed grant, and
shadow contract:

`POST /internal/influencer-intelligence/v1/snapshots`

It accepts only the bounded snapshot operation contract and must enforce the
server-side flag/grant, internal authentication, provider selection, timeout,
lease, idempotency, and redacted structured audit. Orb does not receive or
forward provider credentials. The workflow includes a deterministic
creator/time-bucket idempotency key for each operation so a bounded retry does
not create a second historical observation.

## Operational status

The source workflow is still `active: false` and is not imported. Registration
does not assign the grant, deploy Token Vault, enable the flag, or collect real
creator data. See [`RUNTIME.md`](./RUNTIME.md) for installation and rollback.
