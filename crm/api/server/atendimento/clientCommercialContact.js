export const COMMERCIAL_PERMISSION_STATUSES = Object.freeze(['granted', 'denied'])
export const COMMERCIAL_PERMISSION_MAX_SOURCE_LENGTH = 120
export const COMMERCIAL_PERMISSION_MAX_EVIDENCE_REFERENCE_LENGTH = 512
export const COMMERCIAL_CONTACT_ELIGIBILITY_STATUSES = Object.freeze(['eligible', 'review_required', 'blocked'])
export const COMMERCIAL_ACTION_STATUSES = Object.freeze(['open', 'contacted', 'responded', 'scheduled', 'won_sale', 'returned', 'closed', 'cancelled'])
export const COMMERCIAL_CONTACT_ACTION_STATUSES = Object.freeze(['contacted'])

const permissionStatuses = new Set(COMMERCIAL_PERMISSION_STATUSES)
const actionStatuses = new Set(COMMERCIAL_ACTION_STATUSES)
const contactActionStatuses = new Set(COMMERCIAL_CONTACT_ACTION_STATUSES)
const terminalActionStatuses = new Set(['won_sale', 'returned', 'closed', 'cancelled'])

function compactText(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function boundedRequiredText(value, field, maximum, errors) {
    const text = compactText(value)
    if (!text) {
        errors.push(`${field}_required`)
        return ''
    }
    if (text.length > maximum) {
        errors.push(`${field}_too_long`)
        return ''
    }
    return text
}

function hasRecordedValue(value) {
    if (value instanceof Date) return !Number.isNaN(value.getTime())
    if (typeof value === 'string') return Boolean(value.trim())
    return Boolean(value)
}

function normalizePermissionExpiry(value, { allowExpired = false } = {}, errors) {
    if (value == null || value === '') return null
    const raw = value instanceof Date ? value.toISOString() : compactText(value)
    if (!raw) return null
    if (raw.length > 64) {
        errors.push('expires_at_too_long')
        return null
    }
    const timestamp = Date.parse(raw)
    if (!Number.isFinite(timestamp)) {
        errors.push('expires_at_invalid')
        return null
    }
    if (!allowExpired && timestamp <= Date.now()) {
        errors.push('expires_at_must_be_future')
        return null
    }
    return new Date(timestamp).toISOString()
}

function isHarmoniaOptedOut(contact) {
    if (!contact || typeof contact !== 'object' || Array.isArray(contact)) return false
    return hasRecordedValue(contact.opted_out_at) || hasRecordedValue(contact.optedOutAt)
}

/**
 * Validates the minimum auditable record that authorizes or denies a
 * commercial contact. It deliberately accepts only an explicit lower-case
 * status so an unknown upstream value cannot accidentally grant contact.
 */
export function validateCommercialPermission(permission = {}, options = {}) {
    const candidate = permission && typeof permission === 'object' && !Array.isArray(permission) ? permission : {}
    const errors = []
    const status = compactText(candidate.status)
    if (!status) errors.push('status_required')
    else if (!permissionStatuses.has(status)) errors.push('status_invalid')
    const source = boundedRequiredText(candidate.source, 'source', COMMERCIAL_PERMISSION_MAX_SOURCE_LENGTH, errors)
    const evidenceReference = boundedRequiredText(
        candidate.evidenceReference,
        'evidence_reference',
        COMMERCIAL_PERMISSION_MAX_EVIDENCE_REFERENCE_LENGTH,
        errors,
    )
    const expiresAt = normalizePermissionExpiry(candidate.expiresAt, options, errors)
    if (status === 'denied' && expiresAt) errors.push('denied_permission_must_not_expire')
    return {
        valid: errors.length === 0,
        errors,
        permission: errors.length ? null : { status, source, evidenceReference, expiresAt },
    }
}

/**
 * Resolves whether a commercial action may contact a customer. A recorded
 * Harmonia opt-out is the strongest signal and must win over every local
 * permission value. Missing or malformed permission remains fail-closed and
 * needs review instead of becoming eligible.
 */
export function resolveCommercialContactEligibility({ commercialPermission, harmoniaContact } = {}) {
    const permission = validateCommercialPermission(commercialPermission, { allowExpired: true })
    if (isHarmoniaOptedOut(harmoniaContact)) {
        return {
            status: 'blocked',
            contactAllowed: false,
            reason: 'harmonia_opt_out',
            permission,
        }
    }
    if (!permission.valid) {
        return {
            status: 'review_required',
            contactAllowed: false,
            reason: 'commercial_permission_invalid',
            permission,
        }
    }
    if (permission.permission.status === 'denied') {
        return {
            status: 'blocked',
            contactAllowed: false,
            reason: 'commercial_permission_denied',
            permission,
        }
    }
    if (permission.permission.expiresAt && Date.parse(permission.permission.expiresAt) <= Date.now()) {
        return {
            status: 'review_required',
            contactAllowed: false,
            reason: 'commercial_permission_expired',
            permission,
        }
    }
    return {
        status: 'eligible',
        contactAllowed: true,
        reason: 'commercial_permission_granted',
        permission,
    }
}

function transitionResult({ allowed, reason, currentStatus, nextStatus, requiresEligibility }) {
    return { allowed, reason, currentStatus, nextStatus, requiresEligibility }
}

/**
 * Evaluates an action-state transition without mutating storage. Only the
 * `contacted` state represents an outbound commercial contact; status changes
 * that merely record an inbound result remain possible for blocked customers.
 */
export function transitionCommercialAction({ currentStatus, nextStatus, eligibility } = {}) {
    const current = compactText(currentStatus)
    const next = compactText(nextStatus)
    const requiresEligibility = contactActionStatuses.has(next)
    if (!actionStatuses.has(current)) {
        return transitionResult({
            allowed: false,
            reason: 'current_status_invalid',
            currentStatus: current,
            nextStatus: next,
            requiresEligibility,
        })
    }
    if (!actionStatuses.has(next)) {
        return transitionResult({
            allowed: false,
            reason: 'next_status_invalid',
            currentStatus: current,
            nextStatus: next,
            requiresEligibility,
        })
    }
    if (current !== next && terminalActionStatuses.has(current)) {
        return transitionResult({
            allowed: false,
            reason: 'terminal_status',
            currentStatus: current,
            nextStatus: next,
            requiresEligibility,
        })
    }
    if (requiresEligibility && eligibility?.status !== 'eligible') {
        const status = compactText(eligibility?.status)
        const reason = status === 'blocked'
            ? 'contact_eligibility_blocked'
            : status === 'review_required'
                ? 'contact_eligibility_review_required'
                : 'contact_eligibility_required'
        return transitionResult({
            allowed: false,
            reason,
            currentStatus: current,
            nextStatus: next,
            requiresEligibility,
        })
    }
    return transitionResult({
        allowed: true,
        reason: 'transition_allowed',
        currentStatus: current,
        nextStatus: next,
        requiresEligibility,
    })
}
