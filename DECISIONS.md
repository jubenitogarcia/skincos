# DECISIONS

## 2026-07-15 - Keep the Windows WSL anchor on a native Linux working directory

- Decision: launch the single WSL keepalive client with `--cd /` and only reuse
  a process whose command line proves that native working directory.
- Why: inheriting `C:\Windows\System32` made the otherwise idle anchor report a
  DrvFS current directory, violating the final runtime contract even though no
  application state was read there.
- Impact: application services, the keepalive anchor and mutable runtime state
  have no working-directory dependency on `/mnt/c`; the Windows task remains
  the supported invisible lifecycle anchor.

## 2026-07-14 - Adopt direct domain roots and a single public API gateway

- Decision: use direct English product roots as defined in
  `docs/architecture/target-domain-map.md`; retain `shared`, `platform`,
  `ops`, `scripts`, `tools`, `docs` and `.github` as cross-cutting roots.
  `archive/` is not a destination for active or retired code.
- Decision: expose programmatic public routes only through
  `api.skincos.com.br/<domain>`. The gateway owns HTTP transport, request
  tracing and authorization envelopes, while each product owns its D1/R2 data,
  migrations and domain rules.
- Decision: migrate in independently reviewable waves. A path move does not
  authorize a service rename, runtime move, D1 migration, public route change
  or deletion. Each of those requires a checkpoint, CI and direct health
  evidence.
- Decision: Booking owns reservation state; `integration/ef` owns external
  browser/session execution; Orb orchestrates authenticated dispatch and
  recovery. The durable booking outbox is the recovery source, not a browser
  process or a best-effort webhook.

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
- Impact: this historical intermediate layout was later superseded by the
  native release/state contract recorded on 2026-07-15.

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

- Decision: move the public website to `website`, the CRM
  API to `crm/api`, and the n8n automation workspace to
  `orb/engine` in the first migration wave.
- Why: these three blocks have clearer operational boundaries and reduce path
  ambiguity immediately without forcing a same-day rewrite of every remaining
  module.
- Impact: root scripts, local launchers, health checks, and systemd user units
  must resolve the new module paths; `frontend/`, `backend/apps/meta-ads`, and
  `backend/apps/whatsapp` remain transitional for later waves.

## 2026-07-03 - Complete the second envelope wave for CRM, Meta Ads, and WhatsApp

- Decision: move the CRM web app to `crm/console`, Meta Ads to
  `ads/meta`, and WhatsApp services to
  `messaging/channels/whatsapp`.
- Why: leaving those surfaces under `frontend/` and `backend/apps/*` preserved
  the same ambiguity the envelope was supposed to remove.
- Impact: root scripts, local launchers, health checks, capability maps, and
  shared workspace docs must now treat those module paths as canonical.

## 2026-07-06 - Run the live orb stack as machine-scoped system services

- Decision: the live Orb stack must run only from machine-scoped system units
  under `/etc/systemd/system`, with `User=skincos`.
- Why: the previous hybrid model mixed `systemctl --user`, operator-specific
  homes, and legacy `/etc/skincos` or `/srv/skincos` state, which blocked true
  multi-account autonomy.
- Impact: validators must reject operator-home, checkout and user-service
  execution. The later native lifecycle decision supersedes the intermediate
  Windows-mounted state/config locations.

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
  idempotent native layout, unit and health reconciliation.
- Why: the multi-account mini-PC model breaks when Postgres repair knowledge
  exists only in one operator account or one “principal” Codex session.
- Impact: Start Menu shortcuts, Codex App project actions and runbooks point to
  the same native repair flow, which reapplies the final units, restarts the
  runtime and runs local/public health validation.

## 2026-07-06 - Drain the last Orb user services from the human WSL account

- Decision: keep the human WSL user manager free of live Orb services and
  remove all residual user-scoped runtime units after machine-unit validation.
- Why: the shared mini-PC autonomy model breaks when the orb can still boot
  from `systemctl --user` instead of the machine-scoped `skincos-*` units.
- Impact: the live path is singular and rollback is an immutable prior release
  plus the private cutover checkpoint.

## 2026-07-06 - Move the runtime Cloudflare tunnel out of the checkout

- Decision: the runtime tunnel must read private config and credentials outside
  the repository.
- Why: the `cs` tunnel is a machine-scoped live service, so keeping its
  supported config under `/etc/skincos` preserved an unnecessary legacy root.
- Impact: the remaining legacy service convergence now focuses on
  `crm-api` and `booking-api`, while the `cs` tunnel already follows the shared
  runtime model.

## 2026-07-06 - Run CRM and Booking from controlled launchers

- Decision: CRM and Booking should use controlled launchers with config and
  writable state outside the repository.
- Why: leaving those support services on `/srv/skincos` and `/etc/skincos`
  preserved the same single-account coupling that the shared orb convergence
  was meant to remove.
- Impact: this intermediate shared-checkout model was later superseded by
  immutable native releases and native state roots.

## 2026-07-06 - Reapply support services with a shared installer

- Decision: the canonical maintenance entrypoint is the final lifecycle unit
  installer under `scripts/runtime`.
- Why: the shared mini-PC model needs one repeatable installer for
  `crm-api`, `booking-api`, and `cloudflared-cs` instead of ad hoc manual
  edits under `/etc/systemd/system`.
- Impact: future convergence renders units from reviewed source while active
  config/state stays on native Linux and durable evidence stays private.

## 2026-07-08 - Recover orb owner access in place instead of replacing the live instance

- Decision: recover `orb.skincos.com.br` owner access in place by backing up
  the live Postgres DB, clearing MFA for the existing owner row, issuing a
  temporary password only for recovery, and requiring an immediate manual
  password rotation in the n8n UI.
- Why: the live runtime already contained the correct owner account
  `julianbenitogarcia@gmail.com`; the failure mode was access recovery, not a
  missing owner or a need to replace the instance.
- Impact: owner access was restored without destroying workflows, credentials
  or projects; its private recovery evidence remains outside Git.

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
- Why: the live Orb service uses PostgreSQL rather than the legacy
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

## 2026-07-15 - Make the native Linux lifecycle runtime authoritative

- Decision: run the seven final units from immutable releases under
  `/opt/skincos/current`, with mutable state in `/var/lib/skincos-runtime`,
  private configuration in `/etc/skincos` and logs in `/var/log/skincos`.
- Why: recursive DrvFS access produced I/O stalls and tied production to a
  checkout/worktree. Windows-to-Linux archives plus atomic release links give a
  verifiable, reversible boundary.
- Impact: no active service depends on `C:\CodexShared`, `/mnt/c`, or a Codex
  worktree; source promotion and state transfer are separate controlled steps.

## 2026-07-15 - Support one WhatsApp engine and forbid application-driven host recovery

- Decision: retain only `messaging/channels/whatsapp/engine`; CRM delegates to
  it and may retry a bounded upstream request, but may not spawn an engine,
  execute Git, or restart host services through HTTP.
- Why: the retired variants were unconsumed, carried high-severity scanner
  findings and preserved several conflicting state/runtime contracts.
- Impact: old source trees, local gateway routes, dashboards, scripts, HTTP
  restart workflows and their GitHub credential are retired. Host recovery is
  an authenticated operator/systemd operation with rollback evidence.

## 2026-07-15 - Make Windows the owner of native Orb backup publication

- Decision: `orb-backup.service` creates and restore-tests its snapshot entirely
  under `/var/backups/skincos`; the Windows task `SkincosOrbBackup` starts that
  unit and publishes the verified payload through `\\wsl.localhost` to
  `C:\CodexRuntime\backups`.
- Why: WSL system services cannot reliably launch Windows transfer binaries and
  must not recursively traverse `/mnt/c`. The previous timer failed with an
  interop `Invalid argument` before producing a new backup.
- Impact: the WSL timer is disabled, Task Scheduler owns the daily schedule,
  both database and storage hashes are revalidated after the Windows copy, ACLs
  remain limited to SYSTEM and the operator, and only a restore-verified backup
  is eligible for retention.

## 2026-07-15 - Retire migration launchers and make the native contract singular

- Decision: remove user units, one-time cutover transfer helpers, applied
  workflow patchers and old platform launchers after native restart, public
  smoke and restore proof succeeded.
- Why: preserving runnable historical paths made it possible to reintroduce
  checkout execution, DrvFS state, conflicting service names or a second backup
  scheduler.
- Impact: Git history and the private cutover checkpoint preserve audit and
  rollback evidence; current operations use only the lifecycle installer,
  native runtime manager, release builders and Windows-owned backup publisher.

## 2026-07-15 - Keep only publication, evidence and restore checkpoints on Windows

- Decision: after the native runtime passed restart and public smoke gates,
  remove mutable service trees from `C:\CodexRuntime`; retain only verified
  backups, private operator evidence and `config\orb\publish-backup.ps1`.
- Why: duplicated Booking, CRM, WhatsApp, tunnel and Orb state on NTFS no longer
  had an active consumer and could silently revive the retired DrvFS contract.
- Impact: native state is authoritative under `/var/lib/skincos-runtime` and
  `/etc/skincos`. Windows owns transfer/publication only; the final lifecycle
  backup includes private configuration, snapshots and real PostgreSQL restore
  proof before the duplicate trees are deleted.

## 2026-07-18 - Make Workforce Timekeeping canonical and D1-backed

- Decision: own Controle de Ponto in `workforce/timekeeping`, expose it only through the public `api` gateway and use its D1 as the sole operational persistence.
- Why: the CRM-local JSON backend could not provide durable concurrency, canonical employee identity, period snapshots or enforceable cross-unit authorization.
- Impact: CRM is a same-origin client/proxy; legacy JSON is import-only, corrections preserve original events, Escala links require explicit aliases, and staging must pass before the guarded production workflow can run.

## 2026-07-29 - Make the Meta Ads publish contract singular and manual

- Decision: treat the tracked Meta Ads workflow export, all mapped Code-node
  sources, the Token Vault gateway, contract revision, migration, preflight and
  regression tests as one atomic contract. Production changes use a
  version-checked workflow apply and a separately versioned Worker deployment.
- Why: direct editor changes and independent worktrees had allowed the live
  workflow, gateway and repository to drift, causing a previously successful
  path to regress on a later manual run.
- Impact: `Meta Ads – Publish` remains inactive and manual; `WHATSAPP_MESSAGE`
  is paired only with the WhatsApp handoff URL, while unit appointment URLs are
  retained as references. A run is not considered closed merely because n8n is
  green: Drive, journal, locks, readback and notification delivery each need
  explicit evidence.

## 2026-07-29 - Keep Meta Ads notifications local and reconcile journal evidence-first

- Decision: replace the Meta Ads success WhatsApp community-node call with a
  direct HTTP request to the local Evolution API, using private, Meta-specific
  instance and recipient configuration. Preserve Telegram as a separate
  parallel notification branch. Record historical journal closure through an
  immutable event before updating a provable terminal state.
- Why: a CRLF-contaminated environment value and an external public endpoint
  caused an avoidable connection failure. Historical rows cannot be treated as
  completed merely because their locks expired.
- Impact: the notification has bounded timeout/retries and can be tested with
  a synthetic message without invoking the commercial workflow or Meta. Runs
  without staging are closed only when operations prove no activation; staged
  runs remain `reconciliation_required` until a read-only Graph lookup is
  recorded.

## 2026-07-29 - Promote native Orb source only through a lineage-checked release

- Decision: promote the native Orb source from immutable archives only with
  `prepare-native-source-release.sh` followed by
  `promote-native-source-release.sh`; require the expected prior release SHA,
  private checkpoint and a no-active-publication drain before switching the
  `/opt/skincos/current/source` pointer.
- Why: this keeps the live process, proxy and application sidecars on one
  auditable source release and makes a pointer rollback independent from the
  shared Windows checkout.
- Impact: the 2026-07-29 promotion advanced
  `71ec3a8f63bd8fcaa6861ad1487baf6f1e1be59a` to
  `0c0a4fa0f4c2d0b432d449c0ba154e093b3ffe89` (including PRs #840/#844).
  The preparer grants `postgres` read/traverse access only to the immutable
  Meta Ads preflight surface, so the peer-authenticated audit can validate all
  49 Code nodes without exposing writable source or credentials.
