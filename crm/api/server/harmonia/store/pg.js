import pg from 'pg'

export function createPgPool(databaseUrl, options = {}) {
    const url = String(databaseUrl || '').trim()
    if (!url) return null
    const max = Number(options?.max ?? 10)
    if (!Number.isSafeInteger(max) || max < 1) throw new Error('PG_POOL_MAX_INVALID')

    const { Pool } = pg
    return new Pool({
        connectionString: url,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
        max,
    })
}

export async function withPgTransaction(pool, fn) {
    const client = await pool.connect()
    try {
        await client.query('begin')
        const out = await fn(client)
        await client.query('commit')
        return out
    } catch (e) {
        try { await client.query('rollback') } catch { /* ignore */ }
        throw e
    } finally {
        client.release()
    }
}
