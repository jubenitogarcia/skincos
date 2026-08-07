import { createHash } from 'node:crypto'

import { createClinicalApprovalStore } from './clinicalApprovalStore.js'

export const CLINICAL_APPROVAL_EXPIRY_JOB_ID = 'clientes.clinical_approval_expiry'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const ALLOWED_TARGETS = new Set(['local', 'staging'])
const EXECUTION_KEY = /^[A-Za-z0-9._:-]{1,200}$/

function jobError(code, { retryable = false } = {}) {
    const error = new Error(code)
    error.code = code
    error.retryable = retryable
    return error
}

function enabled(value) {
    return TRUE_VALUES.has(String(value || '').trim().toLowerCase())
}

function exactTrue(value) {
    return String(value || '').trim().toLowerCase() === 'true'
}

function positiveSeconds(value, fallback) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 60) return fallback
    return Math.min(86_400, Math.floor(parsed))
}

export function normalizeClinicalApprovalExpiryTarget(value) {
    const target = String(value || '').trim().toLowerCase()
    if (!ALLOWED_TARGETS.has(target)) throw jobError('CLINICAL_APPROVAL_EXPIRY_TARGET_INVALID')
    return target
}

export function normalizeClinicalApprovalExpiryExecutionKey(value) {
    const key = String(value || '').trim()
    if (!EXECUTION_KEY.test(key)) throw jobError('CLINICAL_APPROVAL_EXPIRY_EXECUTION_KEY_INVALID')
    return key
}

/**
 * The scheduler's persisted execution key is the sole idempotency input. It
 * contains the job id and scheduled timestamp, never a patient or rule field.
 * A hash keeps the clinical command ledger's key bounded and opaque.
 */
export function clinicalApprovalExpiryIdempotencyKey({ target, executionKey } = {}) {
    const normalizedTarget = normalizeClinicalApprovalExpiryTarget(target)
    const normalizedKey = normalizeClinicalApprovalExpiryExecutionKey(executionKey)
    const digest = createHash('sha256')
        .update(`clinical-approval-expiry:v1:${normalizedTarget}:${normalizedKey}`)
        .digest('hex')
    return `clinical-expiry:${digest}`
}

export function clinicalApprovalExpiryActor(target) {
    const normalizedTarget = normalizeClinicalApprovalExpiryTarget(target)
    return Object.freeze({
        subject: `clinical-approval-expiry:${normalizedTarget}`,
        role: 'SYSTEM',
        source: 'continuous-worker',
    })
}

function disabledResult(target, reason) {
    return {
        ok: true,
        ready: true,
        enabled: false,
        target,
        skipped: reason,
        expired: 0,
    }
}

/**
 * Materializes only expiration transitions. It is deliberately not exposed as
 * an HTTP task and will not run in production or read-only runtimes. The
 * independent job runner supplies durable retry/dead-letter/lag metrics; this
 * function returns only aggregate operational data for that runner.
 */
export async function runClinicalApprovalExpiry({
    pool,
    databaseUrl,
    env = process.env,
    executionKey,
    storeFactory = createClinicalApprovalStore,
} = {}) {
    if (!enabled(env.CLINICAL_APPROVAL_EXPIRY_JOB_ENABLED)) {
        return disabledResult(null, 'job_disabled')
    }

    const target = normalizeClinicalApprovalExpiryTarget(env.CLINICAL_APPROVAL_EXPIRY_TARGET)
    if (exactTrue(env.CRM_ATENDIMENTO_READ_ONLY)) {
        throw jobError('CLINICAL_APPROVAL_EXPIRY_READ_ONLY')
    }
    if (!exactTrue(env.CLINICAL_APPROVAL_ENABLED)) {
        return disabledResult(target, 'clinical_domain_disabled')
    }

    const normalizedKey = normalizeClinicalApprovalExpiryExecutionKey(executionKey)
    const store = storeFactory({ pool, databaseUrl })
    if (!store || typeof store.expireDue !== 'function') {
        throw jobError('CLINICAL_APPROVAL_EXPIRY_STORE_UNAVAILABLE', { retryable: true })
    }

    const result = await store.expireDue(
        clinicalApprovalExpiryActor(target),
        clinicalApprovalExpiryIdempotencyKey({ target, executionKey: normalizedKey }),
    )
    const expired = Number(result?.expired)
    if (!Number.isInteger(expired) || expired < 0) {
        throw jobError('CLINICAL_APPROVAL_EXPIRY_RESULT_INVALID', { retryable: true })
    }
    return {
        ok: true,
        ready: true,
        enabled: true,
        target,
        expired,
        idempotent: result?.idempotent === true,
    }
}

export function createClinicalApprovalExpiryJob({
    pool,
    databaseUrl,
    env = process.env,
    runner = runClinicalApprovalExpiry,
} = {}) {
    return {
        id: CLINICAL_APPROVAL_EXPIRY_JOB_ID,
        intervalMs: positiveSeconds(env.CRM_CONTINUOUS_JOB_CLINICAL_EXPIRY_INTERVAL_SECONDS, 900) * 1000,
        // The clinical domain starts disabled. Its operational job must never
        // make the whole worker unready while the domain is deliberately off.
        required: false,
        run: (context = {}) => runner({
            pool,
            databaseUrl,
            env,
            executionKey: context.executionKey,
        }),
    }
}

export const clinicalApprovalExpiryJobTestHelpers = Object.freeze({
    enabled,
    exactTrue,
    positiveSeconds,
    jobError,
})
