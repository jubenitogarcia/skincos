import { importAtendimentoFromGoogleSheet } from '../atendimento/importer.js'
import { createAtendimentoStore } from '../atendimento/store.js'
import {
    assertClientesSourceRefreshDatabaseIdentity,
    assertClientesSourceRefreshDatabaseUrl,
    normalizeClientesSourceRefreshAction,
    normalizeClientesSourceRefreshTarget,
    sourceRefreshActor,
    summarizeClientesSourceRefresh,
} from '../atendimento/sourceRefresh.js'
import { createCommercialDataQualityStore } from '../atendimento/commercialDataQualityStore.js'

export const CLIENTES_CONTINUOUS_JOB_IDS = Object.freeze({
    OPT_OUT_INGESTION: 'clientes.opt_out_ingestion',
    SOURCE_UPDATE: 'clientes.source_update',
    QUALITY_REFRESH: 'clientes.quality_refresh',
})

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

function isTruthy(value) {
    return TRUE_VALUES.has(String(value || '').trim().toLowerCase())
}

function jobError(code, message = code) {
    const error = new Error(message)
    error.code = code
    return error
}

function positiveSeconds(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function requiredPool(pool) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
        throw jobError('DATABASE_NOT_CONFIGURED')
    }
    return pool
}

async function readDatabaseIdentity(pool) {
    const result = await pool.query('select current_database() as database_name, current_user')
    return result.rows[0] || {}
}

/**
 * Ingests only an aggregate opt-out snapshot. The worker never copies phone
 * numbers into its checkpoint and never turns a missing source row into
 * consent. Harmonia remains the consent source of truth.
 */
export async function runOptOutIngestion({ pool } = {}) {
    requiredPool(pool)
    const result = await pool.query(`select
        count(*)::int as opted_out_contacts,
        max(opted_out_at)::text as latest_opt_out_at
        from harmonia.contacts
        where opted_out_at is not null`)
    return {
        imported: Number(result.rows[0]?.opted_out_contacts || 0),
        latestOptOutAt: result.rows[0]?.latest_opt_out_at || null,
        source: 'harmonia.contacts',
    }
}

export async function runClientesSourceRefresh({
    pool,
    databaseUrl,
    env = process.env,
    importer = importAtendimentoFromGoogleSheet,
    storeFactory = createAtendimentoStore,
} = {}) {
    requiredPool(pool)
    const targetValue = String(env.CRM_CLIENTES_SOURCE_REFRESH_TARGET || '').trim()
    const target = normalizeClientesSourceRefreshTarget(targetValue)
    const action = normalizeClientesSourceRefreshAction(env.CRM_CLIENTES_SOURCE_REFRESH_ACTION || 'dry-run')
    assertClientesSourceRefreshDatabaseUrl(databaseUrl, target)
    if (action === 'apply' && !isTruthy(env.CRM_CLIENTES_SOURCE_REFRESH_APPLY_CONFIRMED)) {
        throw jobError('CLIENTES_SOURCE_REFRESH_APPLY_NOT_CONFIRMED')
    }

    const lockClient = await pool.connect()
    let lockAcquired = false
    try {
        const identity = assertClientesSourceRefreshDatabaseIdentity(await readDatabaseIdentity(pool), target)
        const lock = await lockClient.query(`select pg_try_advisory_lock(hashtext('skincos:clientes:source-refresh')) as acquired`)
        lockAcquired = lock.rows[0]?.acquired === true
        if (!lockAcquired) throw jobError('CLIENTES_SOURCE_REFRESH_IN_PROGRESS')

        const store = storeFactory({ pool, databaseUrl, schemaManaged: true })
        const result = await importer(store, {
            actor: sourceRefreshActor(target),
            dryRun: action === 'dry-run',
        })
        return summarizeClientesSourceRefresh({ target, action, identity, result })
    } finally {
        if (lockAcquired) {
            try { await lockClient.query(`select pg_advisory_unlock(hashtext('skincos:clientes:source-refresh'))`) } catch { /* release is best effort */ }
        }
        lockClient.release()
    }
}

export async function runQualityRefresh({
    pool,
    databaseUrl,
    env = process.env,
    qualityStoreFactory = createCommercialDataQualityStore,
} = {}) {
    requiredPool(pool)
    const target = normalizeClientesSourceRefreshTarget(String(env.CRM_CLIENTES_SOURCE_REFRESH_TARGET || '').trim())
    assertClientesSourceRefreshDatabaseUrl(databaseUrl, target)
    const identity = assertClientesSourceRefreshDatabaseIdentity(await readDatabaseIdentity(pool), target)
    const actor = {
        id: `clientes-quality-refresh-${target}`,
        username: `clientes-quality-refresh-${target}`,
        role: 'ADMIN',
        isGlobalAdmin: true,
        allowedModules: ['atendimento'],
    }
    const result = await qualityStoreFactory({ pool, databaseUrl }).refresh(actor)
    return {
        target,
        database: identity.database,
        refreshed: Number(result?.refreshed || 0),
        findings: Array.isArray(result?.findings) ? result.findings.length : 0,
        sourceFreshness: result?.sourceFreshness || {},
    }
}

export function createClientesContinuousJobs({
    pool,
    databaseUrl,
    env = process.env,
    optOutRunner = runOptOutIngestion,
    sourceRunner = runClientesSourceRefresh,
    qualityRunner = runQualityRefresh,
} = {}) {
    const interval = (key, fallback) => positiveSeconds(env[key], fallback) * 1000
    return [
        {
            id: CLIENTES_CONTINUOUS_JOB_IDS.OPT_OUT_INGESTION,
            intervalMs: interval('CRM_CONTINUOUS_JOB_OPTOUT_INTERVAL_SECONDS', 60),
            run: () => optOutRunner({ pool, databaseUrl, env }),
        },
        {
            id: CLIENTES_CONTINUOUS_JOB_IDS.SOURCE_UPDATE,
            intervalMs: interval('CRM_CONTINUOUS_JOB_SOURCE_INTERVAL_SECONDS', 900),
            run: () => sourceRunner({ pool, databaseUrl, env }),
        },
        {
            id: CLIENTES_CONTINUOUS_JOB_IDS.QUALITY_REFRESH,
            intervalMs: interval('CRM_CONTINUOUS_JOB_QUALITY_INTERVAL_SECONDS', 1800),
            run: () => qualityRunner({ pool, databaseUrl, env }),
        },
    ]
}

export const __testables = {
    isTruthy,
    positiveSeconds,
    jobError,
}
