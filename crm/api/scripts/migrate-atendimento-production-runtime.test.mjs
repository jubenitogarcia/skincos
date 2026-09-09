import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
    ATENDIMENTO_PRODUCTION_PREREQUISITE_DEFERRED_RULES,
} from './migrate-atendimento-production.mjs'
import {
    CRM_CORE_PROJECTION_DELTA_MIGRATION_ID,
    CRM_CORE_PROJECTION_DELTA_PREREQUISITE_RELATIONS,
} from '../server/atendimento/crmCoreProjectionDeltaMigration.js'

const root = new URL('../../../', import.meta.url)
const read = (relative) => readFile(new URL(relative, root), 'utf8')

test('production migration runner defers only the fixed source-mirror set and uses the shared lock budget', async () => {
    const source = await read('crm/api/scripts/migrate-atendimento-production.mjs')
    assert.match(source, /ATENDIMENTO_MIGRATION_TARGETS\.PRODUCTION/)
    assert.match(source, /isStrictAtendimentoMigrationDestination\(normalizedUrl, target\)/)
    assert.match(source, /max: ATENDIMENTO_STAGING_MIGRATION_POOL_MAX/)
    assert.match(source, /ATENDIMENTO_PRODUCTION_MIGRATION_LOCK_UNAVAILABLE/)
    assert.match(source, /ATENDIMENTO_PRODUCTION_PREREQUISITE_DEFERRED_RULES/)
    assert.match(source, /PRODUCTION_SOURCE_MIRROR_NOT_PROVISIONED/)
    assert.match(source, /production_migration_deferrals/)
    assert.match(source, /!activeMigrationIds\.has\(migration\.id\)/)
    assert.match(source, /productionDeferralReport/)
    assert.match(source, /PRODUCTION_MIGRATION_ROLLBACK_STATE_UNKNOWN/)
    assert.doesNotMatch(source, /inspectAndPersistStagingDeferral/)
})

test('production defers the CRM Core delta schema only when its exact source mirror relations are absent', () => {
    const rule = ATENDIMENTO_PRODUCTION_PREREQUISITE_DEFERRED_RULES[CRM_CORE_PROJECTION_DELTA_MIGRATION_ID]
    assert.deepEqual(rule, {
        prerequisiteError: 'CRM_CORE_PROJECTION_DELTA_PREREQUISITES_MISSING',
        prerequisiteRelations: CRM_CORE_PROJECTION_DELTA_PREREQUISITE_RELATIONS,
    })
    assert.equal(Object.isFrozen(rule), true)
    assert.equal(Object.isFrozen(rule.prerequisiteRelations), true)
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
