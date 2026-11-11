// Only explicit links supplied by the authenticated profile cross this boundary.
// Names, usernames and browser-selected professionals are not identity evidence.
const PROFESSIONAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WORKFORCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/

export function normalizeProfessionalActorIdentity(actor) {
    const result = {}
    if (actor?.professionalIdentityStatus != null) {
        if (!['CONFIRMED', 'UNLINKED', 'UNAVAILABLE'].includes(actor.professionalIdentityStatus)) return null
        result.professionalIdentityStatus = actor.professionalIdentityStatus
    }
    for (const [field, pattern] of [['professionalId', PROFESSIONAL_UUID], ['workforceEmployeeId', WORKFORCE_ID]]) {
        const value = actor?.[field]
        if (value == null) continue
        if (typeof value !== 'string') return null
        const identity = value.trim()
        if (!identity) continue
        if (!pattern.test(identity)) return null
        result[field] = field === 'professionalId' ? identity.toLowerCase() : identity
    }
    // Typed availability describes this same explicit link, not an independent claim.
    if (['UNLINKED', 'UNAVAILABLE'].includes(result.professionalIdentityStatus)
        && (result.professionalId || result.workforceEmployeeId)) return null
    // The confirmed-state producer is the reviewed account-to-Workforce ledger.
    if (result.professionalIdentityStatus === 'CONFIRMED' && !result.workforceEmployeeId) return null
    return result
}
