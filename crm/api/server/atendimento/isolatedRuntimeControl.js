import fs from 'node:fs'

const STATES = new Set(['disabled', 'maintenance', 'active', 'canary'])
const SHA = /^[0-9a-f]{40}$/

function unavailable(reason) {
    return {
        configured: false,
        ready: false,
        state: 'disabled',
        releaseMatched: false,
        reason,
    }
}

function normalizedSha(value) {
    const sha = String(value || '').trim().toLowerCase()
    return SHA.test(sha) ? sha : null
}

/**
 * The isolated runtime intentionally accepts a much narrower control schema
 * than the shared CRM.  Missing or malformed fields are a disabled state,
 * never an implicit permission to serve client data.
 */
export function readIsolatedAtendimentoRuntimeControl({
    filePath = process.env.CRM_MODULE_CONTROL_FILE,
    releaseSha = process.env.ATENDIMENTO_RUNTIME_RELEASE_SHA,
    fsImpl = fs,
} = {}) {
    const expectedRelease = normalizedSha(releaseSha)
    const path = String(filePath || '').trim()
    if (!expectedRelease) return unavailable('RUNTIME_RELEASE_SHA_INVALID')
    if (!path) return unavailable('MODULE_CONTROL_FILE_NOT_CONFIGURED')

    let value
    try {
        value = JSON.parse(fsImpl.readFileSync(path, 'utf8'))
    } catch {
        return unavailable('MODULE_CONTROL_FILE_UNREADABLE')
    }

    const state = String(value?.state || '').trim().toLowerCase()
    const release = normalizedSha(value?.releaseSha)
    if (value?.schemaVersion !== 1) return unavailable('MODULE_CONTROL_SCHEMA_INVALID')
    if (String(value?.module || '').trim().toLowerCase() !== 'atendimento') return unavailable('MODULE_CONTROL_MODULE_INVALID')
    if (!STATES.has(state)) return unavailable('MODULE_CONTROL_STATE_INVALID')
    if (value?.readOnly !== true || value?.commercialContactWritesEnabled !== false || value?.syntheticOnly !== true) {
        return unavailable('MODULE_CONTROL_WRITE_GUARD_INVALID')
    }
    if (!release || release !== expectedRelease) return unavailable('MODULE_CONTROL_RELEASE_MISMATCH')

    return {
        configured: true,
        ready: state === 'active' || state === 'canary',
        state,
        releaseMatched: true,
        releaseSha: expectedRelease,
        readOnly: true,
        syntheticOnly: true,
        reason: null,
    }
}

export const __testables = { normalizedSha }
