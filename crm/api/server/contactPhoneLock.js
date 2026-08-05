/**
 * A shared transaction-scoped lock namespace for any flow that can authorize
 * or block contact with a phone number. Hash collisions merely serialize two
 * unrelated numbers; they cannot make a contact eligible.
 */
export function normalizeContactPhoneKey(value) {
    return String(value || '').replace(/\D+/g, '')
}

export function contactPhoneLockKey(value) {
    const phone = normalizeContactPhoneKey(value)
    return phone ? `skincos.contact-phone:${phone}` : ''
}

export async function lockContactPhone(tx, value) {
    const key = contactPhoneLockKey(value)
    if (!key) return false
    await tx.query('select pg_advisory_xact_lock(hashtext($1)::bigint)', [key])
    return true
}
