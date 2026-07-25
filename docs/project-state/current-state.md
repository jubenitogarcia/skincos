# Current state

## P0 production gate — blocked by missing segregated secret (2026-07-24)

The explicit production promotion of the validated `cb04cb8b8ca87353c4c672fa5707bf2d5a9fcecb`
candidate was attempted only through the canonical Inventory/Core Worker workflow
`30133378752`, with staging predecessor `30131598506`. The immutable promotion gate
passed ancestry and predecessor evidence, and the remote migration step reported
`No migrations to apply`. The deploy then stopped before publishing because the
production environment lacks `IDENTITY_PII_KEY`; no Worker version, flag, grant,
user or production data changed.

The production rollback checkpoint remains intact: Inventory Worker deployment
`f0037d0a-bc21-4a26-8a8b-59a010c85ba6` / version
`6104273d-a14c-4a84-8bb1-889a681969dc` (version 5132), and CRM Pages deployment
`0b8657b8-d162-4c0e-8a4a-e542255ec1a4` / commit `fdf8cda8ab1df4e41a06897231fad3e9d41042a0`.
Post-failure Insumos health remained HTTP 200. CRM Pages was intentionally not
started, so there is no partial promotion to reconcile. The only next production
action is an authorized operator provisioning the segregated production secret,
followed by a fresh preflight; Finance and unrelated modules remain frozen.

## P0 incident — current staging evidence validated

`P0 — restaurar e estabilizar o acesso por unidade do módulo de Insumos` remains
operationally open for the production identity/release gates, but current
staging evidence is now valid. The historical synthetic journey
was real, but its artifact was built from `f276919ce6a63b337bd02bd0c3799dbf38f13b97`,
which predates functional PR #776. It cannot be used as production evidence.
Finance, production, pilot, GitHub Organization, Ponto, Atendimento, flags,
grants and unrelated module work remain frozen.

PR #763 (`fix(insumos): corrige RBAC por unidade`) merged into main as
`4a8b2074`. It was rebased on the P0 freeze, and its Central E2E Smoke (run
`30124027315`) plus all required checks passed. The repaired scenarios prove
authorized unit access, no-unit request suppression, circuit-breaker behavior
and edit policy only in CI.

The current authorization permits a controlled staging-only release and a
synthetic, removable identity journey. Candidate run `30131393262` archived
immutable main SHA `cb04cb8b8ca87353c4c672fa5707bf2d5a9fcecb`, source tree
`c9ca5f4826d418b2e3b033107185135831437ffd`, and source archive SHA-256
`5284a1554c24c799453404a66cfdd8194cfce021cecb3e184d8969b40ebf83e9`.
Canonical preview and staging workflows promoted this same SHA for Inventory
(preview `30131564731`, staging `30131598506`) and CRM Pages (preview
`30131566250`, staging `30131599897`). The immutable Pages URL is
`https://af0d1d23.skincos-staging.pages.dev`. The Pages custom alias
`crm-staging.skincos.com.br` is not currently resolvable, so the journey must
use the attested immutable Pages deployment URL.

The current authenticated unit-scope journey completed in workflow run
`30131682451` at `2026-07-24T22:43:24Z`, using the same SHA and only synthetic,
removable staging identities. It passed six scenarios: authorized Novo
Hamburgo, BarraShoppingSul, both-unit switching, empty-scope denial, ADMIN
override and recognized legacy alias. It loaded Insumos, movimentações,
overview and insights, and fixture teardown completed. The prior journey
`30129792473` remains historical evidence for `f276…`.

The historical authenticated unit-scope journey completed in workflow run `30129792473`
at `2026-07-24T22:06:03Z`, using only synthetic, removable staging identities
and the immutable Pages URL. It passed authorized Novo Hamburgo,
BarraShoppingSul, both-unit switching, no-unit denial with no data requests,
ADMIN override, recognized legacy alias, and explicit cross-unit denial with
`RBAC_UNIT_DENIED`. Inventory and Pages health were both `200`; the fixture
teardown completed. Follow-up PRs #771–#778 made the harness staging-targeted,
fail-closed when no authorized unit exists, and excluded the authenticated
preferences control route from data-request diagnostics.

No production deploy occurred, and no production user, flag, grant or data was
changed. The real CRM actor still requires read-only correlation before any
production consideration.

## Current CRM actor correlation — 2026-07-24

The live authenticated CRM session returned `/api/auth/me` with HTTP 200 and a
`GESTOR` actor. A read-only query against production D1 `skincos-db` matched
exactly one active `crm_users` row. The row has the two canonical units
`novo-hamburgo` and `barra-shopping-sul`, the five existing modules
`ponto`, `atendimento`, `conversa`, `finance` and `insumos`, and
`session_version=0`. No username, email, IP or credential is stored here; the
sanitized private evidence is kept outside the repository.

The active non-ADMIN empty-unit query returned zero rows, so the authenticated
actor is not among the affected empty-scope set. Administrative history shows
one scope configuration at `2026-07-24T18:02:25Z`; role and session version were
preserved while the two units and existing modules were recorded. D1 reported
zero changes and zero rows written. This is an identification result only:
there is no repair SQL, grant change or production mutation to roll back.

## Lineage reconciliation — 2026-07-24

The pre-candidate `origin/main` was `b8c356baf90b33cef834417cb75ddd172a0b0a9a`.
The candidate `cb04cb8b8ca87353c4c672fa5707bf2d5a9fcecb` is now an ancestor of
the current `origin/main` `4339df47f2797be78928d1da0a5124635c3ef976`; PRs #763
and #771–#784 are merged. The historical four preview/staging artifacts and journey all
reference `f276919ce6a63b337bd02bd0c3799dbf38f13b97` (merge #770). The functional
change from #776 is the `InsumosModule` fail-closed gate requiring an authenticated
actor with an authorized unit; that expression is absent from `f276…` and present
only after merge `7ba0c11d8a98ff87262b13e268892191120c8544`. The new current-main
candidate and staging cycle above include that change; historical evidence is
preserved but is not used for production.
