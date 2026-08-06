#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import { createClientesSourceOperationsStore } from '../server/clientes/sourceOperationsStore.js'
import { isClientesSourceRuntimeDestinationSafe } from '../server/clientes/sourceService.js'

const databaseUrl = String(process.env.DATABASE_URL || '').trim()
const target = String(process.env.CLIENTES_SOURCE_OPERATIONS_TARGET || 'local').trim().toLowerCase()
if (!databaseUrl || !isClientesSourceRuntimeDestinationSafe(databaseUrl, target)) throw new Error('CLIENTES_SOURCE_OPERATIONS_DATABASE_TARGET_UNSAFE')
const pool = createPgPool(databaseUrl)
if (!pool) throw new Error('CLIENTES_SOURCE_OPERATIONS_POOL_UNAVAILABLE')
try {
    const store = createClientesSourceOperationsStore({ pool })
    const [dependencies, sources] = await Promise.all([store.dependencyStatus(), store.getOperationalView({ now: new Date() })])
    console.log(JSON.stringify({ target, dependencies, sources }, null, 2))
} finally {
    await pool.end()
}
