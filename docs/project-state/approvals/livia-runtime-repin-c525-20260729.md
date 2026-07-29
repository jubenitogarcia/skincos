# Livia c525 runtime repin authorization record — 2026-07-29

- **Operator:** `admin`, through the active SKINCOS/Codex task.
- **Scope:** Livia workflow `WGXr4vYkv9UoJ8zc` only; pin a new historical
  workflow version to the immutable release
  `c525f5e1d68829fe4c93197f65d85429a2e0385c`, produced by merged PR #851.
- **Authorized actions:** re-check for active executions; create a full
  rollback checkpoint; archive and verify the reviewed descendant; stage it
  with `--apply --stage-only`; run offline contract checks; create the
  manifest; publish a version-checked historical repin; and perform read-only
  health/audit checks.
- **Explicit exclusions:** `/opt/skincos/current/source`, unrelated workflows,
  credentials, Drive properties, social destinations and service restarts.
- **Risk controls:** source archive SHA-256
  `b60f2001de4768700f6863af527e3755bfdb7d3646afa52956725071f7d1435e`,
  descendant lineage SHA-256
  `9ce37392fd63afd687b0d8a0ab7b0bf7c6759e18085ae582228f922463aa7237`,
  no-active-execution gate, transactional expected-version check, six
  entrypoint hashes, fail-closed retention guard and immutable rollback
  checkpoint.
- **Applied evidence:** workflow version
  `a1983ff1-4b58-4753-860e-c25dda057f3f` published at
  `2026-07-29T11:53:04.953Z`; active-manifest SHA-256
  `a7ced345b16a3538fac5f7dc24135332ac2c2de81bf810744e51352c2989730f`;
  checkpoint `livia-postpromote-c525f5e1-20260729T085430-0300` index SHA-256
  `e4eabf9e76bb96c30794a231102466a685d8ce971208dee432fb4b959ac4d60d`.

The authorization does not authorize a synthetic or duplicate social
publication. A real unpublished Drive item is still required for the final
end-to-end acceptance journey.
