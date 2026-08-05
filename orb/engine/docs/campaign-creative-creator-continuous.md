# Campaign Creative Creator: continuous candidate

This change set builds an inactive candidate from the current `Campaign Creative Creator` export (`TxE9eMS1xfE6kq38`). The source export remains the source of truth; the generated candidate is an implementation artifact and has not been imported, activated, or executed in Orb.

## What the builder changes

- Keeps the manual CCG-00 dry-run fixture as a safe smoke entry point.
- Removes the independent CCG-10 through CCG-90 dry-run fixtures and reconnects each module return to the next module validator.
- Adds the operational `executeWorkflowTrigger` entry point.
- Adds `CCG-80 Production Executor`, which emits deterministic simulated results only in `DRY_RUN`.
- In `LIVE`, accepts only an externally produced, lineage-complete result envelope. Without a reviewed adapter it returns `POLICY_BLOCKED` with no external calls or storage writes.
- Preserves the closed-world policy, provider/cost/job limits, human approval requirement, URI-based artifacts, and publication guards.
- Removes filesystem, Python, subprocess, and in-node `require` usage from the CCG-10 evidence and CCG-40 checksum paths. PDF extraction without supplied text is explicitly deferred rather than guessed.

The builder is idempotent and does not embed a credential, token, or raw export in the repository.

## Rebuild and validate

Use a private export path for `CCG_SOURCE_FILE` and a private output path for `CCG_OUTPUT_FILE`:

```text
CCG_SOURCE_FILE=<private current export> \
CCG_OUTPUT_FILE=<private candidate output> \
npm run workflow:campaign-creative:continuous:build

npm run workflow:campaign-creative:continuous:validate -- --input <private candidate output>
npm run workflow:campaign-creative:continuous:test
```

For SKINCOS, run these commands through `scripts/invoke-skincos-wsl.ps1` so the project runtime stays in Ubuntu-24.04.

## Safety and rollback boundary

The candidate always writes `publish_allowed: false` and `publish_requested: false`. It has no publication or ad-activation path. Dry-run produces no paid provider calls, network calls, or storage writes. A live provider adapter remains a separate reviewed integration boundary and must provide receipts, cost, URI, MIME type, dimensions, checksum, and all lineage fields before results are accepted.

The prior live export/version is retained separately as version `941bec10-3e41-49be-baed-753ca60787ad`. This branch does not modify the n8n database or activate either version. Any import or activation requires a separate operational change with pre-production validation and a reversible version checkpoint.
