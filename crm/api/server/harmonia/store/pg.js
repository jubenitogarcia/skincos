import pg from 'pg'
import { withRollbackTransaction } from '../../../../../shared/resilience/transaction.js'

const DEFAULTS = Object.freeze({ max: 8, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000, maxLifetimeSeconds: 900, statementTimeoutMs: 15_000, lockTimeoutMs: 3_000, idleTransactionTimeoutMs: 20_000 })
const positiveInt = (value, fallback, maximum = 120_000) => {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

function isLocalPostgres(url) {
    const host = url.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')
}

export function postgresConnectionOptions(databaseUrl, { domain = 'crm' } = {}) {
    const envKey = `POSTGRES_${domain.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_')}_DATABASE_URL`
    const url = String(process.env[envKey] || databaseUrl || '').trim()
    if (!url) return null
    const parsed = new URL(url)
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error(`POSTGRES_URL_INVALID:${domain}`)
    const local = isLocalPostgres(parsed)
    const sslmode = String(parsed.searchParams.get('sslmode') || '').toLowerCase()
    if (!local && ['disable', 'allow', 'prefer', 'no-verify'].includes(sslmode)) throw new Error(`POSTGRES_TLS_REQUIRED:${domain}`)
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'rejectUnauthorized']) parsed.searchParams.delete(key)
    const prefix = `POSTGRES_${domain.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_')}`
    const max = positiveInt(process.env[`${prefix}_POOL_MAX`], DEFAULTS.max, 32)
    const statementTimeoutMs = positiveInt(process.env[`${prefix}_STATEMENT_TIMEOUT_MS`], DEFAULTS.statementTimeoutMs)
    const lockTimeoutMs = positiveInt(process.env[`${prefix}_LOCK_TIMEOUT_MS`], DEFAULTS.lockTimeoutMs)
    const idleTransactionTimeoutMs = positiveInt(process.env[`${prefix}_IDLE_TRANSACTION_TIMEOUT_MS`], DEFAULTS.idleTransactionTimeoutMs)
    const connectionTimeoutMillis = positiveInt(process.env[`${prefix}_CONNECT_TIMEOUT_MS`], DEFAULTS.connectionTimeoutMillis)
    const idleTimeoutMillis = positiveInt(process.env[`${prefix}_IDLE_TIMEOUT_MS`], DEFAULTS.idleTimeoutMillis)
    const maxLifetimeSeconds = positiveInt(process.env[`${prefix}_MAX_LIFETIME_SECONDS`], DEFAULTS.maxLifetimeSeconds, 3_600)
    const ca = String(process.env.POSTGRES_CA_CERT || '').trim() || undefined
    return {
        connectionString: parsed.toString(),
        ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
        max,
        connectionTimeoutMillis,
        idleTimeoutMillis,
        maxLifetimeSeconds,
        application_name: `skincos-${domain}`,
        options: `-c statement_timeout=${statementTimeoutMs} -c lock_timeout=${lockTimeoutMs} -c idle_in_transaction_session_timeout=${idleTransactionTimeoutMs}`,
    }
}

export function createPgPool(databaseUrl, options = {}) {
    const config = postgresConnectionOptions(databaseUrl, options)
    if (!config) return null

    const { Pool } = pg
    return new Pool(config)
}

export const withPgTransaction = withRollbackTransaction
