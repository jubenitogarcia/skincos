# SKINCOS Edge Adapters

Private, versioned adapter package for cross-repository Worker integrations.

The package contains the portable service-binding, signed domain-context and
resilience contracts. It deliberately excludes Worker configuration, routes,
bindings, migrations, credentials and product-owned runtime behavior.

Current public entrypoints:

- @jubenitogarcia/skincos-edge-adapters/cloudflare-service-binding
- @jubenitogarcia/skincos-edge-adapters/signed-domain-context
- @jubenitogarcia/skincos-edge-adapters/resilience

Publishing is intentionally separate from this bootstrap. The release plane
must bind a published version to its source repository, commit and artifact
digest, and GitHub Packages visibility must remain restricted.

No repository metadata is present intentionally. Publish only from the private
owning repository; do not associate this package with the public SKINCOS
monorepo.
