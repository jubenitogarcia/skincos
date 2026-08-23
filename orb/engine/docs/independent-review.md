# Independent adversarial review — CCG v2

Review performed after the implementation gate, against generated workflows, schemas, migrations, renderer, mocks, tests and documentation.

## Findings

### P0

None found. No workflow contains a publication node, live provider call, literal secret, campaign folder ID or base64 pinData.

### P1

None open after correction. The generated Code nodes now parse `production_request`, validate required fields and reject invalid content type/tier before module work. Code-node syntax is checked by the v2 validator.

### P2

- **Live n8n import remains unproven.** No authorized test instance or organizer/posting contract was found in the repository. Exact smoke steps are in `docs/n8n-import-and-smoke-test.md`.
- **Video encoding is fixture-only in dry-run.** The deterministic renderer creates valid still SVGs and a video timeline fixture; FFmpeg encoding belongs to the approved runtime and was not invoked from n8n Code nodes.
- **Generated CCG nodes are orchestration-safe adapters, not a replacement for the live n8n credential map.** Provider/storage credentials must be mapped in the test project.

### P3

- Existing legacy exports remain intentionally ignored by the repository; the sanitized baseline and SHA manifest are versioned under `baseline/`.
- `npm audit` reports one moderate dependency advisory in the local dependency tree; it does not block dry-run behavior, but should be reviewed before production enablement.

## Re-run evidence

- `npm run lint` — PASS.
- `npm test` — PASS, including AJV validation of 17 valid/invalid schema examples.
- `npm run workflow:campaign-creative:v2:build` — PASS, 11 workflows.
- `npm run workflow:campaign-creative:v2:validate` — PASS, graph/IDs/triggers/code syntax/no publication.
- `npm run workflow:campaign-creative:v2:dry-run` — PASS, 8 cases, `paid_calls: 0`.
- literal secret scan and `git diff --check` — PASS.

No P0/P1 remains open. This review does not claim a live n8n import or production activation.
