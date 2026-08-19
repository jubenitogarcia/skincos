export const CLIENTES_SOURCE_REFRESH_TARGETS = Object.freeze({
    PRODUCTION: 'production',
    STAGING: 'staging',
})

function refreshError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

export function normalizeClientesSourceRefreshTarget(value) {
    const target = String(value || '').trim().toLowerCase()
    if (!Object.values(CLIENTES_SOURCE_REFRESH_TARGETS).includes(target)) {
        throw refreshError('CLIENTES_SOURCE_REFRESH_TARGET_INVALID')
    }
    return target
}

export function normalizeClientesSourceRefreshAction(value) {
    const action = String(value || '').trim().toLowerCase()
    if (!['dry-run', 'apply'].includes(action)) throw refreshError('CLIENTES_SOURCE_REFRESH_ACTION_INVALID')
    return action
}

export function assertClientesSourceRefreshDatabaseUrl(databaseUrl, targetValue) {
    const target = normalizeClientesSourceRefreshTarget(targetValue)
    const raw = String(databaseUrl || '').trim()
    if (!raw) throw refreshError('DATABASE_URL_NOT_CONFIGURED')

    if (target === CLIENTES_SOURCE_REFRESH_TARGETS.PRODUCTION) {
        if (!isDedicatedSourceRefreshUrl(raw, {
            database: 'skincos_clientes_production',
            user: 'skincos_clientes_migrator_login',
        })) {
            throw refreshError('CLIENTES_SOURCE_REFRESH_PRODUCTION_DATABASE_UNSAFE')
        }
        return { target, database: 'skincos_clientes_production' }
    }

    let parsed
    try {
        parsed = new URL(raw.replace(/^postgresql:/i, 'postgres:'))
    } catch {
        throw refreshError('CLIENTES_SOURCE_REFRESH_DATABASE_URL_INVALID')
    }
    const database = decodeURIComponent(String(parsed.pathname || '').replace(/^\//, ''))
    if (!isDedicatedSourceRefreshUrl(raw, {
        database: 'skincos_staging',
        user: 'skincos_staging_migrator_login',
    })) {
        throw refreshError('CLIENTES_SOURCE_REFRESH_STAGING_DATABASE_UNSAFE')
    }
    return { target, database }
}

export function assertClientesSourceRefreshDatabaseIdentity(identity = {}, targetValue) {
    const target = normalizeClientesSourceRefreshTarget(targetValue)
    const database = String(identity.database_name || identity.databaseName || '').trim()
    const user = String(identity.current_user || identity.currentUser || '').trim()
    if (target === CLIENTES_SOURCE_REFRESH_TARGETS.PRODUCTION) {
        if (database !== 'skincos_clientes_production' || user !== 'skincos_clientes_migrator_login') {
            throw refreshError('CLIENTES_SOURCE_REFRESH_PRODUCTION_IDENTITY_UNSAFE')
        }
    } else if (database !== 'skincos_staging' || user !== 'skincos_staging_migrator_login') {
        throw refreshError('CLIENTES_SOURCE_REFRESH_STAGING_IDENTITY_UNSAFE')
    }
    return { target, database, user }
}

export function sourceRefreshActor(targetValue) {
    const target = normalizeClientesSourceRefreshTarget(targetValue)
    return {
        id: `clientes-source-refresh-${target}`,
        username: `clientes-source-refresh-${target}`,
        role: 'ADMIN',
        allowedModules: ['atendimento'],
    }
}

export function summarizeClientesSourceRefresh({ target, action, identity, result }) {
    return {
        ok: true,
        target,
        action,
        database: identity?.database || null,
        databaseUser: identity?.user || null,
        dryRun: result?.dryRun === true,
        records: Number(result?.records || 0),
        inserted: Number(result?.inserted || 0),
        updated: Number(result?.updated || 0),
        skipped: Number(result?.skipped || 0),
        importBatchId: result?.importBatchId || null,
        spreadsheetId: result?.spreadsheetId || null,
        tabs: Array.isArray(result?.tabs) ? result.tabs : [],
    }
}

export { refreshError }

function isDedicatedSourceRefreshUrl(raw, { database, user }) {
    let parsed
    try {
        parsed = new URL(String(raw || '').replace(/^postgresql:/i, 'postgres:'))
    } catch {
        return false
    }
    const query = new URLSearchParams(parsed.search)
    const allowedQueryKeys = new Set(['sslmode', 'uselibpqcompat', 'application_name'])
    for (const key of query.keys()) if (!allowedQueryKeys.has(key)) return false
    return parsed.protocol === 'postgres:' &&
        ['127.0.0.1', 'localhost', '::1'].includes(String(parsed.hostname || '').toLowerCase()) &&
        (parsed.port || '5432') === '5432' &&
        decodeURIComponent(parsed.username || '') === user &&
        Boolean(parsed.password) &&
        decodeURIComponent(parsed.pathname || '').replace(/^\//, '') === database &&
        query.get('sslmode') === 'require' &&
        (!query.has('uselibpqcompat') || query.get('uselibpqcompat') === 'true')
}
