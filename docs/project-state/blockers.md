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

## Finance staging gate — current status

The current-main SHA `8af1d5fe9551891a05a104363043bf3d36fb4ef4` has a successful
candidate (`30139535704`), preview (`30139561027`) and staging deployment
(`30139576133`) with Worker version
`97c7a7da-6a78-44a8-b980-2cc2810df7a0`. A controlled rollback (`30139701809`)
restored immutable SHA `67ee53843a9a52ad495ab6d67b8cd2b4fac053f9` using Worker
version `c57fdafc-6045-4eb5-8b38-07ae98d7c256`; health stayed ready and no
migrations or unrelated modules were touched. The synthetic canary abort drill
(`30139247054`) also proved the remote kill switch and baseline restoration.

These staging gates are now evidenced, but they do not unlock the pilot. The
remaining blockers are authenticated import/UI smoke, an external monitor with
human alert evidence, encrypted offsite backup plus restore for the
current-main artifact, and named approval. `module_enabled` remains false and
no real user or unit is enabled.
