# Current state

## P0 incident resolved in staging

`P0 — restaurar e estabilizar o acesso por unidade do módulo de Insumos` was
closed with controlled, synthetic staging evidence. This unfreezes the
orchestrator queue, but it does not authorize Finance, production, pilot,
GitHub Organization, Ponto, Atendimento, flags, grants, or other module work
without their own gates and instructions.

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
remains DNS-unresolved, so the immutable Pages deployment URL remains the
attested staging entry point. A pre-guard harness target-name defect was fixed
before the successful isolated run; a read-only review of historical production
audit residue remains required before making any retrospective claim about that
earlier attempt.
