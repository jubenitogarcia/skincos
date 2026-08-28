# SKINCOS Contracts

Private, versioned contract package for independent SKINCOS domain repositories.

The public entrypoints intentionally contain only portable, dependency-free
contracts. They do not import from the SKINCOS monorepo at runtime.

Current public entrypoints:

- @jubenitogarcia/skincos-contracts/identity
- @jubenitogarcia/skincos-contracts/finance
- @jubenitogarcia/skincos-contracts/finance/csv
- @jubenitogarcia/skincos-contracts/finance/moneywiz
- @jubenitogarcia/skincos-contracts/finance/ef-caixa
- @jubenitogarcia/skincos-contracts/module-availability
- @jubenitogarcia/skincos-contracts/observability

Publishing is intentionally separate from this bootstrap. Before a consumer
depends on a released version, the release plane must attest the package
version, artifact digest, source repository and source commit, and GitHub
Packages visibility must remain restricted.

No repository metadata is present intentionally. These packages must first be
published from their private owning repositories and must never be associated
with the public SKINCOS monorepo.
