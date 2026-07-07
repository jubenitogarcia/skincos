# CODEX_CONTEXT

## Current State

- Shared multi-account clone created at `C:\CodexShared\Projetos\skincos`.
- The repo is now adopting a domain envelope rooted at `modules/`, `platform/`,
  `ops/`, and `archive/`.
- The shared n8n operational workspace now lives at
  `C:\CodexShared\Projetos\skincos\modules\automations\n8n`.
- The public website now lives at
  `C:\CodexShared\Projetos\skincos\modules\site-public\website`.
- The CRM API now lives at
  `C:\CodexShared\Projetos\skincos\modules\crm\api`.
- The CRM web app now lives at
  `C:\CodexShared\Projetos\skincos\modules\crm\web`.
- The Meta Ads workspace now lives at
  `C:\CodexShared\Projetos\skincos\modules\meta-ads\meta-ads`.
- The WhatsApp workspace now lives at
  `C:\CodexShared\Projetos\skincos\modules\whatsapp\whatsapp`.
- The former top-level `C:\CodexShared\Projetos\n8n` clone is no longer active
  and now lives only as a rollback archive at
  `C:\CodexShared\Projetos\_bootstrap\n8n-top-level-legacy-20260703T181656`.
- Shared worktree root standardized at `C:\CodexShared\Worktrees\skincos`.
- The shared clone `origin` now points to
  `https://github.com/jubenitogarcia/skincos.git`, not to a legacy local path.
- Validation from a second Windows user (`dev`) confirmed the shared clone can
  be read directly from `C:\CodexShared` without opening `C:\Users\julia\...`.
- Git on each Windows user still requires per-user `safe.directory`
  registration before normal commands like `git status` work in the shared
  clone or worktrees.
- Shared operational scripts and Codex automation cwd pointers are being
  updated to resolve the modular envelope paths instead of the legacy technical
  roots.
- Shared `skincos` now passes the local shared-clone validations:
  `npm run codex:site:check`, `npm run codex:crm:site-smoke`, and
  `npm run codex:crm:meta-ads-smoke`.
- Shared workspace bootstrap/validation now live in
  `scripts/setup-shared-codex-workspace.ps1`,
  `scripts/validate-shared-codex-workspace.ps1`, and
  `docs/codex-shared-workspace.md`.
- Shared operational shortcuts now live in the common Start Menu at
  `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Skincos Codex`,
  grouped by Setup, Contexto, Local, and Runtime.
- The Codex App top-bar actions are now shared through the repo-tracked file
  `.codex/environments/environment.toml`; the rest of `.codex` remains
  untracked and per-user.
- The shared Start Menu inventory and the Codex App top-bar inventory are being
  realigned so every operator sees the same supported actions, including the
  runtime repair entrypoint `Orb Repair`.
- The live orb stack now runs from `skincos-*` system services under
  `User=skincos`, with code in `modules/automations/n8n` and machine-scoped
  runtime state in `C:\CodexRuntime\n8n`.
- The canonical live orb env contract is now split into
  `C:\CodexRuntime\n8n\env\n8n.env`,
  `C:\CodexRuntime\n8n\env\n8n-business.env`, and
  `C:\CodexRuntime\n8n\env\evolution-api.env`.
- The live `n8n-business.env` now has the recoverable values backfilled from
  the runtime (`EVOLUTION_API_KEY`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `N8N_DEFAULT_UNIT_SLUG`, `N8N_DEFAULT_UNIT_NAME`),
  but `GOOGLE_CALENDAR_ID` and `N8N_DEFAULT_TEST_PHONE` still need manual
  completion before a full orb smoke can be finished.
- Legacy `systemctl --user` orb services in the `julia` WSL account were
  disabled, and the shared runtime validation now passes again on the
  machine-scoped stack.
- The local PostgreSQL role/database `n8n_runtime` were provisioned to match
  the shared `n8n.env` contract, which restored `skincos-n8n.service`.
- The canonical shared repair path for future Postgres/runtime drift is now
  `modules/automations/n8n/scripts/reconcile-mini-pc-runtime-postgres.sh`,
  exposed publicly as `Orb Repair` through both the Start Menu and Codex App
  project actions.
- `skincos-cloudflared-cs.service` now reads its config from
  `C:\CodexRuntime\cloudflared\cs` instead of `/etc/skincos`.
- Shared runtime mirrors now also exist for
  `C:\CodexRuntime\crm-api\env\crm-api.env` and
  `C:\CodexRuntime\booking-api\env\booking-api.env`.
- The machine-scoped support services `skincos-crm-api.service` and
  `skincos-booking-api.service` now run from shared repo entrypoints in
  `scripts/migration/` and persist runtime state in `C:\CodexRuntime\crm-api`
  and `C:\CodexRuntime\booking-api`.
- `skincos-cloudflared-cs.service` now uses the shared runtime home
  `C:\CodexRuntime\cloudflared\cs`, so no installed `skincos-*` unit still
  references `/etc/skincos`, `/srv/skincos`, or `/home/julia`.
- Shared support-service convergence can now be reapplied with
  `scripts/install-shared-support-system-services.sh`, and the latest legacy
  unit backup lives in
  `C:\CodexRuntime\n8n\rollback\legacy-services-20260706T194618`.
- Shell entrypoints were normalized for WSL/Bash and `.gitattributes` now
  enforces `LF` for `*.sh` and `*.command`.
- The local CRM launcher now repairs the shared-clone first boot by generating
  `modules/crm/web/dist/` when absent and syncing only non-secret local auth
  toggles into `modules/crm/web/.dev.vars` for Pages local.
- Strict preflight now passes all live/Cloudflare checks in Windows after
  authenticating `gh` as `jubenitogarcia`, and WSL `gh` now also resolves to
  the same GitHub account via `/home/julia/.config/gh/hosts.yml`.
- The shared clone is currently on branch `codex/julia/shared-bootstrap` at
  `5aad9549`; `origin/main` is `aeacbab2`, so the shared baseline is not yet a
  clean `main` checkout.
- The live `n8n` runtime is healthy and uses the local PostgreSQL database
  `n8n_runtime` as its active metadata store, not the legacy
  `C:\CodexRuntime\n8n\n8n-home\database.sqlite`.
- The four clinic orb workflows `WORKFLOW_01..04` are now imported into the
  live `n8n_runtime` project `sFC10b3Ypvv4LJFH` in inactive mode, with the
  `wa_n8n` schema applied and a rollback dump stored under
  `C:\CodexRuntime\n8n\exports\clinic-orb-live-20260707T001500Z\`.
- The live DB now contains the expected credentials `Postgres (Skincos)` and
  `Google Calendar (Skincos)`, but the imported Google credential came from a
  legacy export that still has no proven Calendar scope, so activation remains
  gated on credential review rather than on import itself.

## Operational Model

- Use this clone for shared context, code review, task planning, branch/worktree
  coordination, and clean implementation starts.
- Keep secrets outside `C:\CodexShared`. Local execution that needs `.env` or
  `.dev.vars` must use a private overlay or private clone per operator.
- When work spans multiple accounts, document progress here and update
  `TASKS.md` and `DECISIONS.md` before handing off.

## Known Constraints

- Existing production and migration-sensitive flows include Cloudflare Pages,
  Workers, D1, CRM, and tracking modules.
- Some historical configs referenced operator-specific `cloudflared`
  credential paths; the shared clone now uses documented placeholders instead.
- The shared tree itself is not yet in a final publishable baseline because the
  multi-account branch and LF normalization changes are still local.
- The old Windows checkout was removed from the user profile; the shared clone
  is now the only supported local collaboration base.
- The live n8n runtime state remains machine-scoped in `C:\CodexRuntime\n8n`
  and must stay outside `C:\CodexShared` even though the n8n code now lives
  under `modules\automations\n8n`.
- Shared runtime validation should fail if the orb stack reintroduces
  `/home/julia`, `/srv/skincos`, `/etc/skincos`, or `systemctl --user`
  references into its env files or installed units.
- Local health validation after the handoff succeeded for
  `http://127.0.0.1:5678/healthz`,
  `http://127.0.0.1:8788/meta-review/healthz`, and
  `https://orb.skincos.com.br/healthz`.
- Support-service health validation now also succeeds for
  `http://127.0.0.1:8099/health` and `http://127.0.0.1:8765/healthz` after the
  shared-runtime cutover.
- `Orb Validate` now retries health probes briefly after restart so a healthy
  warm boot does not fail only because the HTTP listener is still coming up.
- The current live `n8n` DB still contains unrelated workflows such as
  `Livia`, `Meta Ads – Report`, and `Harmonia`, alongside the newly imported
  clinic automation flows documented in
  `modules/automations/n8n/README.md`.
- A full orb business smoke still cannot be executed end-to-end on the live
  runtime because `GOOGLE_CALENDAR_ID` and `N8N_DEFAULT_TEST_PHONE` are still
  blank in `n8n-business.env`, and the imported Google credential has not yet
  been proven against Google Calendar scope.

## Next Recommended Steps

- Reconcile `codex/julia/shared-bootstrap` against `origin/main` so the shared
  repo can return to a clean baseline before destructive cleanup.
- Review and, if needed, reauthorize the imported `Google Calendar (Skincos)`
  credential against the real calendar scopes required by
  `WORKFLOW_02_AGENDAMENTO.json`.
- Fill the remaining manual business env values in
  `C:\CodexRuntime\n8n\env\n8n-business.env`, especially
  `GOOGLE_CALENDAR_ID` and `N8N_DEFAULT_TEST_PHONE`.
- Run the live functional smoke only after that final binding step:
  webhook inbound, Evolution inbound, and Google Calendar creation.
- Keep `scripts/install-shared-support-system-services.sh` as the canonical way
  to reapply `crm-api`, `booking-api`, and `cloudflared-cs` support services on
  the shared runtime model.
- Use `Orb Repair` instead of account-specific manual repair steps whenever the
  live `n8n` runtime drifts away from the Postgres contract in
  `C:\CodexRuntime\n8n\env\n8n.env`.
- Continue draining residual legacy references from docs and helper scripts that
  still mention `frontend/`, `backend/apps/meta-ads`, or
  `backend/apps/whatsapp`.
- Create per-task worktrees under `C:\CodexShared\Worktrees\skincos\...`.
- Keep Codex local state, logs, temp files, browser profiles, and env overrides
  in `%LOCALAPPDATA%\Codex\skincos\` for each operator.
- If a task needs local runtime secrets, keep them outside the shared tree and
  document only the variable names and expected source.
- Treat `C:\CodexShared\Projetos\skincos` as the only supported local code base
  for shared work on this machine.
