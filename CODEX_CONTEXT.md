# CODEX_CONTEXT

## Canonical workspace

- Code: `C:\CodexShared\Projetos\skincos` on `main`; edit-bearing work uses `C:\CodexShared\Worktrees\skincos\admin\<task>`.
- Durable operator evidence: `C:\CodexRuntime\operator\admin\skincos`; secrets and mutable runtime state never belong in Git or `C:\CodexShared`.
- Human operator: Windows/WSL `admin`. Linux `skincos` is non-interactive and owns system services.
- Product roots are `ads`, `api`, `booking`, `crm`, `finance`, `integration`, `inventory`, `messaging`, `orb`, `service`, `social`, `website` and `workforce`; neutral code belongs in `shared`, infrastructure in `platform`/`ops`, and executable commands in `scripts`.

## Native runtime — validated 2026-07-15

- Source release: `/opt/skincos/current/source`, an atomic link to the reviewed `main` SHA. It is populated from a Windows-created, checksum-verified archive transferred through `\\wsl$`; services never execute from DrvFS or a worktree.
- WhatsApp release: `/opt/skincos/current/messaging-whatsapp`; the only supported implementation is `messaging/channels/whatsapp/engine`.
- Mutable state: `/var/lib/skincos-runtime`; private config/secrets: `/etc/skincos`; logs: `/var/log/skincos`; temporary runtime: `/var/tmp/skincos`.
- Active units: `orb`, `orb-proxy`, `messaging-whatsapp`, `crm`, `booking`, `cloudflare-orb` and `cloudflare-runtime`.
- Windows keepalive: scheduled task `SkincosWslRuntimeKeepalive`; its single
  anchor uses native cwd `/`, while Linux service supervision remains under
  `systemd`.
- The runtime survived a full WSL shutdown/start cycle with state and sessions preserved. Orb, CRM, Booking, WhatsApp and both Cloudflare tunnels passed local/public health checks with zero service restarts after promotion.

## Backup and rollback

- Restore-verified Orb backup: the newest timestamped directory under
  `C:\CodexRuntime\backups\orb\daily`; the scheduled publisher retains a
  snapshot only after a real PostgreSQL restore and storage hash validation
  succeed.
- Restore-verified lifecycle backup:
  `C:\CodexRuntime\backups\runtime\20260715T231622Z`; it contains private
  config, native Booking/CRM/WhatsApp state and PostgreSQL dumps. Restore tests
  recreated 37 WhatsApp tables and 17 CRM tables in temporary databases, and
  every Windows-published artifact matched its native SHA-256.
- Scheduled backup owner: Windows task `SkincosOrbBackup`. It triggers a native
  `/var/backups/skincos/orb/daily` snapshot and publishes it to
  `C:\CodexRuntime\backups\orb\daily` only after restore, database checksum and
  storage checksum validation. No WSL backup timer is installed.
- Cutover checkpoint: `C:\CodexRuntime\backups\runtime-cutover\20260715T182203Z`; it preserves the pre-cutover unit/config evidence while the active and prior immutable releases provide operational rollback.
- Native releases are immutable. Rollback repoints `/opt/skincos/current/*` to the prior release, restores the captured units/config and restarts only the affected services.
- Cross-filesystem transfer is Windows-owned. Do not recursively traverse `C:`
  from WSL or launch Windows transfer binaries from a Linux service.

## Preserved independent work

- The canonical `Meta Ads – Publish` contract was integrated by PR #840
  (`11417df9e362f82337882a4b57e87c98b1a21547`). Its tracked workflow export,
  Code-node sources, Token Vault gateway, migration, preflight and tests are
  the source of truth. The older `meta-ads-*` worktrees remain operator-owned
  historical worktrees and are not cleanup targets for unrelated tasks.
- The production workflow is intentionally inactive/manual. Its current live
  version is `825` (`4ec178e3-bc9d-4ed6-b481-eb9015777b2e`); the Token Vault
  production deployment is `beba53d9-67f3-495b-a002-5dc579463c29`. A final
  historical journal reconciliation and WhatsApp-notification delivery check
  remain tracked in `TASKS.md`; do not treat execution success alone as their
  proof.
- The native Orb source release currently resolves to
  `71ec3a8f63bd8fcaa6861ad1487baf6f1e1be59a`, which predates PR #840. The
  n8n definition and Worker are reconciled, but the runtime source release is
  not yet `main`; promote it only through the native release gate with an
  explicit production authorization and a rollback checkpoint.
- PR #674 (`codex/admin/github-codex-autonomy`) remains a deliberate draft for
  the optional GitHub autonomy broker; it is not part of the production
  runtime and has no deployment dependency.
- The detached worktree under `%USERPROFILE%\.codex\worktrees` is Codex
  App-managed state and is not a project cleanup target while the App owns it.

## Messaging and CRM contract

- Public/user-facing naming is `messaging-whatsapp`; supplier terminology is confined to internal configuration/adapters where required by the protocol.
- CRM delegates all WhatsApp operations to the native engine. It does not spawn alternate engines, load sessions from the repository, expose a host-restart endpoint, or mutate Git.
- The former HTTP CRM deploy/restart path is retired. `ENABLE_CRM_API_DEPLOY=false` is intentional on this host; native source promotion is the deployment source of truth. The optional GitHub CRM API workflow supports SSH only.
- CRM Pages deployment uses bounded Ponto smoke retries to allow Cloudflare propagation without masking persistent failures.

## Validation commands

- Context: `npm run codex:context:online`
- Architecture/security: `npm run architecture:test`, `npm run quality:security`
- Runtime: `backend/scripts/e2e.sh health` and `backend/scripts/e2e.sh smoke`
- Native cutover/recovery: `docs/runbooks/lifecycle-runtime-cutover.md`
- Shared workspace: `npm run codex:shared:validate`

## Remaining business-only follow-up

- The inactive clinic Orb workflows still require product-owned Google Calendar OAuth/scope confirmation, `GOOGLE_CALENDAR_ID` and safe test data before a real booking side effect is allowed.
- Never activate workflows or create a real booking merely to validate infrastructure.
