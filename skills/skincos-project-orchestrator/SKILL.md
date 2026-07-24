---
name: skincos-project-orchestrator
description: Autonomously resume and execute the next safe SKINCOS milestone. Use for retomar, continuar, revisar, auditar, handoffs, PR/CI/deploy follow-up, planning versus staging, “retome o SKINCOS”, “continue o projeto”, “prossiga do ponto atual”, “execute o próximo passo”, or “use o orquestrador”. Default to resume-execute; use read-only status only when explicitly requested.
---

# SKINCOS Project Orchestrator

Default mode is `resume-execute`: reconstruct state, choose one eligible priority milestone, execute, test, publish, follow CI to terminal state, merge when permitted, verify the target environment, and persist evidence. An audit is phase one, never the result when safe work remains.

## Modes

- No mode or resume wording: `resume-execute`.
- `status`, `somente audite`, `somente analise`: read-only.
- `plan`: rebuild/reorder queue only.
- `execute:<milestone-id>`: execute that item.

Read `references/execution-loop.md`, `references/authorization-boundaries.md`, and `references/evidence-model.md`.

## Loop

1. Read `AGENTS.md`, `CODEX_CONTEXT.md`, `TASKS.md`, `DECISIONS.md`, `ops/project-orchestration/work-queue.json`, and ledgers. Fetch remote refs and inspect Git, worktrees, PR/CI, relevant deployments/runtime/D1/PostgreSQL.
2. Run `scripts/collect-state.sh` or `.ps1`. If unavailable/failing, collect directly and repair the collector when safe; never depend on one collector.
3. Classify local, branch, PR, main, preview, staging, production, or unproven. A 200 is not a journey; worktree is not main; merged PR is not staging; staging is not production.
4. Select highest-priority eligible item (Finance gates first unless current evidence proves another prerequisite comes first). Define objective, scope, deliverables, allowed/prohibited actions, tests, evidence and done definition.
5. Execute continuously: scoped fixes, tests, commit, push, small PR, terminal CI, fix introduced failures, and merge only when green/review-free/non-production. Do not stop after plan, commit, PR, running check, timeout, or first CI failure.
6. Verify environment, update queue and `docs/project-state/{current-state.md,evidence-ledger.json,blockers.md}`. After compaction, reread and continue.

## Authorization

`resume-execute` authorizes worktrees, branches, code/config/tests/docs, declared dependencies, commits, push/PR/merge, scratch resources, and reversible synthetic staging deploy/rollback/restore/canary/failure tests. It never authorizes production deploy/migration/data mutation/activation/secrets, purchases, repo transfer, business permissions, or real-user pilot. Preserve unrelated dirty work and keep PRs single-purpose.
