# Schedule public read: private production promotion

This source adds an opt-in production lane. Merge never activates it. The only
publishers remain `deploy-escala-api.yml` (core) and
`deploy-schedule-public-read-adapter.yml` (adapter plus its ephemeral verifier).
No Website, Booking, customer, appointment, message or SQL endpoint is exercised.

## Protected manifest and custody

The GitHub `production` environment supplies the private non-secret variable
`SCHEDULE_PUBLIC_READ_PRODUCTION_MANIFEST`. The dispatch input
`production_manifest_sha256` is SHA-256 of the **exact UTF-8 JSON bytes** in that
variable. The validator rejects extra keys, arbitrary resources, a different
account/source/config digest, and expired manifests or validity over 24 hours.
Create it for the final merged source SHA, outside Git. Its exact fields are:

| Field | Required value |
| --- | --- |
| contract | `schedule-public-read-production-manifest/v1` |
| sourceSha | Exact immutable main SHA promoted through staging |
| accountId | Verified Cloudflare account, equal to canonical custody |
| configDigest | Output of `node workforce/schedule/scripts/public-read-production-manifest.mjs config-digest` at that SHA |
| adapterWorker | `skincos-schedule-public-read` |
| coreWorker | `skincos-escala-api` |
| probeWorker | `skincos-schedule-public-read-probe-staging` |
| probeOrigin | `https://skincos-schedule-public-read-probe-staging.skincos.workers.dev` |
| probeLifetimeSeconds | `1800` |
| expiresAt | ISO UTC expiry within the next 24 hours, with at least 35 minutes remaining when a publication/recovery job starts |

Production also requires `ENABLE_SCHEDULE_PUBLIC_READ_PRODUCTION=true`, the
normal core deploy flag, active global coordination and the **production**
coordinator URL. There is no staging-coordinator fallback. Existing GitHub
Cloudflare custody is reused. Provision the internally generated names through
canonical secret custody, never into source, files or logs:

- `SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY`: core and adapter only.
- `SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY`: adapter and authorized Booking consumer;
  additionally the temporary verifier for this exact release.
- `SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY`: the temporary verifier and its caller.

All three are distinct from each other and from `ESCALA_ACTOR_HMAC_KEY`; use at
least 32 bytes of CSPRNG entropy. Production secrets must not silently reuse
staging keys. Values reach new Worker versions only via `--secrets-file
/dev/stdin` in memory. The adapter never publishes or provisions core custody.

## Exact dispatch order

1. Run the existing core/adapter previews and staging sequence at the selected
   SHA, including disabled adapter DO bootstrap and authenticated ready smoke.
2. Dispatch `deploy-escala-api.yml` on protected `main`, `target=production`,
   `release_sha=<SHA>`, `staging_run_id=<successful core staging opt-in run>`,
   `enable_schedule_public_read=true`, and `production_manifest_sha256=<digest>`.
   Before the existing production migration stage, the policy job validates the
   protected manifest and exact canonical staging opt-in artifact. The enabled
   core is uploaded/promoted under the normal core writer lease; it is never
   published by the adapter workflow. Authenticated readiness, the legacy core
   smoke, and exact active-version readback precede its production evidence.
3. Dispatch `deploy-schedule-public-read-adapter.yml`, `target=production`,
   `operation=bootstrap-disabled`, `release_sha=<SHA>`,
   `staging_run_id=<successful adapter staging run>`,
   `production_manifest_sha256=<digest>`. Do not supply `bootstrap_run_id`.
   This is the only production adapter operation that applies its DO lifecycle.
   It forces the adapter disabled and proves private 503 health/readiness.
4. Dispatch the same adapter workflow with `operation=deploy`, the same SHA,
   staging proof and manifest digest, `bootstrap_run_id=<step 3 successful run>`,
   and `core_production_run_id=<step 2 successful run>`. Predecessors must be
   completed successful canonical main dispatches, attempt 1, with matching
   source, target and lifecycle configuration. An uploaded version alone never
   satisfies these proofs. The adapter also rereads the live core deployment
   immediately before candidate upload and after its smoke, requiring the same
   predecessor SHA/run and enabled flag. A changed core fails the promotion;
   this is point-in-time verification, not a claim to own the core writer lease.

Every production mutation requires a fresh checked/fenced lease. Adapter and
probe share `deploy:schedule-public-read-adapter:production`; core retains
`global:crm-cloudflare-writer` on the production authority. A failed lease stops
the next mutation, including rollback or cleanup. Reruns after a possibly
mutating attempt are refused; create a new dispatch with explicit evidence.
The manifest is also revalidated in each mutating Wrangler step, before the
existing core migration, and by the fixed resource cleanup/reconciliation CLI.
Publication jobs are bounded; the initial window reserves time for fallback.

## Private verifier and cleanup

The production adapter retains `workers_dev=false`, `preview_urls=false`, no
public routes and no D1. Acceptance and durable disable proof also inventory
all account zones' Worker routes and account Worker custom domains, failing
closed on any adapter association, incomplete pagination or missing read
permission. The canonical token therefore needs read access to those inventories
in addition to the existing Worker deployment permissions; no route/domain is
removed automatically. Sanitized evidence retains only absence booleans and a
zone count. Its fixed-binding probe has workers.dev only while the
release runs. `GET /verify/ready` and `/verify/disabled` require the dedicated
HMAC service identity `schedule-production-verifier`; no other paths, methods,
queries, URLs or caller data are accepted. It calls only fixed adapter health
and readiness and returns boolean checks, never real availability or upstream
payloads. Ready mode proves authenticated readiness, invalid/absent HMAC 401,
and duplicate nonce 409. Calls and responses are bounded. The probe closes
itself after 30 minutes, even if the runner disappears.

The workflow requires the probe name to be absent before creation and records
its run ownership outside the checkout. `always` cleanup rechecks the production
lease and verifies the active probe version belongs to this exact SHA/run before
deletion; a pre-existing or replaced Worker is never overwritten/deleted.
Absence is read back from Cloudflare. A cleanup error fails the workflow, and
its protected ownership/checkpoint artifact identifies the precise residual
resource for reconciliation; self-expiry is not claimed as successful deletion.

If that runner is lost, wait for the probe's fixed 30-minute expiry, then dispatch
`target=production, operation=reconcile-probe` with the probe owner's exact
`release_sha`, a fresh protected manifest/digest, and
`probe_recovery_run_id=<previous failed/cancelled/timed-out run>`. No staging or
bootstrap artifact is needed for this cleanup-only path. Protected-main
ancestry, canonical previous workflow/attempt/final status, the exact active
probe version/owner/source/binding and its expired deadline are checked.
A new mandatory production lease fences deletion of only that fixed probe;
remote absence is recorded in `schedule-public-read-probe-recovery-evidence`.
A running, unexpired, replaced or foreign probe is never removed. Once absence
is proved, a new disabled dispatch can proceed.

## Rollback and acceptance

After a potentially mutating candidate promotion, failure or cancellation of smoke, active
version readback or core opt-in evidence triggers an explicitly disabled version
under the same checked lease while the runner survives. The fallback and its
readback explicitly cover cancellation. The production job-level conditions
also use `always()` with explicit successful prerequisite results, preserving
the runner for those cleanup steps; normal candidate steps still stop on
cancellation. A forcibly lost runner is not a
successful rollback and requires a new canonical disabled dispatch. No DO state or Schedule data
is deleted. Core default production dispatches keep public-read disabled and
prove the 503 projection. Production adapter `operation=disable` requires its
active source SHA and a fresh manifest, but not expired staging/bootstrap
artifacts. Every production bootstrap/candidate/disabled version persists the
source SHA and complete lifecycle-config digest as non-secret metadata. Before
disabled upload, the recovery path checks that durable metadata against the
exact 100% active version, existing nonce-guard DO namespace/class, private
subdomain and fixed core binding. A missing or changed proof fails closed;
it never treats a mere uploaded version as lifecycle bootstrap. This durable
rollback proof remains with the active Worker for its whole supported lifetime.

Acceptance requires successful runs plus the sanitized production resource
evidence: prior Worker versions, active deployment/version identity, correct
capability flag/binding, private adapter subdomain state, authenticated checks,
and probe cleanup readback. A failed/cancelled run or missing evidence is not
production acceptance. These files contain metadata only, not secrets, API
response dumps, patient data or SQL. Website cutover remains a separate gated
consumer promotion coordinated by its protected execution manifest.
