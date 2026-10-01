# Persistent project-state contract

Use existing documents as the primary records:

- `AGENTS.md`: operating policy and safety rules.
- `CODEX_CONTEXT.md`: active architecture and runtime context.
- `TASKS.md`: objectives and durable next actions.
- `DECISIONS.md`: decisions and their rationale.

Use the two ledgers only for incremental, dated observations:

- `docs/project-state/current-state.md`: latest cross-surface state, integration focus, and next safe action.
- `docs/project-state/evidence-ledger.md`: append-only evidence index; redact secrets and personal data.

Every evidence row records: observed-at time, surface, scope/identifier, state proved, method, outcome, and limitation. A state can be `local-only`, `main`, `staging`, `production`, or `unproven`.

Do not promote an observation to a decision or task without updating the canonical document that owns it.
