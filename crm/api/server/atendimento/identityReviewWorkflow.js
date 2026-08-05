import { createHash } from 'node:crypto'

export const IDENTITY_REVIEW_TYPES = new Set([
    'attendance_name_merge',
    'attendance_caixa',
    'app_attendance',
    'app_caixa',
    'lead_app',
    'lead_caixa',
])

export const IDENTITY_REVIEW_SOURCE_TYPES = new Set([
    'attendance_client',
    'caixa_customer',
    'app_registration',
    'lead_profile',
])

// All importers and the human review workflow take this transaction lock
// before changing the current global-identity projection.  Source-specific
// locks remain in place for their own run bookkeeping.
export const IDENTITY_GRAPH_LOCK_KEY = 'crm_atendimento.identity_graph_materialization'

export function identityReviewError(code, statusCode = 400) {
    const error = new Error(code)
    error.statusCode = statusCode
    return error
}

function compact(value) {
    return String(value ?? '').trim()
}

export function normalizeIdentityReviewDecision(payload = {}) {
    const reviewType = compact(payload.reviewType || payload.type)
    const sourceId = compact(payload.sourceId)
    const targetId = compact(payload.targetId)
    const decision = compact(payload.decision).toLowerCase()
    const expectedVersion = compact(payload.expectedVersion)
    const reason = compact(payload.reason).replace(/\s+/g, ' ')
    const survivorClientId = compact(payload.survivorClientId)

    if (!IDENTITY_REVIEW_TYPES.has(reviewType)) throw identityReviewError('INVALID_IDENTITY_REVIEW_TYPE')
    if (!sourceId || !targetId || sourceId.length > 320 || targetId.length > 320 || sourceId === targetId) {
        throw identityReviewError('INVALID_IDENTITY_REVIEW_REFERENCE')
    }
    if (decision !== 'confirmed' && decision !== 'rejected') throw identityReviewError('INVALID_IDENTITY_REVIEW_DECISION')
    if (!expectedVersion || expectedVersion.length > 200) throw identityReviewError('IDENTITY_REVIEW_VERSION_REQUIRED')
    if (reason.length < 3 || reason.length > 1000) throw identityReviewError('IDENTITY_REVIEW_REASON_REQUIRED')
    if (reviewType === 'attendance_name_merge') {
        if (decision === 'confirmed' && survivorClientId !== sourceId && survivorClientId !== targetId) {
            throw identityReviewError('IDENTITY_REVIEW_SURVIVOR_REQUIRED')
        }
        if (decision === 'rejected' && survivorClientId) throw identityReviewError('IDENTITY_REVIEW_SURVIVOR_NOT_ALLOWED')
    } else if (survivorClientId) {
        throw identityReviewError('IDENTITY_REVIEW_SURVIVOR_NOT_ALLOWED')
    }
    return { reviewType, sourceId, targetId, decision, expectedVersion, reason, survivorClientId: survivorClientId || null }
}

export function normalizeIdentityReviewUndo(payload = {}) {
    const reviewType = compact(payload.reviewType || payload.type)
    const sourceId = compact(payload.sourceId)
    const targetId = compact(payload.targetId)
    const expectedVersion = compact(payload.expectedVersion)
    const reason = compact(payload.reason).replace(/\s+/g, ' ')
    if (!IDENTITY_REVIEW_TYPES.has(reviewType)) throw identityReviewError('INVALID_IDENTITY_REVIEW_TYPE')
    if (!sourceId || !targetId || sourceId.length > 320 || targetId.length > 320 || sourceId === targetId) {
        throw identityReviewError('INVALID_IDENTITY_REVIEW_REFERENCE')
    }
    if (!expectedVersion || expectedVersion.length > 200) throw identityReviewError('IDENTITY_REVIEW_VERSION_REQUIRED')
    if (reason.length < 3 || reason.length > 1000) throw identityReviewError('IDENTITY_REVIEW_REASON_REQUIRED')
    return { reviewType, sourceId, targetId, expectedVersion, reason }
}

function canonicalize(value) {
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    }
    return value
}

export function identityMaterializationFingerprint(value) {
    return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export function chooseIdentitySurvivor(identities = []) {
    const candidates = identities.filter((identity) => identity?.id)
    if (!candidates.length) return null
    return [...candidates].sort((left, right) => {
        const leftHasAttendance = Array.isArray(left.members) && left.members.some((member) => member.sourceType === 'attendance_client')
        const rightHasAttendance = Array.isArray(right.members) && right.members.some((member) => member.sourceType === 'attendance_client')
        if (leftHasAttendance !== rightHasAttendance) return leftHasAttendance ? -1 : 1
        const leftCreated = new Date(left.createdAt || 0).getTime() || 0
        const rightCreated = new Date(right.createdAt || 0).getTime() || 0
        if (leftCreated !== rightCreated) return leftCreated - rightCreated
        return String(left.id).localeCompare(String(right.id))
    })[0]
}

export function reviewComponentKey(members = []) {
    return members
        .map((member) => `${member.sourceType}:${member.sourceId}`)
        .sort()
        .join('|')
}
