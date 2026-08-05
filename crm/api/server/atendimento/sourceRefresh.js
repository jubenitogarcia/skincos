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
        if (!/^postgres(?:ql)?:\/\/skincos@\/skincos_crm_local\?(?:[^#]*&)?host=\/var\/run\/postgresql(?:&|$)/i.test(raw)) {
            throw refreshError('CLIENTES_SOURCE_REFRESH_PRODUCTION_DATABASE_UNSAFE')
        }
        return { target, database: 'skincos_crm_local' }
    }

    let parsed
    try {
        parsed = new URL(raw.replace(/^postgresql:/i, 'postgres:'))
    } catch {
        throw refreshError('CLIENTES_SOURCE_REFRESH_DATABASE_URL_INVALID')
    }
    const database = decodeURIComponent(String(parsed.pathname || '').replace(/^\//, ''))
    if (database !== 'skincos_staging' || parsed.hostname !== '127.0.0.1' ||
        parsed.port && parsed.port !== '5432' ||
        !new URLSearchParams(parsed.search).has('sslmode') ||
        new URLSearchParams(parsed.search).get('sslmode') !== 'require') {
        throw refreshError('CLIENTES_SOURCE_REFRESH_STAGING_DATABASE_UNSAFE')
    }
    return { target, database }
}

export function assertClientesSourceRefreshDatabaseIdentity(identity = {}, targetValue) {
    const target = normalizeClientesSourceRefreshTarget(targetValue)
    const database = String(identity.database_name || identity.databaseName || '').trim()
    const user = String(identity.current_user || identity.currentUser || '').trim()
    if (target === CLIENTES_SOURCE_REFRESH_TARGETS.PRODUCTION) {
        if (database !== 'skincos_crm_local' || user !== 'skincos') {
            throw refreshError('CLIENTES_SOURCE_REFRESH_PRODUCTION_IDENTITY_UNSAFE')
        }
    } else if (database !== 'skincos_staging' || !user || user === 'postgres') {
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
