#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readIsolatedAtendimentoRuntimeControl } from '../server/atendimento/isolatedRuntimeControl.js'

export const PRODUCTION_CONTROL_FILE = '/etc/skincos/atendimento-production/module-control.json'
const SHA = /^[0-9a-f]{40}$/
const INSTALLABLE_STATES = new Set(['maintenance', 'active', 'canary'])

function invalid(message, code) {
    const error = new Error(message)
    error.code = code
    return error
}

// Validates only the fixed control file consumed by the isolated production
// unit. The caller can choose an immutable release SHA, never an arbitrary
// control-file path.
export function validateAtendimentoProductionControl({
    releaseSha,
    filePath = PRODUCTION_CONTROL_FILE,
    fsImpl,
} = {}) {
    const normalizedRelease = String(releaseSha || '').trim().toLowerCase()
    if (!SHA.test(normalizedRelease)) {
        throw invalid('ATENDIMENTO_PRODUCTION_CONTROL_RELEASE_SHA_INVALID', 'ATENDIMENTO_PRODUCTION_CONTROL_RELEASE_SHA_INVALID')
    }
    const control = readIsolatedAtendimentoRuntimeControl({
        filePath,
        releaseSha: normalizedRelease,
        ...(fsImpl ? { fsImpl } : {}),
    })
    if (control.configured !== true || control.releaseMatched !== true) {
        throw invalid(`ATENDIMENTO_PRODUCTION_CONTROL_INVALID:${control.reason || 'UNKNOWN'}`, 'ATENDIMENTO_PRODUCTION_CONTROL_INVALID')
    }
    if (!INSTALLABLE_STATES.has(control.state)) {
        throw invalid('ATENDIMENTO_PRODUCTION_CONTROL_STATE_NOT_INSTALLABLE', 'ATENDIMENTO_PRODUCTION_CONTROL_STATE_NOT_INSTALLABLE')
    }
    return Object.freeze({
        state: control.state,
        releaseSha: control.releaseSha,
        readOnly: control.readOnly === true,
        syntheticOnly: control.syntheticOnly === true,
    })
}

export function parseValidateAtendimentoProductionControlArgs(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    if (values.length !== 2 || values[0] !== '--release-sha' || !SHA.test(values[1])) {
        throw invalid('Usage: validate-atendimento-production-control.mjs --release-sha <full-lowercase-sha>', 'ATENDIMENTO_PRODUCTION_CONTROL_ARGUMENTS_INVALID')
    }
    return values[1]
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    const releaseSha = parseValidateAtendimentoProductionControlArgs(process.argv.slice(2))
    const report = validateAtendimentoProductionControl({ releaseSha })
    console.log(JSON.stringify({ ok: true, ...report }))
}
