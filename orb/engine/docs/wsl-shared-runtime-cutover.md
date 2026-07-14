# WSL shared runtime cutover

## Historical Note

This document is kept for migration history and audited rollback only.
The supported day-to-day runtime path on this mini-PC is now:

- code in `C:\CodexShared\Projetos\skincos\modules\automations\n8n`
- state in `C:\CodexRuntime\n8n`
- live services in `skincos-*` system units

Do not use this cutover flow as the normal way to operate `orb.skincos.com.br`.

This phase moves the live WSL services from the legacy repo path
`/home/julia/Automation/n8n` to the shared clone while keeping secrets and
runtime state in `C:\CodexRuntime\n8n`, outside `C:\CodexShared`.

## Goal

- Code root for systemd services:
  `/mnt/c/CodexShared/Projetos/skincos/orb/engine`
- Machine runtime root: `/mnt/c/CodexRuntime/n8n`
- Env files: `/mnt/c/CodexRuntime/n8n/env`
- Evolution state: `/mnt/c/CodexRuntime/n8n/evolution-api`
- n8n database/config: `/mnt/c/CodexRuntime/n8n/n8n-home`
- Cloudflare tunnel files: `/mnt/c/CodexRuntime/n8n/cloudflared`

## Why this layout

- It preserves the shared clone as the cross-account source of truth.
- It avoids placing `.env`, `evolution-api/.env`, `instances`, `store`,
  `.n8n`, or tunnel credentials under `C:\CodexShared`.
- It keeps rollback simple because the legacy WSL clone remains untouched until
  live validation is complete.

## Preconditions

Run these steps from the Windows account that can actually access the WSL distro.
The current `dev` account used in validation does not have `Ubuntu-24.04`
installed, so it cannot execute the live cutover itself.

## Preflight

Inside WSL:

```bash
cd /mnt/c/CodexShared/Projetos/skincos/orb/engine
scripts/preflight-wsl-shared-runtime.sh --strict-live
```

The preflight fails if:

- the shared clone still contains `.env`, `evolution-api/.env`, `instances`, or
  `store`
- the legacy repo no longer has the source runtime files
- `~/.n8n` or `~/.cloudflared` are missing
- the rendered systemd units still contain unresolved placeholders

## Apply the cutover

```bash
cd /mnt/c/CodexShared/Projetos/skincos/orb/engine
scripts/cutover-wsl-shared-runtime.sh --apply
```

This does the following:

1. Stops the user services.
2. Copies `~/Automation/n8n/.env` to `/mnt/c/CodexRuntime/n8n/env/n8n.env`.
3. Copies `~/Automation/n8n/evolution-api/.env` to
   `/mnt/c/CodexRuntime/n8n/env/evolution-api.env`.
4. Copies `~/Automation/n8n/evolution-api/instances`, `store`,
   `~/Automation/n8n/binary-data`, `~/.n8n`, and `~/.cloudflared` to the
   machine runtime root.
5. Reinstalls the systemd user units so `WorkingDirectory` points at
   `/mnt/c/CodexShared/Projetos/skincos/orb/engine` while env/state paths point to
   `/mnt/c/CodexRuntime/n8n`.

The script does not delete the legacy WSL clone.

## Start and validate

```bash
cd /mnt/c/CodexShared/Projetos/skincos/orb/engine
scripts/cutover-wsl-shared-runtime.sh --apply --start-services
```

Or start services manually during a historical cutover replay:

```bash
systemctl --user start n8n.service
systemctl --user start orb-proxy.service
systemctl --user start cloudflared-orb.service
systemctl --user start evolution-api.service
systemctl --user start mini-pc-watchdog.timer
scripts/validate-mini-pc-stack.sh
```

## Rollback

If validation fails:

```bash
systemctl --user stop mini-pc-watchdog.timer cloudflared-orb.service orb-proxy.service n8n.service evolution-api.service
```

Then reinstall or restart the legacy stack from `/home/julia/Automation/n8n`.
The cutover script keeps `.before-shared-cutover.*` backups for machine-runtime
targets and does not delete the legacy repo, so rollback remains copy-based.
