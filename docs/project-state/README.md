# Project state records

These records preserve only the incremental cross-surface state that is not
owned by existing canonical documents. They are updated by
`skincos-project-orchestrator` after a read-only reconciliation.

| Need | Canonical source |
| --- | --- |
| Operating rules | `AGENTS.md` and `CODEX_CONTEXT.md` |
| Objectives and next actions | `TASKS.md` |
| Decisions and rationale | `DECISIONS.md` |
| Latest cross-surface snapshot | `current-state.md` |
| Timestamped evidence index | `evidence-ledger.md` |

The ledgers never replace provider evidence. They record the command, URL,
commit, workflow run or PR that supports a claim, its observation time, and its
limitation. They must not contain credentials, raw personal data or secrets.
