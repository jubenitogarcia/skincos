# Codex autonomy runbook

This project is set up so Codex can implement, validate, ship, and verify changes with minimal human intervention.

For Codex App plugin routing, local Browser QA, Sites prototyping, and headless agent commands, see `docs/codex-app-native.md`.

## What must stay valid

- WSL GitHub CLI auth for this repo: `gh auth status`
- Local Cloudflare auth: `cd frontend && npx wrangler whoami`
- GitHub deploy secrets:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `GH_TOKEN`
  - `CRM_API_BASIC_AUTH`
  - `META_ADS_REPORT_WORKER_API_TOKEN`
  - `INTEGRATIONS_ENCRYPTION_SECRET`
- GitHub deploy variables:
  - `CLOUDFLARE_PAGES_PROJECT`
  - `ENABLE_CRM_PAGES_DEPLOY`
  - `ENABLE_CRM_API_DEPLOY`
  - `META_ADS_REPORT_WORKER_BASE_URL`

Secret values must never be committed or printed in logs. The preflight only checks presence and operational reachability.

## Local preflight

Run before critical deploy, secret rotation, or when Codex needs full autonomy:

```bash
npm run codex:preflight
```

For strict mode:

```bash
scripts/codex-preflight.sh --strict
```

Strict mode exits non-zero for warnings as well as failures. Use it for release readiness. Normal mode is better during local development because it reports local dirty files as warnings.

## GitHub preflight

Workflow:

```text
.github/workflows/codex-autonomy-preflight.yml
```

It runs weekly and can be triggered manually from GitHub Actions. It verifies that the CI environment still has the secrets, variables, endpoints, workflows, and security exception dates needed for autonomous operation.

## Operational model

Preferred flow:

1. Codex creates a `codex/*` branch.
2. Codex implements changes and validates locally.
3. Codex pushes and opens a PR.
4. GitHub checks and security gates run.
5. Automerge merges only after required checks pass.
6. After-automerge deploy workflows reconcile CRM Pages, Workers, and CRM API.
7. Codex verifies production health endpoints.

Manual deploys through local Wrangler are allowed when needed, but GitHub Actions are the preferred path because they are auditable and repeatable.

## When to rotate credentials

Rotate deploy credentials if:

- `scripts/codex-preflight.sh` reports missing or invalid Cloudflare/GitHub auth.
- `GitHub Auth Status` shows WSL auth is not ready for `jubenitogarcia/skincos`.
- GitHub deploy workflows fail with missing or unauthorized Cloudflare credentials.
- Cloudflare token scope changes are required.
- The normal 90-day rotation window from `docs/secrets-rotation.md` is reached.

After rotation, run:

```bash
npm run codex:preflight
gh workflow run codex-autonomy-preflight.yml
```

## Scope required for the Cloudflare token

The token used by GitHub Actions should allow the current deployment surface:

- Account read
- Workers scripts write
- Workers routes write
- Workers KV write
- Pages write
- D1 write
- R2 write if website/session sync needs it
- Zone read for routed workers and audits
- Secrets write for workflows that sync Worker/Pages secrets

Use least privilege, but do not split tokens unless there is a concrete security or ownership reason. Too many partially scoped tokens make autonomous deployment less reliable.

## Expected healthy endpoints

The preflight checks these endpoints:

- `https://crm.skincos.com.br/?module=meta-ads`
- `https://crm.skincos.com.br/api/health`
- `https://crm.skincos.com.br/api/insumos/health`
- `https://api.skincos.com.br/health`
- `https://skincos-meta-ads-performance-report.skincos.workers.dev/health`
- `https://crm.skincos.com.br/api/meta-ads/status`

`/api/meta-ads/status` may return `401` without a CRM session; this is treated as healthy because it proves the route is alive and enforcing auth.

## Human-only responsibilities

Codex can operate the repo, CI, deploys, and Cloudflare resources when credentials are valid. Humans still own:

- Creating or revoking provider accounts.
- Approving new third-party billing or paid products.
- Providing fresh OAuth consent when a provider requires browser login.
- Deciding whether to grant broader permissions than the documented token scope.
