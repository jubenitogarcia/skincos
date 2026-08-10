# SKINCOS global coordinator

This Worker is the remote adapter for the versioned contract in
`ops/governance/global-concurrency-policy.json`. It uses one globally named,
SQLite-backed Durable Object coordination plane. Logical lock scopes remain
fenced independently, so unrelated modules proceed in parallel while the
authority can also arbitrate cross-scope conflicts such as `merge:main` versus
an active `release:<module>` lease.

The isolated `staging` and `production` environments are published only by
`.github/workflows/deploy-global-coordinator.yml`. The first production
bootstrap is allowed only when the workflow is dispatched from `main` with the
explicit bootstrap input, the deterministic production endpoint variable is
absent, and the exact production Worker existence probe returns “does not
exist”. Every later update requires the remote fenced lease
`global:global-coordinator-writer`; the workflow reads back the active version,
performs a signed read-only gate, and can restore the incumbent version when
post-deploy validation fails. It requires separately managed
`COORDINATION_SHARED_SECRET` and `COORDINATION_ADMIN_SECRET` bindings. Missing
custody returns HTTP 503; it never falls back to an in-memory or local lock.

Break-glass recovery is a separate, production-only path in
`.github/workflows/recover-global-coordinator.yml`. It can restore only an
exact `versionId` recorded in `recovery-incumbents.json`, after the normal
readiness probe proves a degraded (not healthy or ambiguous) plane. The
workflow then reads back modern readiness and advances `authorityEpoch` through
the separate `COORDINATION_RECOVERY_SECRET`; it does not acquire normal leases,
upload source, or accept a staging target. A successful normal production
deployment must add its exact version, source SHA/tree, closure digest and run
ID to the registry before that version is considered recovery eligible. The
registry validator rejects duplicate or malformed incumbents.

Clients must send the signed request envelope described by the contract and
must present the returned `leaseId`, `fencingToken`, owner and `intentDigest`
before every mutation. A release operation also carries its immutable source
SHA/tree, dependency-closure digest and exact artifact/version identities.
The `gate` action is read-only admission: it returns success only when the
candidate is compatible with all active leases. The merge authority acquires
`merge:main` and revalidates immediately before the GitHub merge, so a status
check can never substitute for ownership.

## Coordination-plane migration

The first deployment that changes from the historical per-`lockScope` Durable
Objects to the single `global` object must use
`COORDINATION_PLANE_MODE = "legacy-drain"`. In that mode new acquisitions,
admission checks and renewals fail closed; check, release and revoke requests
are routed to the old logical scope so active proofs can finish without being
silently discarded. After the maximum lease TTL has elapsed, deploy the same
code with `COORDINATION_PLANE_MODE = "global"`. A direct cutover is not safe:
it could strand an active legacy lease outside the new fencing domain.
