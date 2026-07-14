import pg from 'pg'

export function createPgPool(databaseUrl) {
    const url = String(databaseUrl || '').trim()
    if (!url) return null

    const { Pool } = pg
    return new Pool({
        connectionString: url,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
        max: 10,
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

