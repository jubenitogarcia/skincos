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
- Windows keepalive: scheduled task `SkincosWslRuntimeKeepalive`; Linux service supervision remains under `systemd`.
- The runtime survived a full WSL shutdown/start cycle with state and sessions preserved. Orb, CRM, Booking, WhatsApp and both Cloudflare tunnels passed local/public health checks with zero service restarts after promotion.

## Backup and rollback

- Restore-verified Orb backup: `C:\CodexRuntime\backups\orb\daily\20260715T191707Z`; PostgreSQL and storage hashes were validated by a real restore.
- Scheduled backup owner: Windows task `SkincosOrbBackup`. It triggers a native
  `/var/backups/skincos/orb/daily` snapshot and publishes it to
  `C:\CodexRuntime\backups\orb\daily` only after restore, database checksum and
  storage checksum validation. `orb-backup.timer` is intentionally disabled.
- Cutover checkpoint: `C:\CodexRuntime\backups\runtime-cutover\20260715T182203Z`; retain it until the post-retirement observation window and next scheduled restore-verified backup complete.
- Native releases are immutable. Rollback repoints `/opt/skincos/current/*` to the prior release, restores the captured units/config and restarts only the affected services.
- Cross-filesystem transfer is Windows-owned. Do not recursively traverse `C:`
  from WSL or launch Windows transfer binaries from a Linux service.

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
