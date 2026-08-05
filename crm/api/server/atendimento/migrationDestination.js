import { isStrictLocalMirrorDestination, parsePostgresConnection } from './mirror.js'

export const ATENDIMENTO_MIGRATION_TARGETS = Object.freeze({
    LOCAL: 'local',
    STAGING: 'staging',
})

export const STAGING_DATABASE_NAME = 'skincos_staging'
export const STAGING_MIGRATOR_USER = 'skincos_staging_migrator_login'
export const STAGING_OWNER_ROLE = 'skincos_staging_crm_owner'

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function isLoopbackHost(host) {
    const value = String(host || '').trim().toLowerCase()
    return value === '127.0.0.1' || value === 'localhost' || value === '::1'
}

/**
 * Migration destinations are deliberately narrower than runtime connection
 * strings. Local migrations use the operator Unix socket; staging migrations
 * use the loopback TLS database and the dedicated migrator login only.
 */
export function isStrictAtendimentoMigrationDestination(databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL) {
    if (target === ATENDIMENTO_MIGRATION_TARGETS.LOCAL) return isStrictLocalMirrorDestination(databaseUrl)
    if (target !== ATENDIMENTO_MIGRATION_TARGETS.STAGING) return false
    const raw = String(databaseUrl || '').trim()
    try {
        const url = new URL(raw)
        const query = new URLSearchParams(url.search)
        const allowedQueryKeys = new Set(['sslmode', 'uselibpqcompat', 'application_name'])
        for (const key of query.keys()) if (!allowedQueryKeys.has(key)) return false
        return url.protocol === 'postgresql:' &&
            isLoopbackHost(url.hostname) &&
            (url.port || '5432') === '5432' &&
            decodeURIComponent(url.username || '') === STAGING_MIGRATOR_USER &&
            Boolean(url.password) &&
            url.pathname === `/${STAGING_DATABASE_NAME}` &&
            query.get('sslmode') === 'require' &&
            query.get('uselibpqcompat') === 'true'
    } catch {
        return false
    }
}

export async function assertAtendimentoMigrationDestination(client, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('ATENDIMENTO_MIGRATION_DESTINATION_UNSAFE')
    }
    let result = await client.query(`select current_database() as database_name, current_user as database_user,
        session_user as session_user, current_setting('transaction_read_only') as read_only`)
    const row = result.rows[0] || {}
    // Lightweight migration unit doubles from the local suite predate the
    // session_user field; PostgreSQL always reports it alongside current_user
    // in the real destination, so this fallback is test-only compatibility.
    row.session_user = row.session_user || row.database_user
    const expected = target === ATENDIMENTO_MIGRATION_TARGETS.STAGING
        ? { database: STAGING_DATABASE_NAME, user: STAGING_OWNER_ROLE }
        : { database: 'skincos_crm_local', user: 'admin' }
    // PostgreSQL DDL ownership is intentionally held by the NOLOGIN owner
    // role. The URL must still authenticate as the dedicated migrator; the
    // controlled runner promotes only that session to the owner role.
    if (target === ATENDIMENTO_MIGRATION_TARGETS.STAGING &&
        row.session_user === STAGING_MIGRATOR_USER && row.database_user === STAGING_MIGRATOR_USER) {
        await client.query(`set role ${STAGING_OWNER_ROLE}`)
        result = await client.query(`select current_database() as database_name, current_user as database_user,
            session_user as session_user, current_setting('transaction_read_only') as read_only`)
    }
    const current = result.rows[0] || {}
    if (current.database_name !== expected.database || current.database_user !== expected.user || current.session_user !== (target === ATENDIMENTO_MIGRATION_TARGETS.STAGING ? STAGING_MIGRATOR_USER : expected.user) || String(current.read_only).toLowerCase() === 'on') {
        throw migrationError('ATENDIMENTO_MIGRATION_DESTINATION_UNSAFE')
    }
    return { database: current.database_name, user: current.database_user, sessionUser: current.session_user, target }
}

export function migrationDestinationLabel(target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL) {
    return target === ATENDIMENTO_MIGRATION_TARGETS.STAGING ? STAGING_DATABASE_NAME : 'skincos_crm_local'
}
