---
name: skincos-project-orchestrator
description: Reconstruct, audit, and safely continue the real SKINCOS project state. Use for any SKINCOS request to retomar, continuar, revisar, auditar, assess handoff work, inspect PRs/CI/deploys, compare planning with staging or production, or select and execute the next safe project action.
---

# SKINCOS Project Orchestrator

Use this Skill to make the project state trustworthy before choosing or continuing work. Treat repository documents as intent and live systems as evidence; neither replaces the other.

## Required start

1. Read `AGENTS.md`, `CODEX_CONTEXT.md`, `TASKS.md`, and `DECISIONS.md` completely. Then inspect `git status --short --branch` before editing anything.
2. Run `npm run codex:context` (or `npm run codex:context:online` when external state is in scope) through the supported WSL `admin` environment. Use `scripts/collect-readonly-state.sh` for a reproducible read-only Git/GitHub/runtime snapshot.
3. Read `docs/project-state/README.md`, `docs/project-state/current-state.md`, and `docs/project-state/evidence-ledger.md`. Resolve conflicts in favor of freshly timestamped, direct evidence and record the correction.
4. Separate each finding into exactly one state: **local-only**, **integrated on `main`**, **deployed to staging**, **active in production**, or **unproven**. A worktree, branch, commit, healthy endpoint, or prior report alone does not establish a later state.

## Evidence pass

Inspect the configured sources that are relevant to the request, without exposing secrets or personal data.

| Surface | Minimum read-only evidence |
| --- | --- |
| Git | `main`, `origin/main`, current branch, worktrees, dirty changes, merge-base and relevant commits |
| GitHub | Open PRs, review/merge state, required checks and recent workflow runs through `gh` or the GitHub connector |
| Cloudflare | Version/deployment metadata, configured target and public read-only health probes through Wrangler/Cloudflare tools |
| D1 | Migration/version metadata and narrowly scoped `SELECT` evidence only when the configured database and authorization are available |
| PostgreSQL/runtime | Native release SHA, service status/log summaries, read-only database metadata and health/smoke evidence through the supported runtime path |

Do not infer D1, PostgreSQL, Cloudflare, staging, or production state from local configuration. Mark unavailable or unauthorized sources as **unproven**, state the smallest safe check that would resolve them, and do not call that a human blocker unless an actual approval, identity, credential, or business decision is required.

For application behavior, record both layers separately:

- **Endpoint health** proves reachability only.
- **Journey validation** requires the relevant authenticated or end-to-end flow, expected side effects, and negative/authorization behavior where applicable.

## Mandatory gates

- Never deploy, promote, mutate D1/PostgreSQL, activate a workflow, change secrets, or alter production without explicit current authorization.
- Never call work complete without direct, timestamped evidence appropriate to its claimed state.
- Never treat a worktree or branch as `main`; prove integration with Git ancestry and the remote `main` SHA.
- Preserve all unrelated dirty changes and never clean, reset, move, or overwrite them as part of orchestration.
- Keep PRs small and single-purpose. Do not start a large new front while a critical integration, release, migration, or recovery gate remains incomplete.
- Prefer read-only observation first; use least-privilege access and redact secret/PII values from ledgers and handoffs.
- Update the persistent ledgers at the end of every execution, including a read-only execution.

## Decide and continue

Compare the observed state with the project objectives in `TASKS.md`, decisions in `DECISIONS.md`, the target architecture, and the affected domain documentation. Identify inconsistencies, stale claims, missing evidence, risks, and incomplete work.

Choose the minimum safe next set:

1. Close a critical integration or evidence gap before opening unrelated product work.
2. Perform reversible local implementation and targeted validation when the request grants normal implementation authority.
3. Stop only for a decision that cannot be safely inferred: production authorization, irreversible data action, missing access, or a material business choice. Resolve all technical/read-only alternatives first.
4. When authorized, actually execute the selected safe work and validation. Do not end with generated commands or a new report if a safe next action can be performed now.

## Persist the handoff

Update only the incremental entries needed in:

- `docs/project-state/current-state.md` for the current cross-surface snapshot and selected next action;
- `docs/project-state/evidence-ledger.md` for timestamped commands, links/identifiers, outcome, scope, and limitations;
- `TASKS.md` for durable next actions; and
- `DECISIONS.md` only for an actual decision, not an observation.

Use references instead of duplicating source documents. An unverified claim belongs in the evidence ledger as unproven, not in the current state as fact.

## Response contract

State the current level of proof first, then report: observed state by environment, the evidence used, inconsistencies/risks, actions completed in this execution, the next minimal safe action, and only genuine human blockers. Cite file paths, commit/PR/run/deployment identifiers, and timestamps where available.

## Invocation examples

- `$skincos-project-orchestrator Retome o SKINCOS e continue.`
- `$skincos-project-orchestrator Veja em que ponto estamos.`
- `$skincos-project-orchestrator Revise o que o agente anterior fez e prossiga.`
- `$skincos-project-orchestrator Verifique as PRs abertas e execute o próximo passo seguro.`
- `$skincos-project-orchestrator Compare o planejamento com o que está realmente em staging.`
