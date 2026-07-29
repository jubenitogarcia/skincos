# n8n import and smoke test

1. Export the current unified workflow before replacing it; retain the private checkpoint.
2. Run the v2 build, validator, dry-run suite and security audit locally.
3. Import only `ccg-v2-content-orchestrator.json` into a clean n8n workflow, then archive the superseded unified workflow after validation.
4. Do not map credentials: the unified workflow has no external node or credential dependency.
5. Execute only `Manual safe dry-run smoke`. It creates a fixed fixture with `dry_run=true`, `provider_policy.mode=mock`, `max_cost=0`, no source assets and no publication request.
6. Confirm success, the `CONTENT_PACKAGE` tail, `posting_payload.publish_requested=false`, and absence of HTTP/Google Drive/Meta nodes or Execute Workflow dependencies.
7. Export the live unified workflow and compare its node names, trigger count and metadata with the generated artifact.

Live smoke evidence: workflow `TxE9eMS1xfE6kq38`, execution `342`, 2026-07-29 14:01:17 -03, `success` in 591 ms. It was manual, fixture-only and had no external integration node.
