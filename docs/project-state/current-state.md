# Current project state

## Snapshot — 2026-07-24T19:20Z

This is a read-only reconciliation. `TASKS.md` and `DECISIONS.md` remain the
authoritative sources for objectives and decisions.

| Surface | Observed state | Level of proof |
| --- | --- | --- |
| Remote main | `origin/main` is `2bd789ec`, including Website audit remediation (#766), Atendimento schema fix (#765), and the Finance immutable rollback gate (#761). | integrated on GitHub main |
| Local shared checkout | `codex/admin/content-studio-v2` at `598bc3d5` is dirty with Content Studio and skill-installation work. It is not an integration source and was preserved. | local-only |
| Worktree topology | 69 registered worktrees exist. A worktree, local commit or untracked file is not deployment evidence. | local-only |
| Project-state records | The records found in the shared checkout were untracked and absent from `origin/main`; this branch is the first versioned baseline. | local-only before this PR; pending integration |
| GitHub integration | PR #761 passed every listed check after its final rebase and was squash-merged. PR #763 remains draft and blocked by three unrelated Insumos E2E failures. | GitHub Actions and merge evidence |
| Security gate | Website remediation #766 was merged as `7b1443e3`; its Dependency Audit passed. The same check passes on the current #761 run. | integrated main plus GitHub Actions evidence |
| External HTTP | `espacofacial.com`, CRM and CRM health returned HTTP 200; the unauthenticated custom-URL route returned expected HTTP 401. | endpoint availability, not authenticated journey validation |
| Finance staging | The independent Finance Worker responds healthy and ready from `fdf8cda8`, with healthy D1 and `module_enabled=false`. One staging-only grant exists, but no canary actor/unit/percentage is active. | deployed staging endpoint and narrowly scoped D1 evidence; no authenticated journey or restore proof |

## Current integration focus

The immutable Finance rollback gate is integrated. The current staging Worker
is intentionally behind main, so its health does not attest the new gate. The
next critical evidence is the staging-only immutable promotion and rollback
rehearsal for the same SHA.

## Next safe action

Promote one immutable main SHA only to staging through the canonical Finance
pipelines, run the synthetic canary and execute a rollback to the prior
staging-attested artifact. The rehearsal must retain or restore
`module_enabled=false`; it must not change production, pilot grants or human
cohorts.

## Orchestrator gap

The skill references `scripts/collect-readonly-state.sh`, but that file is not
present in the current checkout or `origin/main`. Until it is restored or the
skill reference is updated, run `npm run codex:context:online` plus the explicit
read-only source checks recorded in the evidence ledger.
