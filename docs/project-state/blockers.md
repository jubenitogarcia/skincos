# Blockers

## P0 — Insumos unit access

PR #763 merged into main as `4a8b2074` after its Central E2E and required
checks passed. The incident remains operationally open because the current
authorization prohibits deploys and therefore does not evidence unit-scoped
access in an environment. The orchestrator must not execute Finance staging or
pilot work, GitHub Organization transfer, Ponto, Atendimento, or other module
milestones until that P0 evidence exists. Production and data changes remain
explicitly out of scope.

Finance pilot activation remains separately blocked by current staging evidence
and named human approval; it is frozen under the P0 incident.
