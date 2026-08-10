# SKINCOS global coordinator

This Worker is the remote adapter for the versioned contract in
`ops/governance/global-concurrency-policy.json`. It uses one globally named,
SQLite-backed Durable Object coordination plane. Logical lock scopes remain
fenced independently, so unrelated modules proceed in parallel while the
authority can also arbitrate cross-scope conflicts such as `merge:main` versus
an active `release:<module>` lease.

The production Worker is intentionally not routed by this change. The isolated
`staging` environment is the activation target for synthetic contract tests;
production remains disabled until the same version, custody, route, rollback,
and live readback gates are recorded. It requires separately managed
`COORDINATION_SHARED_SECRET` and `COORDINATION_ADMIN_SECRET` bindings. Missing
custody returns HTTP 503; it never falls back to an in-memory or local lock.

Clients must send the signed request envelope described by the contract and
must present the returned `leaseId`, `fencingToken`, owner and `intentDigest`
before every mutation. A release operation also carries its immutable source
SHA/tree, dependency-closure digest and exact artifact/version identities.
The `gate` action is read-only admission: it returns success only when the
candidate is compatible with all active leases. The merge authority acquires
`merge:main` and revalidates immediately before the GitHub merge, so a status
check can never substitute for ownership.
