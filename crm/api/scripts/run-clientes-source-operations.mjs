#!/usr/bin/env node
import { randomUUID } from 'node:crypto'

import { createPgPool } from '../server/harmonia/store/pg.js'
import { CLIENTES_SOURCE_CATALOG, clientesSourceIds } from '../server/clientes/sourceCatalog.js'
import { createClientesSourceAdapters } from '../server/clientes/sourceAdapters.js'
import { sourceOperationsSafeResult, parseClientesSourceOperationsCommand } from '../server/clientes/sourceOperationsCli.js'
import { createClientesSourceOperationsRunner } from '../server/clientes/sourceOperations.js'
import { createClientesSourceOperationsStore } from '../server/clientes/sourceOperationsStore.js'
import {
    assertClientesSourceOperationsDatabaseIdentity,
    normalizeClientesSourceOperationsMode,
    normalizeClientesSourceOperationsTarget,
} from '../server/workers/clientesJobs.js'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const env = process.env
const isTruthy = (value) => TRUE_VALUES.has(String(value || '').trim().toLowerCase())
let pool

try {
    const command = parseClientesSourceOperationsCommand(process.argv.slice(2), { sourceIds: clientesSourceIds() })
    const target = normalizeClientesSourceOperationsTarget(env.CRM_CLIENTES_SOURCE_OPERATIONS_TARGET)
    const configuredMode = normalizeClientesSourceOperationsMode(env.CRM_CLIENTES_SOURCE_OPERATIONS_MODE)
    const databaseUrl = String(env.DATABASE_URL || '').trim()
    if (!databaseUrl) throw Object.assign(new Error('DATABASE_URL_NOT_CONFIGURED'), { code: 'DATABASE_URL_NOT_CONFIGURED' })
    const applyEnabled = isTruthy(env.CRM_CLIENTES_SOURCE_OPERATIONS_APPLY_ENABLED)
    const applyConfirmed = isTruthy(env.CRM_CLIENTES_SOURCE_OPERATIONS_APPLY_CONFIRMED)
    const mode = command.action === 'apply' ? 'apply' : command.action === 'dry-run' ? 'dry-run' : configuredMode
    if (mode === 'apply' && (!applyEnabled || !applyConfirmed)) {
        throw Object.assign(new Error('CLIENTES_SOURCE_OPERATIONS_APPLY_DISABLED'), { code: 'CLIENTES_SOURCE_OPERATIONS_APPLY_DISABLED' })
    }
    pool = createPgPool(databaseUrl)
    if (!pool) throw Object.assign(new Error('DATABASE_POOL_UNAVAILABLE'), { code: 'DATABASE_POOL_UNAVAILABLE' })
    const identityResult = await pool.query('select current_database() as database_name, current_user')
    const identity = assertClientesSourceOperationsDatabaseIdentity(identityResult.rows[0], target)
    const store = createClientesSourceOperationsStore({ pool, databaseUrl, catalog: CLIENTES_SOURCE_CATALOG })
    if (command.action === 'status') {
        const operational = await store.getOperationalView({ now: new Date() })
        process.stdout.write(`${JSON.stringify({ ok: true, action: 'status', target, database: identity.database, sources: operational.map(sourceOperationsSafeResult) })}\n`)
    } else {
        const adapters = createClientesSourceAdapters({ pool, env })
        const runner = createClientesSourceOperationsRunner({
            catalog: CLIENTES_SOURCE_CATALOG,
            adapters,
            store,
            target,
            applyEnabled,
            applyConfirmed,
        })
        const executionKey = `clientes-source-cli:${command.action}:${randomUUID()}`
        const result = command.action === 'rollback'
            ? await runner.rollbackSource(command.sourceId, { backupReference: command.backupReference, executionKey })
            : await runner.runDue({ executionKey, mode, force: true })
        const sources = command.action === 'rollback'
            ? [sourceOperationsSafeResult({ sourceId: result.sourceId, status: result.rolledBack ? 'partial' : 'invalid' })]
            : (Array.isArray(result.operational) ? result.operational.map(sourceOperationsSafeResult) : [])
        process.stdout.write(`${JSON.stringify({ ok: true, action: command.action, target, database: identity.database, mode: command.action === 'rollback' ? null : mode, ready: result.ready === true, sources })}\n`)
    }
} catch (error) {
    const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(String(error?.code || '')) ? error.code : 'CLIENTES_SOURCE_OPERATIONS_FAILED'
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`)
    process.exitCode = 1
} finally {
    if (pool) await pool.end()
}
