# Livia 1dee runtime repin remediation record — 2026-07-29

## Policy status

This is a retrospective remediation record, not evidence of a compliant
pre-production authorization. The required release-specific record with the
pre-production timestamp, validation target/result, residual risk and explicit
proceed decision was not preserved before the publication at
`2026-07-29T12:30:17.527Z`. The promotion is therefore recorded as a policy
exception. It must not be used to authorize any later production change; every
future Livia publication or runtime promotion requires a contemporaneous record
that satisfies `docs/decisions/operational-change-policy.md` section 7.

- **Operator and source of scope:** `admin`, through the active SKINCOS/Codex
  task. The task authorized the Livia-only remediation, but its precise
  pre-production decision timestamp was not captured in a durable operational
  record.
- **Scope:** Livia workflow `WGXr4vYkv9UoJ8zc` only; replace the published
  verifier command with the direct entrypoint from immutable release
  `1dee4fc24d786d794cd73f30e442ceea329e8563`, produced by merged PR #853.
- **Authorized actions:** re-check active executions; preserve a complete
  rollback checkpoint; archive and verify the reviewed descendant; stage it
  with `--apply --stage-only`; validate the offline contracts; create a
  manifest; publish a version-checked historical repin; and perform read-only
  health, hash and retention checks.
- **Explicit exclusions:** `/opt/skincos/current/source`, unrelated workflows,
  credentials, Drive properties, social destinations and service restarts.
- **Risk controls:** source archive SHA-256
  `fc2bdf305e255773226cbc55a0e80c747f6004732f3b396d93cf26cd4e8f627a`,
  descendant lineage SHA-256
  `1dab559b9158ea6efd8e6dc87995e8fbda471ca24f054c9a98955ff1f9d5f5fb`,
  no-active-execution gate, transactional expected-version check, six
  entrypoint hashes, fail-closed retention guard and immutable rollback
  checkpoints.
- **Applied evidence:** workflow version
  `8316de5d-c047-473a-bd6a-662b513b73b5` published at
  `2026-07-29T12:30:17.527Z`; active-manifest SHA-256
  `3ca96e4038529680e019b35f13b5c306a57beaa4c71426a9a191a28621038a21`;
  checkpoint `livia-postpromote-1dee4fc2-20260729T093100-0300` SHA-256
  `a2a03f4223167bda6f6a4753b7b0073b7d014ca74100980d1cb99be1c996f5a9`.
- **Retrospectively preserved validation:** no-active-execution gate; offline
  direct/envelope, image, Reel, image-carousel, video-carousel, mixed-carousel,
  frame-selection and semantic-resume contracts with no gateway access;
  descendant lineage and archive verification; expected-version transactional
  publish; post-promotion `audit-live`, manifest hashes, retention guard and
  local/public health reads. Residual risk is that a real, unpublished source
  item still must complete the latest version before business acceptance.

The authorization does not authorize a synthetic or duplicate social
publication. A real unpublished Drive item is still required for the final
end-to-end acceptance journey.
