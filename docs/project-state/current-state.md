# Current state

## Active operational incident — P0

`P0 — restaurar e estabilizar o acesso por unidade do módulo de Insumos` is
the only executable orchestrator item. Finance pilot/staging progression,
GitHub Organization transfer, Ponto, Atendimento and every unrelated module
milestone are frozen until this incident is resolved.

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

This is still not evidence that the incident is operationally resolved. The
remaining P0 gate is the authenticated unit-scope journey: authorized Novo
Hamburgo, BarraShoppingSul, both units, no-unit denial, ADMIN override,
recognized legacy alias and explicit cross-unit denial. Production, production
identities, flags, grants and production data remain prohibited.
