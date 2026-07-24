# Current state

## P0 incident — staging evidence stale

`P0 — restaurar e estabilizar o acesso por unidade do módulo de Insumos` is
blocked again as `staging evidence stale`. The historical synthetic journey
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
synthetic, removable identity journey. Canonical preview and staging workflows
promoted immutable main SHA `f276919ce6a63b337bd02bd0c3799dbf38f13b97` for
Inventory (runs `30125747962` / `30125805545`) and CRM Pages (runs
`30125749745` / `30125807334`). The Inventory staging health endpoint and the
immutable Pages URL are reachable. The Pages custom alias
`crm-staging.skincos.com.br` is not currently resolvable, so the journey must
use the attested immutable Pages deployment URL.

The authenticated unit-scope journey completed in workflow run `30129792473`
at `2026-07-24T22:06:03Z`, using only synthetic, removable staging identities
and the immutable Pages URL. It passed authorized Novo Hamburgo,
BarraShoppingSul, both-unit switching, no-unit denial with no data requests,
ADMIN override, recognized legacy alias, and explicit cross-unit denial with
`RBAC_UNIT_DENIED`. Inventory and Pages health were both `200`; the fixture
teardown completed. Follow-up PRs #771–#778 made the harness staging-targeted,
fail-closed when no authorized unit exists, and excluded the authenticated
preferences control route from data-request diagnostics.

No production deploy occurred. The custom alias `crm-staging.skincos.com.br`
remains DNS-unresolved. A pre-guard harness target-name defect was fixed before
the successful isolated run, but the complete artifact lineage is not valid for
production because #776 was absent. The prior result remains historical evidence
only; a new candidate from current `main` must be promoted and re-tested.

## Lineage reconciliation — 2026-07-24

Current `origin/main` is `b8c356baf90b33cef834417cb75ddd172a0b0a9a`. PRs #763 and
#771–#779 are merged, but the four preview/staging artifacts and journey all
reference `f276919ce6a63b337bd02bd0c3799dbf38f13b97` (merge #770). The functional
change from #776 is the `InsumosModule` fail-closed gate requiring an authenticated
actor with an authorized unit; that expression is absent from `f276…` and present
only after merge `7ba0c11d8a98ff87262b13e268892191120c8544`. A new current-main
candidate is therefore required before any production consideration.
