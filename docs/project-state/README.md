# Project state records

These records preserve only the incremental cross-surface state that is not owned
by existing canonical documents. They are versioned and updated by
`skincos-project-orchestrator` after every execution.

| Need | Canonical source |
| --- | --- |
| Operating rules | `AGENTS.md` and `CODEX_CONTEXT.md` |
| Objectives and next actions | `TASKS.md` |
| Decisions and rationale | `DECISIONS.md` |
| Latest cross-surface snapshot | `current-state.md` |
| Timestamped evidence index | `evidence-ledger.md` |

The ledgers do not replace direct provider evidence. They link to the command,
identifier, deployment, PR, workflow run, or runbook that established a claim.
See `skills/skincos-project-orchestrator/references/ledger-schema.md` for the
entry contract.
