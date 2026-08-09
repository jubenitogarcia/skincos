import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../../../', import.meta.url)
const read = (relative) => readFile(new URL(relative, root), 'utf8')

test('production migration runner is strict, non-deferring, and uses the shared lock budget', async () => {
    const source = await read('crm/api/scripts/migrate-atendimento-production.mjs')
    assert.match(source, /ATENDIMENTO_MIGRATION_TARGETS\.PRODUCTION/)
    assert.match(source, /isStrictAtendimentoMigrationDestination\(normalizedUrl, target\)/)
    assert.match(source, /max: ATENDIMENTO_STAGING_MIGRATION_POOL_MAX/)
    assert.match(source, /ATENDIMENTO_PRODUCTION_MIGRATION_LOCK_UNAVAILABLE/)
    assert.match(source, /deferred: \[\]/)
    assert.doesNotMatch(source, /inspectAndPersistStagingDeferral/)
})

test('production migration wrapper binds immutable release, maintenance, backup, and lockdown', async () => {
    const source = await read('scripts/run-atendimento-production-migration.sh')
    const runner = await read('crm/api/scripts/run-atendimento-production-migration.mjs')
    assert.match(source, /crm\/api\/scripts\/run-atendimento-production-migration\.mjs/)
    assert.match(runner, /MIGRATOR_ENV_FILE = '\/etc\/skincos\/crm-clientes-production-migrator\.env'/)
    assert.match(source, /backup-atendimento-production\.sh/)
    assert.match(source, /lockdown-atendimento-production-runtime\.sh/)
    assert.match(source, /state.*maintenance/s)
    assert.match(source, /systemctl is-active --quiet/)
})

test('production provisioning pins the migrator connection limit and writes a private migrator env', async () => {
    const source = await read('scripts/provision-atendimento-production-readonly.sh')
    assert.match(source, /MIGRATOR_CONFIG=.*crm-clientes-production-migrator\.env/)
    assert.match(source, /alter role \$MIGRATOR_ROLE connection limit 3/)
    assert.match(source, /DATABASE_URL=postgresql:\/\/\$MIGRATOR_ROLE:/)
})
