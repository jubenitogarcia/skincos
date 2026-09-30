# Autonomous delivery standard

This is the operational summary for reversible SKINCOS delivery. The
[autonomy policy](../decisions/codex-autonomy-policy.md) decides whether the
mission authorizes an action; domain policies decide whether the action is
technically eligible. A missing technical gate is repaired or recorded as a
blocker, not converted into a repeated permission question.

## Canonical flow

1. Reconstruct only the relevant source of truth, current environment, risk,
   incumbent release, dependency closure, and rollback identity.
2. Work in an isolated `codex/admin/<task>` worktree. Preserve unrelated dirty
   checkouts.
3. Run the risk-selected focused validation and reuse the same SHA, release
   identity, closure digest, and evidence through integration and deployment.
4. Keep the PR mergeable and use an independent merge authority with the
   `merge:main` lease. It revalidates base, head, dependency closure, native
   evidence, actual branch requirements and fencing before the single merge
   mutation, then reads back the result. Do not dispatch the former Actions
   merge workflow.
5. Promote only an immutable release identity. Every native mutation acquires,
   checks, renews, and releases the global lease immediately around each
   external mutation.
6. Use objective rollout evidence to move `off -> shadow -> active`. A failed
   shadow or active criterion holds the capability or returns it to the last
   safe mode; it does not wait for a human to click through a reversible gate.

For the Livia AI reel-cover lane, the versioned contract, database transition
and native controller are maintained in
[the independent Orb repository](https://github.com/jubenitogarcia/orb). The
controller requires the exact active workflow version, immutable release SHA,
global lease and functional-smoke evidence before activation. SKINCOS does not
restart or publish through that lane.

## Native custody

Native custody belongs in the private Linux store, never the checkout,
Windows argv, artifacts, comments or logs. Verify the canonical store and
platform permission by metadata before recovery. A mission-authorized internal
secret may be created there with the approved helper and checked without
displaying its value. Obtain externally issued credentials only through the
issuer's authenticated mechanism. Keep staging and production custody separate.

The trusted Actions runner, its bootstrap and
`.github/workflows/provision-native-global-coordination-custody.yml` are
legacy infrastructure. Do not register, dispatch or wait for them for a new
mission. If a native route for a required credential or writer has not yet been
proven, complete that migration first and leave the affected mutation
fail-closed. See
[`github-actions-retirement.md`](../decisions/github-actions-retirement.md).

## Evidence and recovery

Evidence records the UTC time, SHA, environment, native command/receipt, release or
deployment identity, result, limitation, and exact rollback target. Health is
reachability only; a journey requires the intended flow and negative behavior.
If a step fails, classify it as transient, source/closure drift, lease/trust,
validation, provider, or data/irreversible. Retry only transient or idempotent
failures, refresh the exact source/closure when safe, roll back to the recorded
incumbent when the objective failure threshold is reached, and leave the lease
and evidence in a terminal fail-closed state.
