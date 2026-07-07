# TASKS

## Priority Backlog

- [ ] Reconcile the shared `codex/julia/shared-bootstrap` branch with
  `origin/main` and return the shared repo to a trusted baseline.
- [ ] Review and, if needed, reauthorize the imported live `n8n` credential
  `Google Calendar (Skincos)` for the calendar scopes required by the clinic
  workflows.
- [ ] Fill the remaining manual `n8n-business.env` values
  `GOOGLE_CALENDAR_ID` and `N8N_DEFAULT_TEST_PHONE`.
- [ ] Run the full orb functional smoke with the now-populated
  `C:\CodexRuntime\n8n\env\n8n-business.env`: inbound webhook, Evolution
  inbound, and Google Calendar test event.
- [ ] Audit non-repo private overlays against the shared baseline.
- [ ] Drain remaining legacy path references from docs and low-priority helpers
  that still mention `frontend/`, `backend/apps/meta-ads`, or
  `backend/apps/whatsapp`.

## In Progress

- [ ] Controlled activation path for the orb clinic workflows in the live `n8n`
  runtime.

## Blocked / Needs Manual Follow-Up

- [ ] Any task that requires real `.env`, `.dev.vars`, `.cloudflared`, or API
  credentials must use a private overlay outside `C:\CodexShared`.
- [ ] Full orb business smoke is blocked until `GOOGLE_CALENDAR_ID`,
  `N8N_DEFAULT_TEST_PHONE`, and a verified Google Calendar OAuth binding exist
  on the live runtime.

## Done

- [x] Shared clone created in `C:\CodexShared\Projetos\skincos`.
- [x] `AGENTS.md`, `CODEX_CONTEXT.md`, `TASKS.md`, and `DECISIONS.md` established
  for cross-account continuity.
- [x] Operator-specific `cloudflared` credential paths replaced with documented
  placeholders in the shared clone.
- [x] Cross-user access validated from a second Windows user without using the
  legacy checkout.
- [x] Shared baseline worktree validated for cross-user Git access after
  per-user `safe.directory` bootstrap.
- [x] Shared clone `origin` corrected from a legacy local path to the GitHub
  remote.
- [x] Second Windows user authenticated to GitHub and validated remote
  read/write access with non-destructive dry-runs.
- [x] Shared operational scripts no longer depend on the legacy Windows
  checkout path.
- [x] Shared-clone shell entrypoints normalized for WSL and protected with
  explicit `LF` rules in `.gitattributes`.
- [x] Shared clone passes `npm run codex:site:check`.
- [x] Shared clone passes `npm run codex:crm:site-smoke`.
- [x] Shared clone passes `npm run codex:crm:meta-ads-smoke`.
- [x] Legacy Windows checkout content under `C:\Users\julia\skincos` was
  removed; the empty root is pending handle release from the current Codex
  session.
- [x] The old top-level `C:\CodexShared\Projetos\n8n` clone was retired from
  active use and archived at
  `C:\CodexShared\Projetos\_bootstrap\n8n-top-level-legacy-20260703T181656`
  after the embedded `skincos\n8n` runtime handoff was validated.
- [x] First modular-envelope wave created `modules/`, `platform/`, `ops/`, and
  `archive/`, and moved `website/`, `n8n/`, and `backend/apps/crm-api/` into
  their new canonical module paths.
- [x] Second modular-envelope wave moved `frontend/` to `modules/crm/web`,
  `backend/apps/meta-ads/` to `modules/meta-ads/meta-ads`, and
  `backend/apps/whatsapp/` to `modules/whatsapp/whatsapp`.
- [x] The live orb stack converged to system services under `User=skincos`,
  with machine-scoped env/runtime state in `C:\CodexRuntime\n8n`.
- [x] Shared runtime validation now checks both the runtime contract and the
  absence of legacy orb references to `/home/julia`, `/srv/skincos`,
  `/etc/skincos`, and `systemctl --user`.
- [x] Shared operational shortcuts were installed in the common Start Menu for
  all local Windows users.
- [x] Codex App top-bar actions are now shared through the repo-tracked
  `.codex/environments/environment.toml`, while the rest of `.codex` remains
  private per account.
- [x] Legacy WSL `systemctl --user` orb services were disabled in the `julia`
  account so the machine-scoped `skincos-*` runtime is the only live orb path.
- [x] The local PostgreSQL role/database `n8n_runtime` were provisioned to
  match `C:\CodexRuntime\n8n\env\n8n.env`, restoring `skincos-n8n.service`.
- [x] Recoverable values were backfilled into
  `C:\CodexRuntime\n8n\env\n8n-business.env`, including `EVOLUTION_API_KEY`,
  `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `N8N_DEFAULT_UNIT_SLUG`, and `N8N_DEFAULT_UNIT_NAME`.
- [x] `skincos-cloudflared-cs.service` was moved off `/etc/skincos` and now
  reads its config from `C:\CodexRuntime\cloudflared\cs`.
- [x] Runtime mirrors were created for `crm-api.env` and `booking-api.env`
  under `C:\CodexRuntime`.
- [x] `Shared Validate`, `Runtime Validate`, `Shared Status`, `Codex Context`,
  `Orb Status`, `Orb Restart`, `Orb Audit`, and `Orb Validate` now succeed in
  the shared baseline.
- [x] `skincos-crm-api.service` and `skincos-booking-api.service` were
  converged away from `/srv/skincos` and `/etc/skincos` to shared repo
  launchers plus machine-scoped runtime homes in `C:\CodexRuntime`.
- [x] `scripts/install-shared-support-system-services.sh` now reapplies the
  shared runtime contract for `crm-api`, `booking-api`, and `cloudflared-cs`.
- [x] The shared runtime now has a canonical `Orb Repair` path that reconciles
  the live Postgres contract from `C:\CodexRuntime\n8n\env\n8n.env`, restarts
  the orb stack, validates health, and writes redacted evidence under
  `C:\CodexRuntime\n8n\exports\repair-<timestamp>\`.
- [x] The Codex App project actions now mirror the documented shared launcher
  inventory, including `Shared Validate`, `Runtime Setup`, `Runtime Validate`,
  `Thread Bootstrap`, `CRM Site EF`, `CRM Meta Ads`, `CRM Atendimento Clínica`,
  `Orb Logs`, `Orb Audit`, and `Orb Repair`.
- [x] Windows `gh auth login` was completed for the current `julia` profile as
  `jubenitogarcia`.
- [x] WSL `gh auth status` now resolves to `jubenitogarcia` via
  `/home/julia/.config/gh/hosts.yml`.
- [x] The four clinic orb workflows `WORKFLOW_01..04` were imported into the
  live `n8n_runtime` project in inactive mode.
- [x] The live `n8n` DB now contains the expected credentials
  `Postgres (Skincos)` and `Google Calendar (Skincos)`.
