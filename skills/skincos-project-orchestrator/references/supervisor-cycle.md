# Supervisor cycle

Use this mode only for the currently active explicit SKINCOS mission. The Stop
hook is a deterministic gate; all reconstruction, prioritization, execution and
evidence judgment remains here.

## Cycle procedure

1. Reconstruct the original user objective and every later commitment from the
   current thread. Treat the Stop-generated prompt as continuation context, not
   as broader authorization.
2. Read the canonical project instructions, work queue, current state, blockers
   and evidence ledger. Fetch remote refs and inspect the real Git/worktree,
   PR, review, checks, deployment and runtime state relevant to the mission.
3. Reconcile planned, local, committed, pushed, PR, merged, staging, production
   and unproven states separately. Do not infer a later state from an earlier
   one.
4. Keep one internal technical mission with objective, scope, deliverables,
   allowed/prohibited actions, dependencies, tests, evidence and done
   definition. Prefer the next minimum safe milestone within the active
   objective; do not switch to an unrelated queue item.
5. Execute that milestone when already authorized. Test it, commit/push it,
   create or update its single-purpose PR, follow checks to a terminal state,
   fix failures introduced by the change, merge when gates permit, and verify
   the integrated result. Do not merely print commands for another session.
6. Persist durable queue, blocker and evidence changes when facts materially
   changed. Keep transient hook state outside Git.
7. Choose exactly one terminal or continuing orchestration status. Automatic
   continuation is allowed only when real progress occurred and a concrete,
   non-production next item remains.

## Output contract

End the response with exactly one block between these literal markers and no
text after the end marker:

```text
SKINCOS_SUPERVISOR_STATE_BEGIN
{
  "schema_version": 1,
  "orchestration_status": "continue",
  "objective_status": "in_progress",
  "session_id": null,
  "mission_id": null,
  "completed_item": null,
  "next_item": null,
  "progress_made": true,
  "human_blocker": null,
  "credential_blocker": null,
  "production_authorization_required": false,
  "evidence_refs": []
}
SKINCOS_SUPERVISOR_STATE_END
```

The minimum fields shown above are mandatory; `mission_id` is optional on the
first root turn and must be preserved when the gate supplies it.

Allowed `orchestration_status` values:

- `continue`: objective remains in progress, real progress occurred and
  `next_item` is concrete, safe and already authorized.
- `complete`: the original objective and added commitments are proved complete;
  set `objective_status` to `complete` and include evidence.
- `human_blocked`: one minimum specific human decision or platform confirmation
  is unavoidable; populate `human_blocker`.
- `credential_blocked`: required access is unavailable; populate
  `credential_blocker` without revealing credential material.
- `production_authorization_required`: the next necessary action affects
  production and lacks a new explicit specific authorization.
- `cycle_budget_exhausted`: the gate-reported mission budget is exhausted; keep
  recoverable state and do not claim completion.
- `safety_stop`: state is corrupt, ambiguous, conflicting or unsafe.
- `error`: an internal failure prevents a trustworthy decision.

Never emit `continue` with `progress_made=false`, a blocker, a missing
`next_item`, or `production_authorization_required=true`. A new explicit user
request starts a fresh root budget; a Stop-generated prompt does not.
