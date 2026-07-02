# Skincos Workspace Agent Rules

## Multi-Account Continuity

- This shared clone is the cross-account source of truth for project context, not
  for secrets or Codex authentication state.
- Before changing anything, read `AGENTS.md`, `CODEX_CONTEXT.md`, `TASKS.md`,
  and `DECISIONS.md`, then inspect `git status`.
- Use branches in the format `codex/<windows-user-or-alias>/<task-slug>`.
- Prefer worktrees under `C:\CodexShared\Worktrees\skincos\<actor>\<task-slug>`
  when more than one account or user may work in parallel.
- Never store `.env`, `.dev.vars`, `.cloudflared` credentials, `.codex`,
  cookies, or API keys inside `C:\CodexShared`.
- If local execution needs secrets, use a private overlay or a private clone
  outside the shared area and document only variable names here.

## Default Codex App Startup

- For non-trivial work in this repo, start by running or mentally applying
  `npm run codex:context` unless the request is obviously self-contained.
- For production-facing, deploy, tracking, auth, CRM, or Cloudflare work, also
  run the targeted preflight/checks before claiming completion.
- Prefer repo evidence and live endpoints over generic assumptions.
- If the user asks briefly ("proceda", "verifique", "publique", "corrija"),
  infer the standard Skincos flow instead of asking them to restate context.

## Source of Truth

- Start with the repository as the source of truth for implementation details.
- For production incidents, verify deployed state separately from local code.
- Treat Cloudflare Pages, Cloudflare Workers, CRM/backend services, and live
  endpoints as separate deployment surfaces until proven otherwise.
- If a CSV, worker route map, database row, or dashboard is the editable source
  of truth for a behavior, identify it explicitly before changing code.

## Production and Deploys

- When the user asks for a live fix, prioritize fix, deploy, and online
  verification.
- Before deploys, inspect the intended target, current git state, and relevant
  environment/config without exposing secrets.
- After deploys, verify the live URL, Worker route, Pages alias, API endpoint, or
  CRM behavior directly.
- Keep rollback details visible: previous commit, previous deployment, previous
  Worker version, or backup file.

## Known Sensitive Areas

- Auth, sessions, CSRF, cookies, token refresh, and proxy rewriting are high-risk.
  Inspect both frontend and backend paths before changing them.
- Meta tracking, CAPI, WhatsApp attribution, redirects, and CRM propagation are
  cross-system flows. Preserve event identity, dedupe, and correlation data.
- Redirect workers and alias maps must handle encoded paths, accents, casing, and
  allowlist order before returning 404.
- Do not hardcode credentials, tokens, pixel secrets, API keys, or CRM secrets.

## Validation Standard

- For frontend changes, run the relevant build/test checks and inspect the UI
  with Browser or Playwright when visual behavior matters.
- For redirects and tracking, validate representative URL variants and inspect
  network/events/logs when available.
- For auth/session fixes, validate fresh session, stale session, refresh path, and
  failure path when feasible.
- For production fixes, do not finish with only a local check when a live endpoint
  can be tested.

## Working Style

- Preserve unrelated changes in dirty worktrees.
- Prefer small, scoped changes over broad rewrites.
- If the user says a bug came back, investigate the recurrence mechanism before
  applying another patch.
- Report the exact files, deployments, endpoints, or logs used as evidence.

## Native Codex App Routing

- Browser: use for local/prod UI QA, screenshots, modal/header behavior, CRM
  module checks, and visual regressions. Prefer headless scripts for routine
  checks and Browser only when visual inspection is valuable.
- Build Web Apps: use for React/frontend module work, dashboard UX, Playwright
  tests, and component refactors.
- Cloudflare: use for Workers, Pages, D1, route bindings, deploys, logs, token
  health, and live endpoint verification.
- GitHub: use for PRs, checks, automerge, workflow runs, CI failures, releases,
  and deployment evidence.
- Sites: use for prototypes, temporary demos, or static artifacts only. Do not
  replace the production `espacofacial.com` Cloudflare/OpenNext pipeline unless
  the user explicitly approves a migration.
- Security: use for auth, sessions, tokens, consent, CAPI, Meta tracking,
  WhatsApp attribution, secrets, and data-flow risk reviews.

## Standard Commands

- Context snapshot: `npm run codex:context`
- Online context snapshot: `npm run codex:context:online`
- Autonomy/deploy preflight: `npm run codex:preflight`
- Site fast check: `npm run codex:site:check`
- Site release check: `npm run codex:site:release-check`
- Site EF CRM smoke: `npm run codex:crm:site-smoke`
- Meta Ads CRM smoke: `npm run codex:crm:meta-ads-smoke`

## Interpretation Defaults

- "site" usually means `website/` and production `https://espacofacial.com`.
- "CRM" usually means `frontend/` plus `backend/apps/crm-api/` and
  `https://crm.skincos.com.br`.
- "Site EF" means the CRM module `?module=site-tracking`.
- "Meta Ads" means the CRM module plus related `backend/apps/meta-ads` services.
- "publicar", "deploy", "commit/push/pr/merge" means use branch `codex/*`,
  PR, GitHub checks, automerge/merge, deploy workflows, and live smoke evidence.
- "verifique se está funcionando" means inspect both local/source-of-truth and
  live deployed state when a live endpoint exists.

## Headless Browser Policy

- Routine Playwright/CRM smoke should be headless and must not leave local
  servers running.
- Use `--headed-smoke --browser` only for explicit visual debugging.
- Do not commit `.playwright-mcp/`, screenshots, or local evidence images unless
  the user explicitly asks for an artifact.
