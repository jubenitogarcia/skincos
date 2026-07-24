# Blockers

## P0 — Insumos unit access

Until PR #763 is rebased, its three Central E2E failures are corrected and the
required checks are green, the orchestrator must not execute Finance staging or
pilot work, GitHub Organization transfer, Ponto, Atendimento, or other module
milestones. Production, data changes and deploys are explicitly out of scope.

Finance pilot activation remains separately blocked by current staging evidence
and named human approval; it is frozen under the P0 incident.
