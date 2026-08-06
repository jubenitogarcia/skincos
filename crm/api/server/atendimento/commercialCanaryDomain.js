import { createHash } from 'node:crypto'

export const COMMERCIAL_CANARY_MAX_IDENTITIES = 100
export const COMMERCIAL_CANARY_CANDIDATE_TTL_MS = 10 * 60 * 1000
export const COMMERCIAL_CANARY_VALIDATION_TYPES = Object.freeze(['synthetic', 'explicit_approved'])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value) {
    return UUID_RE.test(String(value || '').trim())
}

export function maskIdentityName(value) {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean)
    if (!words.length) return 'Identidade sem nome'
    return words.map((word) => {
        const letters = [...word]
        if (letters.length <= 2) return `${letters[0] || '•'}•`
        return `${letters[0]}${'•'.repeat(Math.min(5, Math.max(2, letters.length - 2)))}${letters.at(-1)}`
    }).join(' ')
}

export function normalizeCanarySearch(value, max = 80) {
    return String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max)
}

export function normalizeCanaryUnit(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80)
}

export function normalizeCanaryCandidateFilters(query = {}) {
    const rawLimit = Number(query.limit)
    const rawOffset = Number(query.offset)
    return {
        q: normalizeCanarySearch(query.q || query.search),
        unit: normalizeCanaryUnit(query.unit),
        quality: String(query.quality || '').trim().toLowerCase().slice(0, 40),
        permission: String(query.permission || '').trim().toLowerCase().slice(0, 40),
        phone: String(query.phone || '').trim().toLowerCase().slice(0, 40),
        optOut: String(query.optOut || query.optout || '').trim().toLowerCase().slice(0, 20),
        freshness: String(query.freshness || '').trim().toLowerCase().slice(0, 20),
        limit: Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), COMMERCIAL_CANARY_MAX_IDENTITIES) : 25,
        offset: Number.isInteger(rawOffset) ? Math.min(Math.max(rawOffset, 0), 10000) : 0,
    }
}

export function candidateValidationStatus(row = {}) {
    const validationType = String(row.validationType || row.validation_type || row.validationStatus || '').trim().toLowerCase()
    const expiresAt = row.validationExpiresAt || row.validation_expires_at
    const expired = expiresAt && Date.parse(String(expiresAt)) <= Date.now()
    if (COMMERCIAL_CANARY_VALIDATION_TYPES.includes(validationType) && !expired) return validationType
    return 'not_validated'
}

export function candidateEligibility(candidate = {}) {
    const validation = candidateValidationStatus(candidate)
    const freshness = String(candidate.freshnessStatus || candidate.freshness_status || '').trim().toLowerCase()
    const contactStatus = String(candidate.contactStatus || candidate.contact_status || '').trim().toLowerCase()
    if (validation === 'not_validated') return { status: 'review', reason: 'identity_validation_required' }
    if (contactStatus === 'blocked') return { status: 'blocked', reason: candidate.contactReason || 'contact_blocked' }
    if (freshness === 'stale') return { status: 'review', reason: 'source_stale' }
    if (contactStatus !== 'eligible') return { status: 'review', reason: candidate.contactReason || 'contact_review_required' }
    return { status: 'eligible', reason: 'validated_and_contact_controls_green' }
}

export function summarizeCommercialCanaryCandidates(candidates = []) {
    const summary = {
        totalCohort: candidates.length,
        eligible: 0,
        blocked: 0,
        inReview: 0,
        permissionsExpiring: 0,
        phonesUncorrelated: 0,
        staleSources: 0,
        pendingIdentityDecisions: 0,
        duplicateSelections: 0,
        outOfScope: 0,
        notValidated: 0,
        impact: {
            commercialContactWritesEnabled: false,
            messagesToSend: 0,
            contactsToRecord: 0,
            actionsToCreate: 0,
        },
    }
    const seen = new Set()
    for (const candidate of candidates) {
        const id = String(candidate.identityId || candidate.identity_id || '').trim()
        if (id && seen.has(id)) summary.duplicateSelections += 1
        if (id) seen.add(id)
        const eligibility = candidateEligibility(candidate)
        if (eligibility.status === 'eligible') summary.eligible += 1
        else if (eligibility.status === 'blocked') summary.blocked += 1
        else summary.inReview += 1
        if (candidateValidationStatus(candidate) === 'not_validated') summary.notValidated += 1
        const expiresAt = candidate.expiresAt || candidate.expires_at
        if (expiresAt) {
            const remaining = Date.parse(String(expiresAt)) - Date.now()
            if (remaining > 0 && remaining <= 14 * 24 * 60 * 60 * 1000) summary.permissionsExpiring += 1
        }
        if (candidate.phoneStatus === 'uncorrelated' || candidate.hasPhone === false) summary.phonesUncorrelated += 1
        if (candidate.freshnessStatus === 'stale') summary.staleSources += 1
        if (candidate.identityQuality !== 'confirmed_multi_source') summary.pendingIdentityDecisions += 1
    }
    summary.canApply = summary.totalCohort > 0
        && summary.eligible === summary.totalCohort
        && summary.duplicateSelections === 0
        && summary.outOfScope === 0
        && summary.staleSources === 0
        && summary.notValidated === 0
    return summary
}

export function hashIdentitySet(identityIds = []) {
    const normalized = [...new Set(identityIds.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))].sort()
    return createHash('sha256').update(normalized.join('|')).digest('hex')
}

export function assertCanaryMutationPayload(payload = {}) {
    const justification = String(payload.justification || '').trim()
    if (justification.length < 10 || justification.length > 1000) {
        const error = new Error('COMMERCIAL_CANARY_JUSTIFICATION_REQUIRED')
        error.statusCode = 400
        throw error
    }
    if (payload.confirm !== true) {
        const error = new Error('COMMERCIAL_CANARY_CONFIRMATION_REQUIRED')
        error.statusCode = 428
        throw error
    }
    const expectedPolicyVersion = String(payload.expectedPolicyVersion || '').trim().toLowerCase()
    if (!/^[a-f0-9]{32}$/.test(expectedPolicyVersion)) {
        const error = new Error('COMMERCIAL_CANARY_POLICY_VERSION_REQUIRED')
        error.statusCode = 428
        throw error
    }
    const idempotencyKey = String(payload.idempotencyKey || '').trim()
    if (!idempotencyKey || idempotencyKey.length > 128 || /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
        const error = new Error('COMMERCIAL_CANARY_IDEMPOTENCY_KEY_REQUIRED')
        error.statusCode = 400
        throw error
    }
    return { justification, expectedPolicyVersion, idempotencyKey }
}
