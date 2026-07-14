# TASKS

## Architecture reorganization — active program

- [ ] **Wave 2 — source layout:** validate the moved product roots, remove
  direct `api` reexport coupling, and publish a reviewable source-only PR. No
  runtime/service/deploy action belongs to this wave.
- [ ] **Wave 3 — gateway contracts:** move one domain at a time behind
  `api.skincos.com.br/<domain>`, with staging D1/binding tests and explicit
  authorization tests for CRM humans and private services.
- [ ] **Wave 4 — Booking + EF integration:** introduce the D1 outbox/ledger,
  idempotency, lease and `provisional`/`confirmed`/`failed`/`manual_review`
  state model; use a simulated EF executor before any external reservation.
- [ ] **Wave 5 — runtime cutover:** pre-copy to the lifecycle layout, create a
  verified fresh backup, rename units in a short window, and retain rollback
  evidence. The executable contract is
  `docs/runbooks/lifecycle-runtime-cutover.md`; do not change the WSL VHD,
  Codex authentication or mandatory Windows state.
- [ ] **Wave 6 — retirement:** remove old source paths, direct public routes,
  scripts and backups only after merged CI plus local/public health proof.

- [ ] **Security baseline remediation:** address the externally reclassified
  CodeQL/Semgrep findings by owner and trust boundary; see
  `docs/architecture/code-scanning-baseline-triage.md`. Do not bulk-dismiss
  findings created by the domain move.

## Priority Backlog

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
- [ ] Complete the two administrator-protected `ProgramData` removals recorded
  by `npm run codex:footprint:audit` in an elevated Windows session.
- [ ] Move the ignored, sensitive live Livia workflow snapshot out of the
  canonical clone into `C:\CodexRuntime`, then update its maintenance scripts
  to read the managed runtime export without exposing state or secrets in Git.

## In Progress

- [ ] Controlled activation path for the orb clinic workflows in the live `n8n`
  runtime.

## Blocked / Needs Manual Follow-Up

- [ ] Any task that requires real `.env`, `.dev.vars`, `.cloudflared`, or API
  credentials must use a private overlay outside `C:\CodexShared`.
- [ ] Full orb business smoke is blocked until `GOOGLE_CALENDAR_ID`,
  `N8N_DEFAULT_TEST_PHONE`, and a verified Google Calendar OAuth binding exist
  on the live runtime.
- [ ] Optional cleanup: normalize the `admin` WSL distro storage back from
  `%LOCALAPPDATA%\wsl\{aa973afc-c57c-49d3-810d-ff364865ce84}` to a single
  canonical elevated path under `C:\WSL\Ubuntu-24.04`.

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
- [x] The old top-level `C:\CodexShared\Projetos\n8n` clone was retired after
  the embedded `skincos\n8n` runtime handoff was validated, then its rollback
  archive was removed after a fresh runtime backup and secret/state validation.
- [x] The legacy atendimento recovery was removed after a current n8n backup
  and equivalent active runtime secret/state validation.
- [x] Clean integrated worktrees are now removed after publish/integration;
  dirty, active, unmerged, and Codex-managed worktrees are preserved.
- [x] `npm run codex:footprint:audit` now reports footprint, retired paths,
  task drift, backup freshness, disk, Git, worktree, and endpoint health; CI
  rejects retired operational-path references outside historical documentation.
- [x] First modular-envelope wave created `modules/`, `platform/`, `ops/`, and
  `archive/`, and moved `website/`, `n8n/`, and `backend/apps/crm-api/` into
  their new canonical module paths.
- [x] Second modular-envelope wave moved `frontend/` to `crm/console`,
  `backend/apps/meta-ads/` to `ads/meta`, and
  `backend/apps/whatsapp/` to `messaging/channels/whatsapp`.
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
- [x] Codex App and shortcut actions now cover the `app.espacofacial.com.br`
  scraper with local-user state outside the repo.
- [x] The hardened scraper action set now includes `EF App Caixa` for guided
  cash exports from the external Espaço Facial app.
- [x] The shared shortcut UX was condensed to interactive domain menus behind
  five top-level launchers: `Workspace`, `Contexto`, `Local`, `EF App`, and
  `Orb`.
- [x] The shortcut menus now cover additional published workflows including
  `Codex Context Online`, website checks, CRM diagnostics/smokes, platform
  local start, orb business validation, support-service apply, clinic workflow
  import, and the remaining EF App automation helpers.
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
  inventory through the top-level launchers `Workspace`, `Contexto`, `Local`,
  `EF App`, and `Orb`.
- [x] Owner access to `orb.skincos.com.br` was recovered for
  `julianbenitogarcia@gmail.com`, with the password rotated manually after the
  recovery login.
- [x] The `admin` Windows account now has a working `Ubuntu-24.04` WSL runtime
  again via a recovered per-user `BasePath`, unblocking shared orb operations
  in this account.
- [x] After the WSL recovery reintroduced stale user units and legacy support
  unit definitions, `scripts/install-shared-support-system-services.sh --apply`
  was rerun, the legacy `systemctl --user` orb units were disabled again, and
  `Orb Audit` plus `Orb Validate` returned to green.
- [x] WSL `gh auth status` resolves to `jubenitogarcia` for the supported
  `admin` operator session.
- [x] The four clinic orb workflows `WORKFLOW_01..04` were imported into the
  live `n8n_runtime` project in inactive mode.
- [x] The live `n8n` DB now contains the expected credentials
  `Postgres (Skincos)` and `Google Calendar (Skincos)`.
