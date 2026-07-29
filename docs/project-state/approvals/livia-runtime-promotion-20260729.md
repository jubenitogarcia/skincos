# Livia runtime promotion authorization record — 2026-07-29

- **Operator:** `admin`, through the active SKINCOS/Codex task.
- **Scope:** workflow `WGXr4vYkv9UoJ8zc` only; publish a historical workflow
  version pinned to immutable release
  `f6b8698a450ee2b346ccc93989a365c3455c792d`.
- **Authorized actions:** checkpoint, `--stage-only` source preparation,
  manifest creation, version-checked workflow publication, read-only health
  probes and audit. The global `/opt/skincos/current/source` link, unrelated
  workflows, credentials, schedules, Drive and social destinations were out of
  scope.
- **Risk controls accepted:** checksum-verified archive
  `608f1475d8610b508e209b8a05181fba52c463d4039f36617f1f97ec6dd5b178`,
  lineage SHA-256
  `d0bab6ef92421bc1df0de15e0792b60b7ac7a370c1a8c65d0d55f08e151ce750`,
  transactional publication, fail-closed manifest hashes, no restart during an
  active Livia execution, and rollback checkpoint.
- **Applied evidence:** active workflow version
  `9f7beced-c075-46d1-be78-0e26968e135e` at
  `2026-07-29T14:23:15Z`; manifest SHA-256
  `4a4fb1d4173021404458eef9b868001fa5cfc33bc21c642d9939f8c2473cfb05`.

This record does not claim a staging journey occurred. It records the bounded
production authorization actually used and leaves the real active-version
publication journey as a separate acceptance gate.
