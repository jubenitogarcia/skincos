import { normalizeText, normalizeUnit } from './domain.js'
import {
    professionalIdentityFromRow,
    resolveProfessionalIdentity,
} from './professionalIdentity.js'

export const CONSULTANT_ASSIGNMENT_ORIGIN = Object.freeze({
    ACTOR: 'actor',
    MANAGER: 'manager',
    UNRESOLVED: 'unresolved',
    PRESERVED: 'preserved',
})

function normalizedRole(value) {
    const raw = String(value || '').trim().toUpperCase()
    if (raw === 'ADMIN') return 'GESTOR'
    if (raw === 'OPERADOR') return 'INJETOR'
    return raw
}

export function isConsultantActor(actor) {
    return normalizedRole(actor?.role) === 'CONSULTOR'
}

function emailKey(value) {
    return String(value || '').trim().toLocaleLowerCase('en-US')
}

function canonicalCandidates(rows, predicate) {
    const byCanonicalId = new Map()
    for (const row of rows || []) {
        const identity = professionalIdentityFromRow(row)
        if (!identity.canonicalId || !predicate(row, identity)) continue
        const current = byCanonicalId.get(identity.canonicalId)
        if (!current || identity.id === identity.canonicalId) byCanonicalId.set(identity.canonicalId, identity)
    }
    return Array.from(byCanonicalId.values())
}

function resolveById(rows, professionalId, unit) {
    try {
        return resolveProfessionalIdentity({
            professionalId,
            unit,
            expectedRole: 'Consultor',
            allowInactive: false,
        }, rows)
    } catch (error) {
        return { error: String(error?.code || error?.message || 'UNKNOWN_PROFESSIONAL') }
    }
}

function resolveByName(rows, name, unit) {
    const candidate = String(name || '').trim()
    if (!candidate) return { error: 'UNKNOWN_PROFESSIONAL' }
    try {
        return resolveProfessionalIdentity({
            professionalName: candidate,
            unit,
            expectedRole: 'Consultor',
            allowTextResolution: true,
            allowInactive: false,
        }, rows)
    } catch (error) {
        return { error: String(error?.code || error?.message || 'UNKNOWN_PROFESSIONAL') }
    }
}

/**
 * Resolves the authenticated consultant without accepting a browser-selected
 * professional. Email is the strongest source; names are only accepted through
 * the reviewed canonical/alias identity resolver and must be unambiguous.
 */
export function resolveActorConsultant(actor, unit, rows = []) {
    const actorEmail = emailKey(actor?.email)
    if (actorEmail) {
        const matches = canonicalCandidates(rows, (row) => emailKey(row?.email) === actorEmail)
        if (matches.length === 1) {
            const result = resolveById(rows, matches[0].canonicalId, unit)
            if (!result.error) return { professional: result, origin: CONSULTANT_ASSIGNMENT_ORIGIN.ACTOR, match: 'email' }
            return { professional: null, origin: CONSULTANT_ASSIGNMENT_ORIGIN.UNRESOLVED, reason: result.error, match: 'email' }
        }
        if (matches.length > 1) return { professional: null, origin: CONSULTANT_ASSIGNMENT_ORIGIN.UNRESOLVED, reason: 'AMBIGUOUS_PROFESSIONAL', match: 'email' }
    }

    const names = [actor?.displayName, actor?.name]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    const seen = new Set()
    for (const name of names) {
        const key = normalizeText(name)
        if (!key || seen.has(key)) continue
        seen.add(key)
        const result = resolveByName(rows, name, unit)
        if (!result.error) return { professional: result, origin: CONSULTANT_ASSIGNMENT_ORIGIN.ACTOR, match: 'name' }
        if (result.error !== 'UNKNOWN_PROFESSIONAL') return { professional: null, origin: CONSULTANT_ASSIGNMENT_ORIGIN.UNRESOLVED, reason: result.error, match: 'name' }
    }

    const username = String(actor?.username || '').trim()
    if (username && !seen.has(normalizeText(username))) {
        const result = resolveByName(rows, username, unit)
        if (!result.error) return { professional: result, origin: CONSULTANT_ASSIGNMENT_ORIGIN.ACTOR, match: 'username' }
        if (result.error !== 'UNKNOWN_PROFESSIONAL') return { professional: null, origin: CONSULTANT_ASSIGNMENT_ORIGIN.UNRESOLVED, reason: result.error, match: 'username' }
    }

    return { professional: null, origin: CONSULTANT_ASSIGNMENT_ORIGIN.UNRESOLVED, reason: 'UNKNOWN_PROFESSIONAL', match: null }
}

export function hasConsultantPatch(payload = {}) {
    return Object.prototype.hasOwnProperty.call(payload, 'consultantId')
        || Object.prototype.hasOwnProperty.call(payload, 'consultantName')
}

export function consultantPatchMatchesAttendance(payload = {}, attendance = {}) {
    const expectedId = String(attendance?.consultantId || '').trim()
    const expectedName = normalizeText(attendance?.consultantName)
    if (Object.prototype.hasOwnProperty.call(payload, 'consultantId') && String(payload.consultantId || '').trim() !== expectedId) return false
    if (Object.prototype.hasOwnProperty.call(payload, 'consultantName') && normalizeText(payload.consultantName) !== expectedName) return false
    return true
}

export function actorConsultantReferenceByUnit(actor, units = [], rows = []) {
    if (!isConsultantActor(actor)) return {}
    const result = {}
    for (const unit of units || []) {
        const normalized = normalizeUnit(unit?.slug || unit?.name || unit)
        if (!normalized.slug) continue
        const resolved = resolveActorConsultant(actor, normalized, rows)
        result[normalized.slug] = resolved.professional
            ? {
                canonicalId: resolved.professional.canonicalId,
                name: resolved.professional.canonicalName,
                origin: resolved.origin,
            }
            : { canonicalId: null, name: null, origin: resolved.origin, reason: resolved.reason }
    }
    return result
}
