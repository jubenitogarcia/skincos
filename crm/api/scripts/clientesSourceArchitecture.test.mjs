import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLIENTES_SOURCE_CATALOG } from '../server/clientes/sourceCatalog.js'
import { CLIENTES_SOURCE_JOB_CATALOG } from '../server/clientes/sourceJobs.js'
import { clientesSourceOperationsMigrationPlan, parseClientesSourceOperationsMigrationAction } from '../server/atendimento/clientesSourceOperationsMigration.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('catalog covers every Clientes source domain without PII fields', () => {
    assert.equal(CLIENTES_SOURCE_CATALOG.length, 9)
    for (const source of CLIENTES_SOURCE_CATALOG) {
        assert.match(source.id, /^[a-z][a-z0-9_.-]+$/)
        assert.ok(source.cadenceMs > 0)
        assert.equal(Object.prototype.hasOwnProperty.call(source, 'phone'), false)
        assert.equal(Object.prototype.hasOwnProperty.call(source, 'email'), false)
    }
    assert.deepEqual(new Set(CLIENTES_SOURCE_CATALOG.map((source) => source.domain)), new Set(['atendimento', 'cadastro', 'vendas', 'leads', 'consent', 'blocks', 'identity']))
    assert.deepEqual(new Set(CLIENTES_SOURCE_JOB_CATALOG.map((job) => job.id)), new Set(['clientes.optouts.ingestion', 'clientes.source.refresh', 'clientes.quality.refresh']))
})

test('HTTP process cannot import source worker and native launcher is fixed', () => {
    assert.doesNotMatch(read('crm/api/server.js'), /clientes-sources-worker|server\/clientes\/sourceService/)
    assert.match(read('crm/api/clientes-sources-worker.js'), /createClientesSourceOperationsService/)
    assert.doesNotMatch(read('scripts/runtime/run-clientes-source-operations-native.sh'), /\beval\b|bash\s+-c|npm\s+(install|ci|run)/i)
    assert.match(read('ops/runtime/units/crm-clientes-source-operations.service'), /Environment=CRM_CLIENTES_SOURCE_OPS_HOST=127\.0\.0\.1/)
})

test('migration is additive and non-destructive', () => {
    const plan = clientesSourceOperationsMigrationPlan()
    assert.deepEqual(plan.tables, ['clientes_source_runs', 'clientes_source_checkpoints', 'clientes_source_dead_letters'])
    assert.equal(plan.rollback.toLowerCase().includes('não destrutivo'), true)
    assert.equal(parseClientesSourceOperationsMigrationAction(['--dry-run']), 'dry-run')
    assert.throws(() => parseClientesSourceOperationsMigrationAction(['--apply', '--rollback']), (error) => error.code === 'CLIENTES_SOURCE_OPERATIONS_MIGRATION_ACTION_INVALID')
    const sql = read('crm/api/server/atendimento/migrations/20260806_clientes_source_operations_v1.up.sql')
    assert.doesNotMatch(sql, /delete\s+from|drop\s+table/i)
    assert.match(sql, /snapshot_complete/i)
    assert.match(sql, /idempotency_key\s+text\s+not\s+null\s+unique/i)
})
