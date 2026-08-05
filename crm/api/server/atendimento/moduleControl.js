import fs from 'node:fs'

export const ATENDIMENTO_MODULE_CONTROL_STATES = Object.freeze(['disabled', 'maintenance', 'active', 'canary'])

function unavailableControl(state, reason) {
    return {
        configured: false,
        module: 'atendimento',
        state,
        ready: false,
        reason,
        syntheticOnly: true,
    }
}

export function readAtendimentoModuleControl(filePath = process.env.CRM_MODULE_CONTROL_FILE) {
    if (String(process.env.CRM_DOMAIN || '').trim().toLowerCase() !== 'atendimento') {
        return { configured: false, module: 'atendimento', state: 'active', ready: true, syntheticOnly: false, reason: 'shared-crm-domain' }
    }
    const path = String(filePath || '').trim()
    if (!path) return unavailableControl('disabled', 'MODULE_CONTROL_FILE_NOT_CONFIGURED')
    let parsed
    try {
        parsed = JSON.parse(fs.readFileSync(path, 'utf8'))
    } catch {
        return unavailableControl('disabled', 'MODULE_CONTROL_FILE_UNREADABLE')
    }
    const state = String(parsed?.state || '').trim().toLowerCase()
    if (!ATENDIMENTO_MODULE_CONTROL_STATES.includes(state)) return unavailableControl('disabled', 'MODULE_CONTROL_STATE_INVALID')
    if (String(parsed?.module || 'atendimento').trim().toLowerCase() !== 'atendimento') {
        return unavailableControl('disabled', 'MODULE_CONTROL_MODULE_INVALID')
    }
    return {
        configured: true,
        module: String(parsed?.module || 'atendimento'),
        state,
        ready: state === 'active' || state === 'canary',
        syntheticOnly: parsed?.syntheticOnly !== false,
        releaseSha: /^[0-9a-f]{40}$/i.test(String(parsed?.releaseSha || '')) ? String(parsed.releaseSha).toLowerCase() : null,
        updatedAt: parsed?.updatedAt ? String(parsed.updatedAt) : null,
        reason: parsed?.reason ? String(parsed.reason) : null,
    }
}

export function atendimentoModuleUnavailable(control) {
    return !control?.ready
}
