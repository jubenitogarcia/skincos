# SKINCOS Delivery Contract

Private, portable release-identity contract for independent SKINCOS repositories.

It provides deterministic canonical JSON plus promotion-evidence schema-v4
helpers. The embedded release identity uses its own schema version 2 and binds
a candidate to its source repository, commit/ref/tree, contract-manifest and
dependency-closure digests, contract package versions, and released artifact
digests.

Evidence and predecessor repository, run and artifact metadata remain outside
the release identity. The evidence artifact is created after the evidence file
is written, so including its later identifier or digest in the identity would
be circular.

The contract is intentionally runtime-neutral: it has no GitHub CLI, filesystem,
workflow, repository checkout or deployment dependency. A promotion gate can
depend on this package instead of copying the identity algorithm.

Publishing is intentionally separate from this bootstrap. Before a consumer
depends on a released version, GitHub Packages visibility must remain restricted
and the release plane must bind the package version to its artifact digest.

No repository metadata is present intentionally. Publish only from the private
owning repository; do not associate this package with the public SKINCOS
monorepo.
