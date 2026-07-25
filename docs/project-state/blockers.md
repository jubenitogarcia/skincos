# Blockers

## P0 — Insumos unit access

PR #763 merged into main as `4a8b2074` after its Central E2E and required
checks passed. The P0 access incident is now stable in production: the explicit
Inventory/Core Worker run `30137182608` and corrected CRM Pages run
`30137826907` promoted `c64ff2b6655ce9e035a1b3a3840b1d6d809a9c2d`, and the
authenticated read-only smoke confirmed both canonical units without
`RBAC_UNIT_DENIED`, unexpected 401/403/500, or shell failure. No business data,
user, grant or flag was changed.

The P0 queue item can be marked resolved for orchestration purposes, with the
rollback checkpoints and sanitized evidence retained in the evidence ledger.
Do not infer that this unlocks Finance production activation: Finance staging
rollback/restore and its separate nominal gate remain required before any pilot.

Finance pilot activation remains separately blocked by current staging evidence
and named human approval; it is frozen independently of the resolved P0 item.
