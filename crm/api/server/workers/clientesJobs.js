import { createCommercialDataQualityStore } from '../atendimento/commercialDataQualityStore.js'
import { createClinicalApprovalExpiryJob } from '../clinical/clinicalApprovalExpiryJob.js'
import { CLIENTES_SOURCE_CATALOG } from '../clientes/sourceCatalog.js'
import { createClientesSourceAdapters } from '../clientes/sourceAdapters.js'
import { createClientesSourceOperationsRunner } from '../clientes/sourceOperations.js'
import { createClientesSourceOperationsStore } from '../clientes/sourceOperationsStore.js'

export const CLIENTES_CONTINUOUS_JOB_IDS = Object.freeze({
    OPT_OUT_INGESTION: 'clientes.opt_out_ingestion',
    SOURCE_UPDATE: 'clientes.source_update',
    QUALITY_REFRESH: 'clientes.quality_refresh',
    CLINICAL_APPROVAL_EXPIRY: 'clientes.clinical_approval_expiry',
})

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const CLIENTES_SOURCE_OPERATION_TARGETS = new Set(['local', 'staging'])

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

function normalizedExecutionKey(value) {
    const key = String(value || '').trim()
    return key && /^[A-Za-z0-9._:-]{1,200}$/.test(key) ? key : null
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

export function normalizeClientesSourceOperationsTarget(value) {
    const target = String(value || '').trim().toLowerCase()
    if (!CLIENTES_SOURCE_OPERATION_TARGETS.has(target)) throw jobError('CLIENTES_SOURCE_OPERATIONS_TARGET_INVALID')
    return target
}

export function normalizeClientesSourceOperationsMode(value) {
    const mode = String(value || 'dry-run').trim().toLowerCase()
    if (!['dry-run', 'apply'].includes(mode)) throw jobError('CLIENTES_SOURCE_OPERATIONS_MODE_INVALID')
    return mode
}

export function assertClientesSourceOperationsDatabaseIdentity(identity = {}, targetValue) {
    const target = normalizeClientesSourceOperationsTarget(targetValue)
    const database = String(identity.database_name || identity.databaseName || '').trim()
    const user = String(identity.current_user || identity.currentUser || '').trim()
    if (target === 'local' && (database !== 'skincos_crm_local' || !user || user === 'postgres')) {
        throw jobError('CLIENTES_SOURCE_OPERATIONS_LOCAL_IDENTITY_UNSAFE')
    }
    if (target === 'staging' && (database !== 'skincos_staging' || !user || user === 'postgres')) {
        throw jobError('CLIENTES_SOURCE_OPERATIONS_STAGING_IDENTITY_UNSAFE')
    }
    return { target, database, user }
}

/**
 * Ingests only an aggregate opt-out snapshot. The worker never copies phone
 * numbers into its checkpoint and never turns a missing source row into
 * consent. Harmonia remains the consent source of truth.
 */
export async function runOptOutIngestion({ pool, executionKey } = {}) {
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
        executionKey: normalizedExecutionKey(executionKey),
    }
}

export async function runClientesSourceOperations({
    pool,
    databaseUrl,
    env = process.env,
    executionKey,
    catalog = CLIENTES_SOURCE_CATALOG,
    storeFactory = createClientesSourceOperationsStore,
    adaptersFactory = createClientesSourceAdapters,
    runnerFactory = createClientesSourceOperationsRunner,
} = {}) {
    requiredPool(pool)
    const target = normalizeClientesSourceOperationsTarget(env.CRM_CLIENTES_SOURCE_OPERATIONS_TARGET)
    const mode = normalizeClientesSourceOperationsMode(env.CRM_CLIENTES_SOURCE_OPERATIONS_MODE)
    const normalizedKey = normalizedExecutionKey(executionKey)
    if (!normalizedKey) throw jobError('CLIENTES_SOURCE_OPERATIONS_EXECUTION_KEY_REQUIRED')
    if (mode === 'apply' && (!isTruthy(env.CRM_CLIENTES_SOURCE_OPERATIONS_APPLY_ENABLED) || !isTruthy(env.CRM_CLIENTES_SOURCE_OPERATIONS_APPLY_CONFIRMED))) {
        throw jobError('CLIENTES_SOURCE_OPERATIONS_APPLY_DISABLED')
    }
    const identity = assertClientesSourceOperationsDatabaseIdentity(await readDatabaseIdentity(pool), target)
    const store = storeFactory({ pool, databaseUrl, catalog })
    const adapters = adaptersFactory({ pool, env })
    const runner = runnerFactory({
        catalog,
        adapters,
        store,
        target,
        applyEnabled: isTruthy(env.CRM_CLIENTES_SOURCE_OPERATIONS_APPLY_ENABLED),
        applyConfirmed: isTruthy(env.CRM_CLIENTES_SOURCE_OPERATIONS_APPLY_CONFIRMED),
    })
    const result = await runner.runDue({ executionKey: normalizedKey, mode })
    return {
        target,
        database: identity.database,
        mode,
        ready: result.ready === true,
        unhealthyRequired: Array.isArray(result.unhealthyRequired) ? result.unhealthyRequired : [],
        sources: (Array.isArray(result.results) ? result.results : []).map((item) => ({
            sourceId: item.sourceId,
            status: item.status,
            recordsRead: Number(item.recordsRead || 0),
            recordsApplied: Number(item.recordsApplied || 0),
            errorCode: item.error?.code || null,
        })),
        executionKey: normalizedKey,
    }
}

export async function runQualityRefresh({
    pool,
    databaseUrl,
    env = process.env,
    executionKey,
    qualityStoreFactory = createCommercialDataQualityStore,
} = {}) {
    requiredPool(pool)
    const target = normalizeClientesSourceOperationsTarget(env.CRM_CLIENTES_SOURCE_OPERATIONS_TARGET)
    const identity = assertClientesSourceOperationsDatabaseIdentity(await readDatabaseIdentity(pool), target)
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
        executionKey: normalizedExecutionKey(executionKey),
    }
}

export function createClientesContinuousJobs({
    pool,
    databaseUrl,
    env = process.env,
    optOutRunner = runOptOutIngestion,
    sourceRunner = runClientesSourceOperations,
    qualityRunner = runQualityRefresh,
    clinicalExpiryJobFactory = createClinicalApprovalExpiryJob,
} = {}) {
    const interval = (key, fallback) => positiveSeconds(env[key], fallback) * 1000
    return [
        {
            id: CLIENTES_CONTINUOUS_JOB_IDS.OPT_OUT_INGESTION,
            intervalMs: interval('CRM_CONTINUOUS_JOB_OPTOUT_INTERVAL_SECONDS', 60),
            run: (context) => optOutRunner({ pool, databaseUrl, env, executionKey: context?.executionKey }),
        },
        {
            id: CLIENTES_CONTINUOUS_JOB_IDS.SOURCE_UPDATE,
            // The durable source ledger applies each source's own cadence;
            // this small scheduler tick merely notices which source is due.
            intervalMs: interval('CRM_CONTINUOUS_JOB_SOURCE_INTERVAL_SECONDS', 60),
            run: (context) => sourceRunner({ pool, databaseUrl, env, executionKey: context?.executionKey }),
        },
        {
            id: CLIENTES_CONTINUOUS_JOB_IDS.QUALITY_REFRESH,
            intervalMs: interval('CRM_CONTINUOUS_JOB_QUALITY_INTERVAL_SECONDS', 1800),
            run: (context) => qualityRunner({ pool, databaseUrl, env, executionKey: context?.executionKey }),
        },
        clinicalExpiryJobFactory({ pool, databaseUrl, env }),
    ]
}

export const __testables = {
    isTruthy,
    positiveSeconds,
    normalizedExecutionKey,
    jobError,
    CLIENTES_SOURCE_OPERATION_TARGETS,
}
