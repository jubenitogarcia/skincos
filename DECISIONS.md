# DECISIONS

## 2026-07-14 - Enforce a compact shared-code and runtime-state footprint

- Decision: keep shared code and tracked documentation under
  `C:\CodexShared`, live runtime and durable operator artifacts under
  `C:\CodexRuntime`, and only mandatory Windows/Codex session state in the
  user profile. Retire the top-level n8n rollback clone and the atendimento
  recovery only after validating current runtime backup, active state, secrets,
  services, and health endpoints.
- Why: rollback copies outside the active runtime duplicated sensitive state,
  obscured the canonical source, and consumed substantial local storage.
- Impact: a worktree may be removed only after it is clean and integrated.
  `npm run codex:footprint:audit` is the recurring read-only audit surface;
  CI blocks new operational references to the retired roots. Codex-managed
  worktrees and active App caches remain out of cleanup scope until closed.

## 2026-07-13 - Split durable operator artifacts from local authentication state

- Keep Codex authentication, browser profiles, private environment overlays,
  temporary files and WSL keepalive state under `%LOCALAPPDATA%\Codex\skincos\`.
- Store durable project artifacts for the sole human operator under the private
  `C:\CodexRuntime\operator\admin\skincos\` runtime tree. This includes local
  logs, reports, debug exports, checkpoints, evidence and local backups.
- The transition keeps directory junctions only as compatibility pointers; they
  do not duplicate data and must not become an alternate source of truth.

## 2026-07-02 - Shared base lives outside user profiles

- Decision: use `C:\CodexShared` as the shared Codex workspace root.
- Why: avoids per-user profile isolation and avoids using the synced `G:` drive
  as the primary Git collaboration base.
- Impact: shared clones, worktrees, and continuity docs live in a neutral path.

## 2026-07-02 - Keep the original skincos checkout as legacy

- Decision: do not move or rewrite `C:\Users\julia\skincos`.
- Why: the legacy checkout carries local state, caches, and migration residue.
- Impact: new shared collaboration starts from the clean clone only.

## 2026-07-03 - Remove the old skincos checkout after shared validation

- Decision: remove the legacy `C:\Users\julia\skincos` checkout once the shared
  clone passed local shared-clone smoke checks and cross-account validation.
- Why: the old profile checkout is no longer needed for supported development
  and keeping it around creates ambiguity about which tree is authoritative.
- Impact: `C:\CodexShared\Projetos\skincos` becomes the only supported local
  code base; if the root folder remains temporarily locked by the current
  session, it should be deleted as soon as the handle is released.

## 2026-07-02 - Secrets stay out of the shared area

- Decision: no `.env`, `.dev.vars`, `.codex`, `.cloudflared`, cookies, or
  tokens may be stored under `C:\CodexShared`.
- Why: multiple local Windows users have access to the shared tree.
- Impact: local runtime execution needs a private overlay or private clone.

## 2026-07-02 - Shared clones need per-user Git trust bootstrap

- Decision: every local Windows user must register shared clones and worktrees
  under `git config --global safe.directory` before using them normally.
- Why: Git blocks commands with `detected dubious ownership` when the clone is
  owned by a different Windows SID.
- Impact: cross-account onboarding must include a short Git bootstrap step.

## 2026-07-02 - Shared clone origin must point to GitHub, not a local checkout

- Decision: the shared `skincos` clone `origin` must use
  `https://github.com/jubenitogarcia/skincos.git`.
- Why: a shared clone cannot depend on `C:\Users\julia\skincos` being present on
  another Windows user.
- Impact: remote validation and future push/pull work become account-scoped
  GitHub operations instead of local-path coupling.

## 2026-07-03 - Shared local CRM boot must be self-healing on a clean clone

- Decision: the shared local CRM launcher must repair first-boot gaps by
  generating the CRM web `dist/` when absent and by syncing only non-secret
  local auth toggles into the module-local `.dev.vars`.
- Why: a clean shared clone does not carry prebuilt assets, and the Pages local
  shell was failing in WSL even though the real issue was missing dist plus a
  `LOCAL_AUTH_BYPASS=false` default being left behind in `.dev.vars`.
- Impact: `npm run codex:crm:site-smoke` and
  `npm run codex:crm:meta-ads-smoke` now work directly from the shared clone
  without depending on the legacy checkout.

## 2026-07-03 - Fold the shared n8n workspace into the skincos monorepo

- Decision: treat `C:\CodexShared\Projetos\skincos\modules\automations\n8n` as
  the canonical shared
  n8n code root and retire `C:\CodexShared\Projetos\n8n` as an active project
  path.
- Why: the `skincos` repo is becoming the umbrella workspace for the clinic's
  subprojects and tools, and keeping n8n as a sibling clone preserves
  ambiguity about where the live automation code belongs.
- Impact: runtime state still stays in `C:\CodexRuntime\n8n`, but systemd
  units, docs, bootstrap scripts, and operator workflows should resolve n8n
  code from `skincos\n8n`.

## 2026-07-14 - Decommission the retired top-level n8n rollback clone

- Decision: remove the former top-level `C:\CodexShared\Projetos\n8n` rollback
  clone after confirming a fresh runtime backup, active state and secret
  equivalence, and healthy services/endpoints.
- Why: the live services already run from
  `C:\CodexShared\Projetos\skincos\modules\automations\n8n`; a second source
  tree duplicated sensitive state and kept operational ambiguity alive.
- Impact: active automation work happens only from
  `skincos\modules\automations\n8n`; rollback is provided by Git history and
  the managed runtime backup contract, not a second local clone.

## 2026-07-03 - Adopt a modular envelope rooted at modules/platform/ops/archive

- Decision: reorganize `skincos` as a domain-first envelope with active product
  code under `modules/`, shared cross-cutting code under `platform/`,
  operational orchestration under `ops/`, and legacy material under `archive/`.
- Why: top-level technical roots like `backend/`, `frontend/`, and `n8n/`
  obscure business ownership and make the repo harder to navigate as the number
  of subprojects grows.
- Impact: new source-of-truth paths are module-centric, while `backend/` and
  `frontend/` become transitional roots to be emptied over time.

## 2026-07-03 - Move the first self-contained modules into the new envelope

- Decision: move the public website to `modules/site-public/website`, the CRM
  API to `modules/crm/api`, and the n8n automation workspace to
  `modules/automations/n8n` in the first migration wave.
- Why: these three blocks have clearer operational boundaries and reduce path
  ambiguity immediately without forcing a same-day rewrite of every remaining
  module.
- Impact: root scripts, local launchers, health checks, and systemd user units
  must resolve the new module paths; `frontend/`, `backend/apps/meta-ads`, and
  `backend/apps/whatsapp` remain transitional for later waves.

## 2026-07-03 - Complete the second envelope wave for CRM, Meta Ads, and WhatsApp

- Decision: move the CRM web app to `modules/crm/web`, Meta Ads to
  `modules/meta-ads/meta-ads`, and WhatsApp services to
  `modules/whatsapp/whatsapp`.
- Why: leaving those surfaces under `frontend/` and `backend/apps/*` preserved
  the same ambiguity the envelope was supposed to remove.
- Impact: root scripts, local launchers, health checks, capability maps, and
  shared workspace docs must now treat those module paths as canonical.

## 2026-07-06 - Run the live orb stack as machine-scoped system services

- Decision: the live orb stack must run only from `skincos-*` system units
  under `/etc/systemd/system`, with `User=skincos`, code in
  `C:\CodexShared\Projetos\skincos\modules\automations\n8n`, and runtime state
  in `C:\CodexRuntime\n8n`.
- Why: the previous hybrid model mixed `systemctl --user`, operator-specific
  homes, and legacy `/etc/skincos` or `/srv/skincos` state, which blocked true
  multi-account autonomy.
- Impact: `n8n.env`, `n8n-business.env`, and `evolution-api.env` in
  `C:\CodexRuntime\n8n\env\` are now the canonical live env contract for the
  orb stack, and validators should fail if orb services reintroduce
  `/home/julia`, `/srv/skincos`, `/etc/skincos`, or `systemctl --user`.

## 2026-07-06 - Publish shared operational shortcuts in the common Start Menu

- Decision: install the Skincos operational launchers in
  `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Skincos Codex`.
- Why: the workspace and runtime are now machine-shared, so bootstrap,
  contexto, ambiente local, and runtime live actions must be equally reachable
  from every local Windows account without depending on `npm` in Windows.
- Impact: shared operators use the same PowerShell/WSL launchers for setup,
  worktrees, local QA, and live orb operations.

## 2026-07-07 - Version only the Codex App environment definition inside .codex

- Decision: allow only `.codex/environments/environment.toml` to be committed
  in the shared `skincos` repo and keep all other `.codex` content ignored and
  per-user.
- Why: the Start Menu shortcuts are already machine-shared, but the Codex App
  top-bar actions need one portable project contract that works in both the
  shared clone and per-user worktrees without leaking auth, cache, or session
  state.
- Impact: opening either the shared clone or a worktree in Codex App now loads
  the same project actions, while `safe.directory`, Codex login, WSL bootstrap,
  GitHub auth, and recent-project lists remain account-scoped.

## 2026-07-08 - Expose the Espaço Facial external app scraper through Codex actions

- Decision: publish Codex App and Start Menu actions for the
  `app.espacofacial.com.br` scraper, but route its outputs, logs, Chrome
  profile and private env files to `%LOCALAPPDATA%\Codex\skincos\espacofacial-app\`
  instead of keeping runtime state under the repo.
- Why: the scraper is operationally useful for the primary operator, but its
  default `report/`, `debug/` and `chrome_profile/` folders would otherwise
  keep mutable automation state mixed with shared code.
- Impact: the operator can run setup, self-test, agenda delta sync and booking
  API listener directly from Codex buttons without polluting the repository
  with scraper state.

## 2026-07-07 - Publish one shared runtime repair path instead of relying on a principal account

- Decision: expose `Orb Repair` as the canonical shared entrypoint for
  PostgreSQL/runtime reconciliation, backed by
  `modules/automations/n8n/scripts/reconcile-mini-pc-runtime-postgres.sh`.
- Why: the multi-account mini-PC model breaks when Postgres repair knowledge
  exists only in one operator account or one “principal” Codex session.
- Impact: Start Menu shortcuts, Codex App project actions, and runbooks now
  point to the same repair flow, which reads only the `DB_POSTGRESDB_*`
  contract from `C:\CodexRuntime\n8n\env\n8n.env`, realigns the local
  PostgreSQL role/database/schema, restarts the orb stack, validates health,
  and stores redacted evidence under `C:\CodexRuntime\n8n\exports\repair-*`.

## 2026-07-06 - Drain the last orb user services from the human WSL account

- Decision: keep the `julia` WSL user manager free of live orb services and
  treat any residual `n8n.service`, `orb-proxy.service`,
  `cloudflared-orb.service`, `evolution-api.service`, or
  `mini-pc-watchdog.timer` there as legacy-only artifacts.
- Why: the shared mini-PC autonomy model breaks when the orb can still boot
  from `systemctl --user` instead of the machine-scoped `skincos-*` units.
- Impact: the live orb path is now singular, `Orb Validate` can enforce the
  absence of active user services, and rollback for the old unit files lives in
  `C:\CodexRuntime\n8n\rollback\`.

## 2026-07-06 - Move the cs Cloudflare tunnel config into CodexRuntime

- Decision: `skincos-cloudflared-cs.service` should read its config and
  credentials from `C:\CodexRuntime\cloudflared\cs`.
- Why: the `cs` tunnel is a machine-scoped live service, so keeping its
  supported config under `/etc/skincos` preserved an unnecessary legacy root.
- Impact: the remaining legacy service convergence now focuses on
  `crm-api` and `booking-api`, while the `cs` tunnel already follows the shared
  runtime model.

## 2026-07-06 - Run crm-api and booking-api from shared repo launchers

- Decision: `skincos-crm-api.service` and `skincos-booking-api.service` should
  run from shared repo launchers under `scripts/migration/`, with env and
  writable runtime state moved to `C:\CodexRuntime\crm-api` and
  `C:\CodexRuntime\booking-api`.
- Why: leaving those support services on `/srv/skincos` and `/etc/skincos`
  preserved the same single-account coupling that the shared orb convergence
  was meant to remove.
- Impact: all installed `skincos-*` system units now resolve code from
  `C:\CodexShared\Projetos\skincos` and machine-scoped state from
  `C:\CodexRuntime\...`, while legacy unit files remain only as rollback
  backups under `C:\CodexRuntime\n8n\rollback\`.

## 2026-07-06 - Reapply support services with a shared installer

- Decision: the canonical maintenance entrypoint for the non-orb support
  services is `scripts/install-shared-support-system-services.sh`.
- Why: the shared mini-PC model needs one repeatable installer for
  `crm-api`, `booking-api`, and `cloudflared-cs` instead of ad hoc manual
  edits under `/etc/systemd/system`.
- Impact: future convergence, repair, or reprovisioning of those units should
  happen from the repo, while service-specific env/config/state stays under
  `C:\CodexRuntime`.

## 2026-07-08 - Recover orb owner access in place instead of replacing the live instance

- Decision: recover `orb.skincos.com.br` owner access in place by backing up
  the live Postgres DB, clearing MFA for the existing owner row, issuing a
  temporary password only for recovery, and requiring an immediate manual
  password rotation in the n8n UI.
- Why: the live runtime already contained the correct owner account
  `julianbenitogarcia@gmail.com`; the failure mode was access recovery, not a
  missing owner or a need to replace the instance.
- Impact: owner access is restored without destroying workflows, credentials,
  projects, or shared runtime state, and the recovery evidence now lives under
  `C:\CodexRuntime\n8n\exports\owner-recovery-pre-*`.

## 2026-07-08 - Keep the admin WSL runtime on a recovered per-user BasePath until elevated normalization is worth it

- Decision: keep the `admin` account's imported `Ubuntu-24.04` WSL distro
  registered at
  `C:\Users\admin\AppData\Local\wsl\{aa973afc-c57c-49d3-810d-ff364865ce84}`
  for now, instead of forcing an immediate move back to `C:\WSL\Ubuntu-24.04`.
- Why: the original registry path pointed to a missing VHD location, and the
  original shared VHD path required elevated ACL repair that was outside the
  available token in this session. Copying the VHD into the active profile
  restored WSL immediately and unblocked the orb recovery.
- Impact: shared orb operations work again in the `admin` account, but a later
  elevated maintenance pass may still normalize the storage path if a single
  canonical WSL VHD location becomes important.

## 2026-07-06 - Import the clinic orb flows into the live Postgres runtime and keep them inactive

- Decision: import `WORKFLOW_01..04` and the expected `n8n` credentials into
  the live `n8n_runtime` PostgreSQL metadata store, but keep all four clinic
  workflows inactive until the Google Calendar binding is manually verified.
- Why: the live `skincos-n8n.service` uses PostgreSQL rather than the legacy
  SQLite file, and the recoverable Google OAuth export did not prove Calendar
  scope or provide the missing `GOOGLE_CALENDAR_ID`.
- Impact: the machine now has the clinic workflows, `wa_n8n` tables, and
  baseline credentials ready in the live DB, while activation and end-to-end
  smoke remain gated on final Google Calendar/OAuth review and test data.

## 2026-07-09 - Collapse the shared shortcut UX into seven domain launchers

- Decision: publish only seven top-level shared launchers in both the Codex App
  and the common Start Menu: `Workspace`, `Contexto`, `Local`, `EF App`,
  `Orb`, `EF App Caixa`, and `Orb Repair`.
- Why: the flat launcher list had grown large enough to make discovery and
  maintenance noisy, while almost every action already routed through the same
  shared PowerShell runner.
- Impact: the runner now owns interactive domain menus, new workflows can be
  added behind those menus without multiplying visible shortcuts, and the two
  direct favorites remain reserved for the most frequent and highest-impact
  operator actions.

## 2026-07-09 - Fold direct favorites back into the EF App and Orb menus

- Decision: remove `EF App Caixa` and `Orb Repair` from the top-level shortcut
  surfaces and keep them only as leaf actions inside `EF App` and `Orb`.
- Why: both actions were already first-class options inside their domain menus,
  so the extra top-level buttons added redundancy without improving coverage.
- Impact: the published launcher set is now `Workspace`, `Contexto`, `Local`,
  `EF App`, and `Orb`, while `EF App Caixa` and `Orb Repair` remain available
  through the same runner for internal routing and direct invocation when
  needed.
# 2026-07-11 - Single Windows/WSL operator with isolated service account

- Decision: `admin` is the only human Windows and WSL operator. Canonical paths
  remain under `C:\CodexShared` and `C:\CodexRuntime`; Linux `skincos` remains a
  non-interactive system-service identity.
- Why: the earlier multi-account model was retired, but moving canonical paths
  would add migration risk without improving isolation.
- Operational consequence: parallel Codex work uses worktrees, not additional
  OS users; execution persistence and backups are managed by system services.

## 2026-07-11 - Audit PostgreSQL-derived n8n runtime invariants

- Decision: validate and repair the `workflow_dependency` sequence and clear
  `activeVersionId` only from workflows already marked inactive.
- Why: the PostgreSQL migration preserved rows whose maximum dependency ID was
  ahead of the sequence and left five inactive workflows publish-linked. This
  caused duplicate-key errors and invalid activation attempts at every startup.
- Impact: `service:audit-executions` now blocks both regressions, while
  `service:repair-postgres-invariants` provides an idempotent checkpointed fix.

## 2026-07-11 - Anchor the WSL runtime from the Windows operator session

- Decision: keep `Ubuntu-24.04` alive with the per-user logon task
  `SkincosWslRuntimeKeepalive`, running `sleep infinity` as a non-privileged
  lifecycle anchor while Linux services continue under their own identities.
- Why: this host terminates the distro after Windows clients disconnect even
  while systemd units are enabled, causing cold starts and transient 502/1033.
- Impact: the orb stack remains resident between Codex actions and is still
  started and supervised by systemd after Windows logon.
