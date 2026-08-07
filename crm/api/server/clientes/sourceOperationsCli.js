const SAFE_SOURCE_ID = /^[a-z][a-z0-9_.-]{2,120}$/
const SAFE_BACKUP_REFERENCE = /^[A-Za-z0-9._:-]{1,240}$/

function cliError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function one(values) {
    return values.length === 1 ? values[0] : null
}

/**
 * The native operator entry point deliberately has a tiny, typed grammar.
 * It neither passes arbitrary commands through to a connector nor accepts
 * filesystem paths or source identifiers outside the static catalogue.
 */
export function parseClientesSourceOperationsCommand(argv = [], { sourceIds = [] } = {}) {
    const args = Array.isArray(argv) ? argv.map((value) => String(value)) : []
    const actions = args.filter((arg) => ['--dry-run', '--apply', '--status', '--rollback'].includes(arg))
    const action = one(actions)
    if (!action) throw cliError('CLIENTES_SOURCE_OPERATIONS_COMMAND_INVALID')
    const sourceArg = one(args.filter((arg) => arg.startsWith('--source=')))
    const backupArg = one(args.filter((arg) => arg.startsWith('--backup=')))
    const known = new Set(sourceIds.map((value) => String(value)))
    const permitted = new Set([action])
    if (action === '--rollback') {
        if (!sourceArg || !backupArg) throw cliError('CLIENTES_SOURCE_OPERATIONS_ROLLBACK_ARGUMENTS_INVALID')
        permitted.add(sourceArg)
        permitted.add(backupArg)
        const sourceId = sourceArg.slice('--source='.length)
        const backupReference = backupArg.slice('--backup='.length)
        if (!SAFE_SOURCE_ID.test(sourceId) || !known.has(sourceId) || !SAFE_BACKUP_REFERENCE.test(backupReference)) {
            throw cliError('CLIENTES_SOURCE_OPERATIONS_ROLLBACK_ARGUMENTS_INVALID')
        }
        if (args.length !== permitted.size || args.some((arg) => !permitted.has(arg))) throw cliError('CLIENTES_SOURCE_OPERATIONS_COMMAND_INVALID')
        return { action: 'rollback', sourceId, backupReference }
    }
    if (sourceArg || backupArg || args.length !== 1) throw cliError('CLIENTES_SOURCE_OPERATIONS_COMMAND_INVALID')
    return { action: action.slice(2) }
}

export function sourceOperationsSafeResult(value = {}) {
    return {
        sourceId: String(value.sourceId || ''),
        status: String(value.status || 'missing'),
        freshness: String(value.freshness || 'missing'),
        lastExecution: value.lastExecution || null,
        lastSuccess: value.lastSuccess || null,
        lastApplied: value.lastApplied || null,
        nextExecution: value.nextExecution || null,
        recordsRead: Math.max(0, Number(value.recordsRead || 0)),
        recordsApplied: Math.max(0, Number(value.recordsApplied || 0)),
        divergences: Math.max(0, Number(value.divergences || 0)),
        snapshotComplete: value.snapshotComplete === true,
        errorCode: value.errorCode || null,
        retries: Math.max(0, Number(value.retries || 0)),
        required: value.required === true,
    }
}

export const __testables = { cliError }
