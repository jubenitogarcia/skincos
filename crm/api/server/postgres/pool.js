import fs from 'node:fs'
import pg from 'pg'

const pools = new Map()
const poolStates = new WeakMap()
const limits = {
    crm: { max: 8, connectionTimeoutMillis: 3_000, idleTimeoutMillis: 15_000 },
    atendimento: { max: 6, connectionTimeoutMillis: 3_000, idleTimeoutMillis: 15_000 },
    harmonia: { max: 4, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 10_000 },
    caixa: { max: 3, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 10_000 },
    tracking: { max: 2, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 10_000 },
    migration: { max: 1, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 5_000 },
}

function positive(value, fallback) {
    const parsed = Number.parseInt(String(value || ''), 10)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function strictTlsConfig(databaseUrl, env = process.env) {
    const url = new URL(databaseUrl)
    if (!url.hostname) throw new Error('POSTGRES_TLS_HOST_REQUIRED')
    if (url.searchParams.has('sslmode') || url.searchParams.has('sslrootcert')) {
        throw new Error('POSTGRES_TLS_QUERY_OPTIONS_FORBIDDEN')
    }
    const caFile = String(env.PGTLS_CA_FILE || '').trim()
    const servername = String(env.PGTLS_SERVER_NAME || '').trim()
    if (!caFile || !servername) throw new Error('POSTGRES_TLS_CA_AND_SERVER_NAME_REQUIRED')
    return { rejectUnauthorized: true, ca: fs.readFileSync(caFile, 'utf8'), servername }
}

export function createPgPool(databaseUrl, { domain = 'crm', env = process.env } = {}) {
    const url = String(databaseUrl || '').trim()
    if (!url) return null
    const defaults = limits[domain] || limits.crm
    const max = positive(env[`PG_POOL_MAX_${domain.toUpperCase()}`], defaults.max)
    const key = `${domain}:${url}`
    if (pools.has(key)) return pools.get(key)
    const pool = new pg.Pool({
        connectionString: url,
        ssl: strictTlsConfig(url, env),
        max,
        min: 0,
        connectionTimeoutMillis: positive(env.PG_CONNECT_TIMEOUT_MS, defaults.connectionTimeoutMillis),
        idleTimeoutMillis: positive(env.PG_IDLE_TIMEOUT_MS, defaults.idleTimeoutMillis),
        maxLifetimeSeconds: positive(env.PG_MAX_LIFETIME_SECONDS, 300),
        application_name: `skincos-${domain}`,
        options: `-c statement_timeout=${positive(env.PG_STATEMENT_TIMEOUT_MS, 3_000)} -c lock_timeout=${positive(env.PG_LOCK_TIMEOUT_MS, 1_000)} -c idle_in_transaction_session_timeout=${positive(env.PG_IDLE_TRANSACTION_TIMEOUT_MS, 5_000)}`,
    })
    const state = { errors: 0, lastErrorAt: null }
    poolStates.set(pool, state)
    pool.on('error', () => {
        state.errors += 1
        state.lastErrorAt = new Date().toISOString()
    })
    pools.set(key, pool)
    return pool
}

export function getPgPoolMetrics(pool) {
    if (!pool) return { configured: false, total: 0, idle: 0, waiting: 0 }
    const state = poolStates.get(pool) || { errors: 0, lastErrorAt: null }
    return { configured: true, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, errors: state.errors, lastErrorAt: state.lastErrorAt }
}

export async function getPgDatabaseMetrics(pool) {
    if (!pool) return { configured: false }
    const result = await pool.query(`
        select datname, numbackends, xact_commit, xact_rollback,
               blks_read, blks_hit, tup_returned, tup_fetched,
               tup_inserted, tup_updated, tup_deleted
        from pg_stat_database
        where datname = current_database()`)
    const row = result.rows[0]
    if (!row) return { configured: true, available: false }
    return { configured: true, available: true, ...row }
}

export async function withPgTransaction(pool, fn) {
    const client = await pool.connect()
    try {
        await client.query('begin')
        const out = await fn(client)
        await client.query('commit')
        return out
    } catch (e) {
        try { await client.query('rollback') } catch { /* preserve original error */ }
        throw e
    } finally {
        client.release()
    }
}
