# SKINCOS global coordinator

This Worker is the remote adapter for the versioned contract in
`ops/governance/global-concurrency-policy.json`. It routes each normalized
lock scope to a SQLite-backed Durable Object, so independent release modules
can proceed in parallel while deploy and Cloudflare mutations for the same
surface/environment share one fence.

The Worker is intentionally not provisioned or routed by this change. It
requires a separately managed `COORDINATION_SHARED_SECRET` and
`COORDINATION_ADMIN_SECRET`, protected environment bindings, an authenticated
route, and a rollback deployment before any real mutation is enabled. Missing
custody returns HTTP 503; it never falls back to an in-memory or local lock.

Clients must send the signed request envelope described by the contract and
must present the returned `leaseId`, `fencingToken`, owner and `intentDigest`
before every mutation. A release operation also carries its immutable source
SHA/tree, dependency-closure digest and exact artifact/version identities.
