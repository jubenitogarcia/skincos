import assert from 'node:assert/strict'
import test from 'node:test'
import {
    COMMERCIAL_PERMISSION_MAX_EVIDENCE_REFERENCE_LENGTH,
    COMMERCIAL_PERMISSION_MAX_SOURCE_LENGTH,
    resolveCommercialContactEligibility,
    transitionCommercialAction,
    validateCommercialPermission,
} from '../clientCommercialContact.js'

function grantedPermission(overrides = {}) {
    return {
        status: 'granted',
        source: 'cadastro_app',
        evidenceReference: 'app-registration:customer-123',
        ...overrides,
    }
}

test('commercial permission requires an explicit bounded status, source and evidence reference', () => {
    const validation = validateCommercialPermission(grantedPermission({
        source: `  ${'s'.repeat(COMMERCIAL_PERMISSION_MAX_SOURCE_LENGTH)}  `,
        evidenceReference: `  ${'e'.repeat(COMMERCIAL_PERMISSION_MAX_EVIDENCE_REFERENCE_LENGTH)}  `,
    }))
    assert.deepEqual(validation, {
        valid: true,
        errors: [],
        permission: {
            status: 'granted',
            source: 's'.repeat(COMMERCIAL_PERMISSION_MAX_SOURCE_LENGTH),
            evidenceReference: 'e'.repeat(COMMERCIAL_PERMISSION_MAX_EVIDENCE_REFERENCE_LENGTH),
            expiresAt: null,
        },
    })

    const invalid = validateCommercialPermission({
        status: 'GRANTED',
        source: 's'.repeat(COMMERCIAL_PERMISSION_MAX_SOURCE_LENGTH + 1),
        evidenceReference: '',
    })
    assert.deepEqual(invalid, {
        valid: false,
        errors: ['status_invalid', 'source_too_long', 'evidence_reference_required'],
        permission: null,
    })
})

test('commercial permission accepts only future grant expirations and expires fail-closed', () => {
    const future = validateCommercialPermission(grantedPermission({ expiresAt: '2030-01-02T03:04:05.000Z' }))
    assert.equal(future.valid, true)
    assert.equal(future.permission.expiresAt, '2030-01-02T03:04:05.000Z')

    const expired = validateCommercialPermission(grantedPermission({ expiresAt: '2020-01-02T03:04:05.000Z' }))
    assert.deepEqual(expired.errors, ['expires_at_must_be_future'])

    const deniedWithExpiry = validateCommercialPermission(grantedPermission({
        status: 'denied',
        expiresAt: '2030-01-02T03:04:05.000Z',
    }))
    assert.deepEqual(deniedWithExpiry.errors, ['denied_permission_must_not_expire'])

    const resolvedExpired = resolveCommercialContactEligibility({
        commercialPermission: grantedPermission({ expiresAt: '2020-01-02T03:04:05.000Z' }),
    })
    assert.equal(resolvedExpired.status, 'review_required')
    assert.equal(resolvedExpired.reason, 'commercial_permission_expired')
})

test('commercial eligibility is fail-closed for missing, malformed and denied permissions', () => {
    const missing = resolveCommercialContactEligibility()
    assert.equal(missing.status, 'review_required')
    assert.equal(missing.contactAllowed, false)
    assert.equal(missing.reason, 'commercial_permission_invalid')

    const denied = resolveCommercialContactEligibility({
        commercialPermission: grantedPermission({ status: 'denied' }),
        harmoniaContact: { opted_out_at: null },
    })
    assert.equal(denied.status, 'blocked')
    assert.equal(denied.contactAllowed, false)
    assert.equal(denied.reason, 'commercial_permission_denied')
})

test('a persisted Harmonia opt-out always wins over commercial permission data', () => {
    const grantedButOptedOut = resolveCommercialContactEligibility({
        commercialPermission: grantedPermission(),
        harmoniaContact: { opted_out_at: '2026-08-04T12:00:00.000Z' },
    })
    assert.equal(grantedButOptedOut.status, 'blocked')
    assert.equal(grantedButOptedOut.contactAllowed, false)
    assert.equal(grantedButOptedOut.reason, 'harmonia_opt_out')

    const malformedButOptedOut = resolveCommercialContactEligibility({
        commercialPermission: { status: 'unknown' },
        harmoniaContact: { optedOutAt: new Date('2026-08-04T12:00:00.000Z') },
    })
    assert.equal(malformedButOptedOut.status, 'blocked')
    assert.equal(malformedButOptedOut.reason, 'harmonia_opt_out')

    const expiredButOptedOut = resolveCommercialContactEligibility({
        commercialPermission: grantedPermission({ expiresAt: '2020-01-02T03:04:05.000Z' }),
        harmoniaContact: { opted_out_at: '2026-08-04T12:00:00.000Z' },
    })
    assert.equal(expiredButOptedOut.status, 'blocked')
    assert.equal(expiredButOptedOut.reason, 'harmonia_opt_out')
})

test('only eligible customers may transition an action to contacted', () => {
    const eligible = resolveCommercialContactEligibility({
        commercialPermission: grantedPermission(),
        harmoniaContact: { opted_out_at: null },
    })
    assert.deepEqual(transitionCommercialAction({
        currentStatus: 'open',
        nextStatus: 'contacted',
        eligibility: eligible,
    }), {
        allowed: true,
        reason: 'transition_allowed',
        currentStatus: 'open',
        nextStatus: 'contacted',
        requiresEligibility: true,
    })

    const reviewRequired = resolveCommercialContactEligibility()
    const blocked = resolveCommercialContactEligibility({
        commercialPermission: grantedPermission({ status: 'denied' }),
    })
    assert.equal(transitionCommercialAction({ currentStatus: 'open', nextStatus: 'contacted', eligibility: reviewRequired }).reason, 'contact_eligibility_review_required')
    assert.equal(transitionCommercialAction({ currentStatus: 'open', nextStatus: 'contacted', eligibility: blocked }).reason, 'contact_eligibility_blocked')

    // Closing a queued action does not contact the customer and remains safe.
    assert.equal(transitionCommercialAction({ currentStatus: 'open', nextStatus: 'cancelled', eligibility: blocked }).allowed, true)
    assert.equal(transitionCommercialAction({ currentStatus: 'closed', nextStatus: 'open', eligibility: eligible }).reason, 'terminal_status')
})
