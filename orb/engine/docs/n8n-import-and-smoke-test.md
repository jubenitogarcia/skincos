# n8n import and smoke test

1. Use a test n8n project and export its current state before import.
2. Run the v2 build and validator locally.
3. Import `CCG-99`, then modules `CCG-10`–`CCG-90`, then `CCG-00`.
4. Map only existing credential aliases in the test project; do not copy secret values.
5. Send a fixture `production_request` with `dry_run=true` and `provider_policy.mode=mock` to `CCG-00`.
6. Confirm final item contains `output_type=CONTENT_PACKAGE`, `posting_payload.publish_requested=false` and no HTTP/Google Drive/Meta node was executed.
7. Export the imported test workflows and compare IDs/build metadata with the generated files.

This smoke test was not run against a live n8n instance in this task.
