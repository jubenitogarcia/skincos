# CODEX_CONTEXT

## Canonical workspace

- Code: `C:\CodexShared\Projetos\skincos` on `main`; edit-bearing work uses `C:\CodexShared\Worktrees\skincos\admin\<task>`.
- Durable operator evidence: `C:\CodexRuntime\operator\admin\skincos`; secrets and mutable runtime state never belong in Git or `C:\CodexShared`.
- Human operator: Windows/WSL `admin`. Linux `skincos` is non-interactive and owns system services.
- Product roots are `ads`, `api`, `booking`, `crm`, `finance`, `integration`, `inventory`, `messaging`, `service`, `social`, `website` and `workforce`; Orb/n8n is maintained in the independent repository `https://github.com/jubenitogarcia/orb`. Neutral code belongs in `shared`, infrastructure in `platform`/`ops`, and executable commands in `scripts`.
- Codex runs natively on Windows with PowerShell as its integrated terminal.
  Windows Node/Python support general agent tools; SKINCOS dependencies,
  builds, tests, Playwright, Wrangler and runtime operations remain in
  `Ubuntu-24.04` behind `scripts/invoke-skincos-wsl.ps1`.
- Do not create Windows project `node_modules` or `.venv` trees. The visible
  operator interface is PowerShell; Linux is an encapsulated backend.

## Native runtime — validated 2026-07-15

- Source release: `/opt/skincos/current/source`, an atomic link to the reviewed `main` SHA. It is populated from a Windows-created, checksum-verified archive transferred through `\\wsl$`; services never execute from DrvFS or a worktree.
- WhatsApp release: `/opt/skincos/current/messaging-whatsapp`; the only supported implementation is `messaging/channels/whatsapp/engine`.
- Mutable state: `/var/lib/skincos-runtime`; private config/secrets: `/etc/skincos`; logs: `/var/log/skincos`; temporary runtime: `/var/tmp/skincos`.
- SKINCOS-owned active units: `messaging-whatsapp`, `crm`, `booking` and `cloudflare-runtime`. Orb units and its database are owned by the independent repository.
- Windows keepalive: scheduled task `SkincosWslRuntimeKeepalive`; its single
  anchor uses native cwd `/`, while Linux service supervision remains under
  `systemd`.
- The SKINCOS runtime survived a full WSL shutdown/start cycle with state and sessions preserved. Orb health is observed separately and is not evidence of a SKINCOS release.

## Backup and rollback

- Restore-verified lifecycle backup:
  `C:\CodexRuntime\backups\runtime\20260715T231622Z`; it contains private
  config, native Booking/CRM/WhatsApp state and PostgreSQL dumps. Restore tests
  recreated 37 WhatsApp tables and 17 CRM tables in temporary databases, and
  every Windows-published artifact matched its native SHA-256.
- Orb backup owner, PostgreSQL restore and n8n encryption-key custody belong to
  the independent Orb repository and its private runtime. SKINCOS does not
  copy, publish or delete `C:\CodexRuntime\n8n` or Orb evidence.
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
  version is `830` (`b22ba74a-4fc9-428e-aa4e-41aebfd5b3f0`); the Token Vault
  production deployment is `beba53d9-67f3-495b-a002-5dc579463c29`. A current
  isolated Evolution test reached `DELIVERY_ACK`; Telegram remains independent.
  The historical journal has 110 terminal runs and zero active locks or
  `reconciliation_required` rows; see
  the independent Orb repository's retained execution ledger.
- Orb releases resolve to the independent repository's immutable release
  artifacts. Live workflow parity and the production cutover remain separate
  gates; the local JSON snapshots in either project are not live truth.
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
- Native SKINCOS-owned releases: the module-specific runbooks under `docs/runbooks/`
- Shared workspace: `npm run codex:shared:validate`

## Remaining business-only follow-up

- The inactive clinic workflows in the independent Orb repository still require
  product-owned Google Calendar OAuth/scope confirmation, `GOOGLE_CALENDAR_ID`
  and safe test data before a real booking side effect is allowed.
- Never activate workflows or create a real booking merely to validate infrastructure.
