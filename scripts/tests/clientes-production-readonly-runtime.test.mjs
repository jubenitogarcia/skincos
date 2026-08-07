import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

function assertNoDynamicShell(relative) {
  const text = read(relative)
  assert.doesNotMatch(text, /^\s*(?:source|\.)\s+[^\n]+/m, `${relative} must not load an env file as shell code`)
  assert.doesNotMatch(text, /^\s*eval\s+/m, `${relative} must not evaluate data as shell`)
  assert.doesNotMatch(text, /^\s*(?:exec\s+)?bash\s+-c\b/m, `${relative} must not create a shell command string`)
}

test('isolated Clientes unit starts only the dedicated read-only entrypoint', () => {
  const unit = read('ops/runtime/units/crm-atendimento-production.service')
  assert.match(unit, /Description=.*Clientes.*read-only/)
  assert.match(unit, /EnvironmentFile=-__CONFIG_ROOT__\/crm-clientes-production-readonly\.env/)
  assert.match(unit, /UnsetEnvironment=.*NODE_OPTIONS.*LD_PRELOAD/)
  assert.match(unit, /Environment=CRM_DOMAIN=atendimento/)
  assert.match(unit, /Environment=CRM_ATENDIMENTO_READ_ONLY=true/)
  assert.match(unit, /Environment=CRM_ATENDIMENTO_COMMERCIAL_WRITES_ENABLED=false/)
  assert.match(unit, /Environment=HARMONIA_WORKER_ENABLED=false/)
  assert.match(unit, /ExecStart=\/usr\/bin\/node __REPO_ROOT__\/crm\/api\/server\/atendimentoRuntime\.js/)
  assert.doesNotMatch(unit, /ExecStart=.*server\.js/)
  assert.doesNotMatch(unit, /ExecStart=.*bash/)
  assert.doesNotMatch(unit, /crm\.service/)
})

test('dedicated runtime cannot import the shared HTTP process or a worker', () => {
  const runtime = read('crm/api/server/atendimentoRuntime.js')
  assert.match(runtime, /createIsolatedAtendimentoRuntime/)
  assert.match(runtime, /\/internal\/readiness/)
  assert.match(runtime, /app\.get\('\/internal\/readiness', limitInternal/)
  assert.match(runtime, /app\.get\('\/internal\/metrics', limitInternal/)
  assert.match(runtime, /INTERNAL_RATE_LIMIT_MAX_REQUESTS = 60/)
  assert.match(runtime, /READ_ONLY_RUNTIME/)
  assert.doesNotMatch(runtime, /from '\.\/server\.js'/)
  assert.doesNotMatch(runtime, /from ['"].*\/workers\//)
  assert.doesNotMatch(runtime, /from ['"].*harmonia\/worker/)
})

test('native scripts parse fixed configuration without dynamic shell evaluation', () => {
  for (const relative of [
    'scripts/run-atendimento-staging-migration.sh',
    'scripts/refresh-atendimento-staging-quality.sh',
    'scripts/backup-atendimento-staging.sh',
    'scripts/provision-atendimento-staging.sh',
    'scripts/set-atendimento-staging-control.sh',
    'scripts/runtime/prepare-atendimento-staging-release.sh',
    'scripts/runtime/add-atendimento-staging-tunnel-route.sh',
    'scripts/runtime/install-atendimento-staging-service.sh',
    'scripts/provision-atendimento-production-readonly.sh',
    'scripts/set-atendimento-production-readonly-control.sh',
    'scripts/runtime/install-atendimento-production-service.sh',
    'scripts/runtime/install-atendimento-production-tunnel.sh',
    'scripts/runtime/route-atendimento-production-dns.sh',
    'scripts/runtime/prepare-atendimento-production-release.sh',
    'scripts/runtime/rollback-atendimento-production.sh',
    'scripts/validate-atendimento-staging-readonly.sh',
    'scripts/validate-atendimento-production-readonly.sh',
  ]) assertNoDynamicShell(relative)

  const migration = read('crm/api/scripts/run-atendimento-staging-migration.mjs')
  assert.match(migration, /MIGRATOR_ENV_FILE = '\/etc\/skincos\/crm-atendimento-staging-migrator\.env'/)
  assert.match(migration, /readLiteralEnvironment/)
  assert.doesNotMatch(migration, /process\.env\.DATABASE_URL/)

  const qualityRefresh = read('crm/api/scripts/run-atendimento-staging-quality-refresh.mjs')
  assert.match(qualityRefresh, /MIGRATOR_ENV_FILE = '\/etc\/skincos\/crm-atendimento-staging-migrator\.env'/)
  assert.match(qualityRefresh, /readLiteralEnvironment/)
  assert.doesNotMatch(qualityRefresh, /process\.env\.DATABASE_URL\s*\|\|/)
})

test('staging release, control and application role remain fixed and read-only', () => {
  const release = read('scripts/runtime/prepare-atendimento-staging-release.sh')
  const provision = read('scripts/provision-atendimento-staging.sh')
  const control = read('scripts/set-atendimento-staging-control.sh')
  const installer = read('scripts/runtime/install-atendimento-staging-service.sh')
  const unit = read('ops/runtime/units/crm-atendimento-staging.service')
  const retiredTunnel = read('scripts/runtime/add-atendimento-staging-tunnel-route.sh')

  assert.match(release, /readonly RELEASE_BASE='\/opt\/skincos\/releases'/)
  assert.match(release, /readonly NPM_CACHE='\/var\/lib\/skincos-runtime\/cache\/crm-api'/)
  assert.match(release, /assert_release_targets\(\)/)
  assert.match(release, /sudo -n \/usr\/bin\/rm -rf -- "\$STAGING"/)
  assert.doesNotMatch(release, /SKINCOS_RELEASE_BASE|CRM_NPM_CACHE/)

  assert.match(provision, /readonly CONTROL_DIR="\$CONFIG_DIR\/atendimento-staging"/)
  assert.match(provision, /readonly BACKUP_ROOT='\/var\/backups\/skincos\/clientes\/staging-control'/)
  assert.match(provision, /ATENDIMENTO_READINESS_TOKEN=\$readiness_token/)
  assert.match(provision, /"state":"maintenance"/)
  assert.match(provision, /"readOnly":true,"commercialContactWritesEnabled":false,"syntheticOnly":true/)
  assert.match(provision, /alter role \$APP_ROLE set default_transaction_read_only = on/)
  assert.match(provision, /revoke all privileges on database \$DB_NAME from \$APP_ROLE/)
  assert.match(provision, /revoke all privileges on all tables in schema crm_atendimento, crm_caixa, crm_sessions, harmonia from \$APP_ROLE/)
  assert.match(provision, /revoke all privileges on all sequences in schema crm_atendimento, crm_caixa, crm_sessions, harmonia from \$APP_ROLE/)
  assert.match(provision, /grant select on all tables in schema crm_atendimento, crm_caixa, crm_sessions, harmonia to \$APP_ROLE/)
  assert.doesNotMatch(provision, /grant select, insert, update, delete on all tables in schema [^\n]+ to \$APP_ROLE/)
  assert.doesNotMatch(provision, /grant usage, select, update on all sequences in schema [^\n]+ to \$APP_ROLE/)
  assert.doesNotMatch(provision, /CRM_API_PORT=8109/)

  assert.match(control, /readonly CONTROL_FILE='\/etc\/skincos\/atendimento-staging\/module-control\.json'/)
  assert.match(control, /readonly BACKUP_ROOT='\/var\/backups\/skincos\/clientes\/staging-control'/)
  assert.match(control, /commercialContactWritesEnabled":false/)
  assert.match(control, /dry_run=true/)
  assert.match(installer, /CONTROL_VALIDATOR="\$SOURCE_ROOT\/crm\/api\/scripts\/validate-atendimento-staging-control\.mjs"/)
  assert.match(installer, /CONTROL_FILE="\$CONFIG_ROOT\/atendimento-staging\/module-control\.json"/)
  assert.match(installer, /\"\$CONTROL_VALIDATOR\" --release-sha "\$RELEASE_SHA"/)
  assert.match(unit, /Environment=CRM_MODULE_CONTROL_FILE=__CONFIG_ROOT__\/atendimento-staging\/module-control\.json/)

  assert.match(retiredTunnel, /retired=true dedicated_staging_tunnel_required=true shared_restart=false/)
  assert.doesNotMatch(retiredTunnel, /CLOUDFLARED_CONFIG_PATH|ATENDIMENTO_STAGING_HOSTNAME|ATENDIMENTO_STAGING_SERVICE/)
  assert.doesNotMatch(retiredTunnel, /cloudflare-runtime\.service|systemctl/)
})

test('production database contract has a separate read-only app role without raw contact access', () => {
  const provision = read('scripts/provision-atendimento-production-readonly.sh')
  assert.match(provision, /DB_NAME='skincos_clientes_production'/)
  assert.match(provision, /MIGRATOR_ROLE='skincos_clientes_migrator_login'/)
  assert.match(provision, /APP_ROLE='skincos_clientes_ro'/)
  assert.match(provision, /default_transaction_read_only = on/)
  assert.match(provision, /alter default privileges for role \$MIGRATOR_ROLE/)
  assert.doesNotMatch(provision, /harmonia\.contacts/)
  assert.doesNotMatch(provision, /phone_raw/)
  assert.doesNotMatch(provision, /grant .*insert/i)
})

test('release, rollback and tunnel paths are immutable, fixed and isolated', () => {
  const release = read('scripts/runtime/prepare-atendimento-production-release.sh')
  const rollback = read('scripts/runtime/rollback-atendimento-production.sh')
  const tunnel = read('scripts/runtime/install-atendimento-production-tunnel.sh')
  const dns = read('scripts/runtime/route-atendimento-production-dns.sh')
  assert.match(release, /readonly RELEASE_BASE='\/opt\/skincos\/releases'/)
  assert.match(release, /readonly SOURCE_ROOT="\$RELEASE_BASE\/\$RELEASE_SHA\/source"/)
  assert.match(rollback, /readonly CONTROL_WRITER="\$SOURCE_ROOT\/scripts\/set-atendimento-production-readonly-control\.sh"/)
  assert.match(rollback, /shared_restart=false/)
  assert.match(tunnel, /readonly HOSTNAME='crm-atendimento\.skincos\.com\.br'/)
  assert.match(tunnel, /CREDENTIALS_FILE="\$CONFIG_DIR\/\$TUNNEL_ID\.json"/)
  assert.match(dns, /dns_change=false/)
  assert.match(read('ops/runtime/units/cloudflare-atendimento-production.service'), /ExecStart=\/usr\/bin\/cloudflared/)
})

test('production validation invokes only loopback health plus the fixed signed smoke', () => {
  const validation = read('scripts/validate-atendimento-production-readonly.sh')
  assert.match(validation, /http:\/\/127\.0\.0\.1:\$PORT\/health/)
  assert.match(validation, /atendimento-production-signed-smoke\.mjs/)
  assert.match(validation, /skincos_clientes_ro/)
  assert.doesNotMatch(validation, /^\s*(?:source|\.)\s+[^\n]+/m)
  assert.doesNotMatch(validation, /curl[^\n]*https?:\/\/(?!127\.0\.0\.1)/)
})

test('staging validation attests only the fixed loopback runtime and strict staging control', () => {
  const validation = read('scripts/validate-atendimento-staging-readonly.sh')
  assert.match(validation, /readonly PORT='8111'/)
  assert.match(validation, /readonly CONTROL_FILE='\/etc\/skincos\/atendimento-staging\/module-control\.json'/)
  assert.match(validation, /validate-atendimento-staging-control\.mjs/)
  assert.match(validation, /http:\/\/127\.0\.0\.1:\$PORT\/health/)
  assert.match(validation, /loopback_health=true/)
  assert.doesNotMatch(validation, /crm-atendimento-staging\.skincos\.com\.br|crm\.skincos\.com\.br|cloudflare-runtime\.service\s+(?:restart|stop|start)/)
  assert.doesNotMatch(validation, /^\s*(?:source|\.)\s+[^\n]+/m)
  assert.doesNotMatch(validation, /^\s*eval\s+/m)
})
