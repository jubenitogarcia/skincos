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

This is not yet evidence that the incident is operationally resolved: the
current instruction prohibits deploys, data mutations, flags and grants, so no
environment has been changed or exercised. The P0 freeze remains in effect
until an explicitly authorized controlled release and unit-scoped journey can
be evidenced.

Production, staging mutations, D1/PostgreSQL writes, flags, grants and deploys
are prohibited for this incident phase. The permitted next work is scoped PR
rebase/fix/test/CI remediation and read-only verification only.
