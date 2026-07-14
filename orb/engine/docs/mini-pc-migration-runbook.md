# n8n mini-PC migration runbook

## Historical Note

This runbook documents the original migration from a MacBook-era stack.
It is no longer the supported operating guide for the current shared mini-PC
runtime. The supported baseline today is:

- repo: `C:\CodexShared\Projetos\skincos`
- orb code: `C:\CodexShared\Projetos\skincos\modules\automations\n8n`
- orb state: `C:\CodexRuntime\n8n`
- live services: `skincos-*` system units

Keep using this document only for historical context, audits, or rollback
analysis.

This runbook migrates the local MacBook stack to an Ubuntu mini-PC while reusing the existing Cloudflare Tunnel for `orb.skincos.com.br`.

Do not commit migration bundles, `.env` files, SQLite databases, Cloudflare credentials, logs, or backups. They contain secrets and live customer/runtime state.

## Current target state

- Public endpoint: `https://orb.skincos.com.br`
- Cloudflare tunnel: `orb` / `1fc962f3-41d2-4140-8a03-d10b6f4dc76c`
- Local n8n URL behind proxy: `http://127.0.0.1:5678`
- Orb proxy URL: `http://127.0.0.1:8788`
- n8n version pinned by bootstrap: `2.8.3`
- n8n runtime state to migrate: `~/.n8n/database.sqlite`, `~/.n8n/config`, `~/.n8n/storage`, `~/.n8n/nodes`
- Private overlay secrets/state to migrate: `N8N_ENV_FILE`, `EVOLUTION_ENV_FILE`, `EVOLUTION_INSTANCES_DIR`, `EVOLUTION_STORE_DIR`
- Cloudflare state to migrate: `~/.cloudflared/orb-config.yml`, `~/.cloudflared/1fc962f3-41d2-4140-8a03-d10b6f4dc76c.json`

## 1. Prepare GitHub from the MacBook

```bash
cd /Users/jubenitogarcia/Automation/n8n
git status --short --branch
npm run validate:mini-pc:local
git add .gitignore docs/mini-pc-migration-runbook.md scripts/bootstrap-mini-pc-ubuntu.sh scripts/install-mini-pc-systemd.sh scripts/prepare-mini-pc-migration-bundle.sh scripts/restore-mini-pc-migration-bundle.sh scripts/validate-mini-pc-stack.sh scripts/ensure-mini-pc-stack.sh systemd/user evolution-api/start-evolution-api.sh scripts/backup-n8n.sh package.json
git commit -m "ops: add mini-pc migration tooling"
git push
```

If `health/network-fallback.state` is dirty, treat it as runtime state. Do not stage it unless the only intended change is refreshing the tracked online timestamp.

## 2. Record the live baseline on the MacBook

```bash
curl -fsS --max-time 5 http://127.0.0.1:5678/healthz
curl -fsS --max-time 5 http://127.0.0.1:8788/meta-review/healthz
curl -fsS --max-time 10 https://orb.skincos.com.br/healthz
sqlite3 ~/.n8n/database.sqlite "PRAGMA quick_check; SELECT 'workflows', count(*) FROM workflow_entity; SELECT 'active_workflows', count(*) FROM workflow_entity WHERE active=1; SELECT 'credentials', count(*) FROM credentials_entity;"
cloudflared tunnel info orb
```

Confirm there is no unsaved browser draft in n8n before the final bundle. Local workflow JSON files are snapshots, not the source of truth.

## 3. Create the final migration bundle

For a rehearsal while the Mac keeps serving traffic:

```bash
scripts/prepare-mini-pc-migration-bundle.sh
```

For the real cutover window:

```bash
scripts/prepare-mini-pc-migration-bundle.sh --freeze-mac-launchd
```

The current n8n database and storage are large. If local disk space is low, write the bundle to an external disk or mounted destination:

```bash
BUNDLE_ROOT=/Volumes/External/n8n-migration scripts/prepare-mini-pc-migration-bundle.sh --freeze-mac-launchd
```

The final command stops the Mac LaunchAgents for n8n, orb-proxy, cloudflared-orb and Evolution API before backing up. Leave them stopped while the mini-PC is validated, so schedules and webhooks do not run on both machines.

Transfer the generated `migration-bundles/n8n-mini-pc-migration-*.tar.gz` to the mini-PC with SSH/rsync or encrypted removable media. Do not use GitHub for this bundle.

## 4. Bootstrap the mini-PC

On Ubuntu:

```bash
mkdir -p ~/Automation
cd ~/Automation
git clone git@github.com:jubenitogarcia/n8n.git
cd n8n
scripts/bootstrap-mini-pc-ubuntu.sh
```

This installs Ubuntu packages, nvm, Node `24.8.0`, Node `20.19.5`, `n8n@2.8.3`, repo dependencies, `cloudflared`, and systemd user units.

## 5. Restore secrets and runtime state

```bash
cd ~/Automation/n8n
scripts/restore-mini-pc-migration-bundle.sh /path/to/n8n-mini-pc-migration-YYYYMMDDTHHMMSSZ.tar.gz
```

When the source runtime already uses the shared-clone overlay model, the bundle
scripts restore `.env` and Evolution runtime state to the private overlay
paths, not into the repo checkout.

If `evolution-api/.env` points to a local PostgreSQL database instead of an external managed database, dump and restore that database separately before starting Evolution API.

## 6. Start services on the mini-PC

```bash
systemctl --user start n8n.service
systemctl --user start orb-proxy.service
systemctl --user start cloudflared-orb.service
systemctl --user start evolution-api.service
systemctl --user start mini-pc-watchdog.timer
```

The services are enabled by `scripts/install-mini-pc-systemd.sh`, so they should also start after reboot when user lingering is available. In the current shared-runtime model, this user-service flow is historical only.

## 7. Validate cutover

```bash
scripts/validate-mini-pc-stack.sh
```

Expected baseline after restore:

- SQLite `PRAGMA quick_check` returns `ok`.
- Workflow, active workflow and credential counts match the Mac baseline.
- `http://127.0.0.1:5678/healthz` returns `{"status":"ok"}`.
- `http://127.0.0.1:8788/meta-review/healthz` returns a configured proxy response.
- `https://orb.skincos.com.br/healthz` returns `{"status":"ok"}`.
- `cloudflared tunnel info orb` shows the mini-PC connector and no MacBook connector after the old connector times out.

Open the n8n editor after these checks and confirm the active workflows. Run only one controlled webhook/gatilho test before allowing the stack to operate normally.

## 8. Rollback

If validation fails:

```bash
systemctl --user stop mini-pc-watchdog.timer cloudflared-orb.service orb-proxy.service n8n.service evolution-api.service
```

On the MacBook:

```bash
cd /Users/jubenitogarcia/Automation/n8n
scripts/restart-orb-stack.sh
curl -fsS --max-time 10 https://orb.skincos.com.br/healthz
```

Keep the failed mini-PC logs and the final migration bundle for diagnosis.
