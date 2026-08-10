---
name: skincos-project-orchestrator
description: Autonomously resume and execute the next safe SKINCOS milestone, including supervised automatic continuation. Use for retomar, continuar, revisar, auditar, handoffs, PR/CI/deploy follow-up, planning versus staging, “retome o SKINCOS”, “continue o projeto”, “prossiga do ponto atual”, “execute o próximo passo”, “supervisor-cycle”, or “use o orquestrador”. Default to resume-execute; use read-only status only when explicitly requested.
---

# SKINCOS Project Orchestrator

Default mode is `resume-execute`: reconstruct state, choose one eligible priority milestone, execute, test, publish, follow CI to terminal state, merge when permitted, verify the target environment, and persist evidence. An audit is phase one, never the result when safe work remains.

## Modes

- No mode or resume wording: `resume-execute`.
- `status`, `somente audite`, `somente analise`: read-only.
- `plan`: rebuild/reorder queue only.
- `execute:<milestone-id>`: execute that item.
- `supervisor-cycle`: reconstruct the active thread mission, reconcile real
  state, execute one minimum safe eligible milestone, persist evidence, and
  emit the machine-readable Stop-hook contract.

Read `docs/decisions/codex-autonomy-policy.md`,
`references/execution-loop.md`, `references/authorization-boundaries.md`,
and `references/evidence-model.md`. For `supervisor-cycle`, also read
`references/supervisor-cycle.md` completely before acting.

## Loop

1. Read `AGENTS.md` and the autonomy policy, load the canonical operational snapshot when available, and inspect Git. On a root mission or an absent/stale snapshot, reconstruct only the relevant durable context, queue/ledger and remote sources; fetch refs and inspect the Git/worktree, PR/CI, deployment/runtime/D1/PostgreSQL surfaces needed by the mission.
2. Run `scripts/collect-state.sh` or `.ps1` when available. If unavailable/failing, collect directly; do not repeat a broad reconstruction or depend on one collector when its valid inputs and blocker fingerprint have not changed.
3. Classify local, branch, PR, main, preview, staging, production, or unproven. A 200 is not a journey; worktree is not main; merged PR is not staging; staging is not production.
4. Select the smallest eligible milestone within the current explicit mission. Define objective, scope, deliverables, allowed/prohibited actions, tests, evidence and done definition; do not switch to an unrelated queue item or invent a separate mission.
5. Execute continuously: scoped fixes, tests, commit, push, single-purpose PR, terminal CI, introduced-failure fixes, merge when technical gates permit, and the authorized environment verification. Do not stop after plan, commit, PR, running check, timeout, or first CI failure.
6. Verify the relevant environment and persist only material queue, generated-state, blocker and evidence changes. After compaction, load the snapshot and continue without duplicating volatile state across historical documents.

## Global concurrency authority

Local session/target leases and GitHub `concurrency` are scheduling safeguards;
neither is mutation authority. Before any shared operation, classify its
canonical resource (`merge:main`, `release:<module>`,
`deploy:<surface>:<environment>`, `cloudflare:<surface>:<environment>`, or
`promotion:<module>:<environment>`), acquire the remote lease through
`scripts/codex-global-coordination-workflow.mjs`, and keep the proof outside
the checkout. Renew and call `check` with the observed dependency-closure
digest immediately before each external mutation; release in an `always`
cleanup path. A missing URL, custody secret, resource, closure, or proof is a
fail-closed stop. The production coordinator URL is intentionally separate
from staging, so an absent production authority must block pilot, canary,
production, and rollback rather than reuse staging custody.

Each mission milestone also carries a compact `resource_declaration` with
`reads`, `writes`, `requires` and `leases`. Derive it from the actual next
operation and persist it with the supervisor snapshot. For a global mutation,
the orchestrator must acquire the listed remote lease and own a current fencing
proof before executing; authorization remains valid while waiting for that
ownership. The Stop hook only validates this shape and persistence. It is not a
second coordination authority and must not contain dependency or business
compatibility decisions.

## Authorization

Authorization comes from the current explicit mission under
`docs/decisions/codex-autonomy-policy.md`, not from an implicit
`resume-execute` default. It persists through worktrees, compaction,
CI, merge and supervisor continuation. Within the mission's declared scope, it
may cover code/config/tests/docs, branches/PRs, GitHub, Cloudflare, synthetic
resources, additive migrations, staging, canary, production, secrets and
rollback. Secret values and PII are never exposed or versioned.

Domain policies decide technical eligibility: flags, grants, real platform
permissions, migration safety, validation, evidence and rollback remain
mandatory even for an authorized production action. Treat a missing gate as a
specific technical blocker, not a request for duplicate authorization. Preserve
unrelated dirty work and keep PRs single-purpose.

Automatic continuation carries valid mission authorization but never broadens
it. End every `supervisor-cycle` with exactly one delimited JSON contract
defined in `references/supervisor-cycle.md`; use `continue` only after real
progress and with a concrete safe next item. Stop for an ambiguous material
scope, a non-bypassable platform trust/access boundary, or an explicit human
exception defined by the mission; report the narrowest actionable blocker.
