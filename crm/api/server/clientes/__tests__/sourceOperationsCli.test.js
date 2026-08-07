import assert from 'node:assert/strict'
import test from 'node:test'

import {
    parseClientesSourceOperationsCommand,
    sourceOperationsSafeResult,
} from '../sourceOperationsCli.js'

const SOURCE_IDS = ['atendimento.local_mirror', 'consent.harmonia_opt_outs']

test('source operations CLI accepts only an allowlisted action grammar', () => {
    assert.deepEqual(parseClientesSourceOperationsCommand(['--dry-run'], { sourceIds: SOURCE_IDS }), { action: 'dry-run' })
    assert.deepEqual(parseClientesSourceOperationsCommand(['--status'], { sourceIds: SOURCE_IDS }), { action: 'status' })
    assert.deepEqual(
        parseClientesSourceOperationsCommand(['--rollback', '--source=atendimento.local_mirror', '--backup=backup.synthetic.001'], { sourceIds: SOURCE_IDS }),
        { action: 'rollback', sourceId: 'atendimento.local_mirror', backupReference: 'backup.synthetic.001' },
    )
    assert.throws(
        () => parseClientesSourceOperationsCommand(['--apply', '--command=anything'], { sourceIds: SOURCE_IDS }),
        { code: 'CLIENTES_SOURCE_OPERATIONS_COMMAND_INVALID' },
    )
    assert.throws(
        () => parseClientesSourceOperationsCommand(['--rollback', '--source=unknown.source', '--backup=/tmp/unsafe'], { sourceIds: SOURCE_IDS }),
        { code: 'CLIENTES_SOURCE_OPERATIONS_ROLLBACK_ARGUMENTS_INVALID' },
    )
})

test('source operations CLI output contains operational aggregates only', () => {
    const result = sourceOperationsSafeResult({
        sourceId: 'atendimento.local_mirror', status: 'complete', freshness: 'healthy', recordsRead: 2, recordsApplied: 1,
        snapshotComplete: true, retries: 0, rawCustomer: 'must-not-appear', errorMessage: 'must-not-appear',
    })
    assert.deepEqual(result, {
        sourceId: 'atendimento.local_mirror', status: 'complete', freshness: 'healthy', lastExecution: null, lastSuccess: null,
        lastApplied: null, nextExecution: null, recordsRead: 2, recordsApplied: 1, divergences: 0, snapshotComplete: true,
        errorCode: null, retries: 0, required: false,
    })
    assert.doesNotMatch(JSON.stringify(result), /must-not-appear/)
})
