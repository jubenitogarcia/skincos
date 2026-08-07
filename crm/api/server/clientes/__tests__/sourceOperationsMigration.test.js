import assert from 'node:assert/strict'
import test from 'node:test'

import {
    CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID,
    __testables,
    applyClientesSourceOperationsMigration,
    clientesSourceOperationsMigrationPlan,
} from '../sourceOperationsMigration.js'

test('source operations v2 migration is additive, PII-free and grants no destructive runtime privilege', () => {
    const plan = clientesSourceOperationsMigrationPlan()
    const sql = __testables.STATEMENTS.join('\n').toLowerCase()
    const grants = __testables.runtimeGrantStatements('staging').join('\n').toLowerCase()

    assert.equal(plan.id, CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID)
    assert.equal(plan.adds.includes('clientes_source_operation_checkpoints'), true)
    assert.match(plan.checkpointPolicy, /validated and applied/i)
    assert.match(plan.piiPolicy, /no source rows, names, phones, emails/i)
    assert.doesNotMatch(sql, /drop\s+trigger/)
    assert.doesNotMatch(sql, /error_message|error_details|jsonb.*coverage/)
    assert.match(sql, /before update or delete/)
    assert.match(sql, /before truncate/)
    assert.match(sql, /unique\(source_id, execution_key, mode\)/)
    assert.match(sql, /validated_fingerprint/)
    assert.match(sql, /resume_watermark/)
    assert.match(sql, /resume_cursor_hash/)
    assert.match(sql, /applied_fingerprint/)
    assert.match(sql, /encrypted boolean not null check \(encrypted\)/)
    assert.doesNotMatch(grants, /grant\s+(?:all privileges|delete|truncate)/)
    assert.match(grants, /revoke update, delete, truncate, references, trigger/)
    assert.match(grants, /select, insert, update on table crm_atendimento\.clientes_source_operation_runs/)
    assert.match(grants, /select, insert on table crm_atendimento\.clientes_source_operation_events/)
})

test('source operations v2 trigger readiness probes every immutable evidence table', () => {
    const readiness = __testables.triggerReadinessStatement()

    for (const relation of [
        'clientes_source_operation_events',
        'clientes_source_operation_backups',
        'clientes_source_operation_dead_letters',
        'clientes_source_operation_rollbacks',
    ]) {
        assert.match(readiness, new RegExp(relation))
    }
    assert.match(readiness, /prevent_clientes_source_operation_evidence_mutation/)
})

test('source operations v2 refuses an unsafe destination before opening a database connection', async () => {
    let connected = false
    await assert.rejects(
        () => applyClientesSourceOperationsMigration({
            pool: { connect: async () => { connected = true } },
            databaseUrl: 'postgresql://unsafe.example.invalid/skincos_crm_local',
            target: 'production',
        }),
        { code: 'CLIENTES_SOURCE_OPERATIONS_DESTINATION_UNSAFE' },
    )
    assert.equal(connected, false)
})
