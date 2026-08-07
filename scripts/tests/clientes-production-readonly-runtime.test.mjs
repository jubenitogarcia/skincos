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
    'scripts/provision-atendimento-production-readonly.sh',
    'scripts/set-atendimento-production-readonly-control.sh',
    'scripts/runtime/install-atendimento-production-service.sh',
    'scripts/runtime/install-atendimento-production-tunnel.sh',
    'scripts/runtime/route-atendimento-production-dns.sh',
    'scripts/runtime/prepare-atendimento-production-release.sh',
    'scripts/runtime/rollback-atendimento-production.sh',
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
