// Actor subjects cross signed boundaries and are later written into audit and
// idempotency ledgers. Keep them opaque and reject e-mail/name fallbacks at
// the first shared boundary instead of attempting to redact append-only data.
const OPAQUE_SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:/|-]{0,159}$/

export function opaqueActorSubject(value) {
    const subject = String(value ?? '').trim()
    return OPAQUE_SUBJECT.test(subject) ? subject : null
}

export function actorSubject(actor) {
    return opaqueActorSubject(actor?.subject || actor?.subjectId || actor?.id)
}

export const __testables = { OPAQUE_SUBJECT }
