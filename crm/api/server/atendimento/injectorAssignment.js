import { normalizeText } from './domain.js'
import { resolveProfessionalIdentity } from './professionalIdentity.js'

export const INJECTOR_ASSIGNMENT_ORIGIN = Object.freeze({
    SCHEDULE: 'schedule',
    MANAGER: 'manager',
    PRESERVED: 'preserved',
    UNRESOLVED: 'unresolved',
})

function resolutionError(error) {
    return String(error?.code || error?.message || 'UNKNOWN_PROFESSIONAL')
}

/**
 * Converts the persisted Escala entry into an active, canonical injector for
 * the requested unit.  It deliberately never creates professionals or falls
 * back from an invalid stored id to a same-named person: a stale identity must
 * be reviewed, not silently reassigned.
 */
export function resolveScheduledInjector(schedule = {}, unit, rows = [], noServiceLabel = '') {
    const professionalId = String(schedule.professionalId || schedule.professional_id || '').trim()
    const professionalName = String(schedule.professionalName || schedule.doctorName || schedule.doctor_name || '').trim()
    const noServiceKey = normalizeText(noServiceLabel)
    if (!professionalId && (!professionalName || (noServiceKey && normalizeText(professionalName) === noServiceKey))) {
        return { professional: null, origin: INJECTOR_ASSIGNMENT_ORIGIN.UNRESOLVED, reason: 'NO_SCHEDULED_INJECTOR' }
    }

    try {
        const professional = resolveProfessionalIdentity({
            ...(professionalId ? { professionalId } : { professionalName }),
            unit,
            expectedRole: 'Injetor',
            allowTextResolution: !professionalId,
            allowInactive: false,
        }, rows)
        return { professional, origin: INJECTOR_ASSIGNMENT_ORIGIN.SCHEDULE, reason: null }
    } catch (error) {
        return { professional: null, origin: INJECTOR_ASSIGNMENT_ORIGIN.UNRESOLVED, reason: resolutionError(error) }
    }
}

export function hasInjectorPatch(payload = {}) {
    return Object.prototype.hasOwnProperty.call(payload, 'injectorId')
        || Object.prototype.hasOwnProperty.call(payload, 'injectorName')
}

export function injectorPatchMatchesAttendance(payload = {}, attendance = {}) {
    const expectedId = String(attendance?.injectorId || '').trim()
    const expectedName = normalizeText(attendance?.injectorName)
    if (Object.prototype.hasOwnProperty.call(payload, 'injectorId') && String(payload.injectorId || '').trim() !== expectedId) return false
    if (Object.prototype.hasOwnProperty.call(payload, 'injectorName') && normalizeText(payload.injectorName) !== expectedName) return false
    return true
}
