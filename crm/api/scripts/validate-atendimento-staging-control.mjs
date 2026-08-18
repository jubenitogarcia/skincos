#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readIsolatedAtendimentoRuntimeControl } from '../server/atendimento/isolatedRuntimeControl.js'

export const STAGING_CONTROL_FILE = '/etc/skincos/atendimento-staging/module-control.json'
const SHA = /^[0-9a-f]{40}$/
const INSTALLABLE_STATES = new Set(['maintenance', 'active', 'canary'])

function invalid(message, code) {
    const error = new Error(message)
    error.code = code
    return error
}

/**
 * Validates the exact control file consumed by crm-atendimento-staging.service.
 * The CLI intentionally has no file-path argument: installer input may select
 * an immutable source SHA, but cannot redirect the control-file sink.
 */
export function validateAtendimentoStagingControl({
    releaseSha,
    surface,
    filePath = STAGING_CONTROL_FILE,
    fsImpl,
} = {}) {
    const normalizedRelease = String(releaseSha || '').trim().toLowerCase()
    if (!SHA.test(normalizedRelease)) {
        throw invalid('ATENDIMENTO_STAGING_CONTROL_RELEASE_SHA_INVALID', 'ATENDIMENTO_STAGING_CONTROL_RELEASE_SHA_INVALID')
    }
    const control = readIsolatedAtendimentoRuntimeControl({
        filePath,
        releaseSha: normalizedRelease,
        ...(surface ? { expectedSurface: surface } : {}),
        ...(fsImpl ? { fsImpl } : {}),
    })
    if (control.configured !== true || control.releaseMatched !== true) {
        throw invalid(`ATENDIMENTO_STAGING_CONTROL_INVALID:${control.reason || 'UNKNOWN'}`, 'ATENDIMENTO_STAGING_CONTROL_INVALID')
    }
    if (!INSTALLABLE_STATES.has(control.state)) {
        throw invalid('ATENDIMENTO_STAGING_CONTROL_STATE_NOT_INSTALLABLE', 'ATENDIMENTO_STAGING_CONTROL_STATE_NOT_INSTALLABLE')
    }
    return Object.freeze({
        state: control.state,
        releaseSha: control.releaseSha,
        ...(surface ? { surface: control.surface || 'clientes' } : {}),
        readOnly: control.readOnly === true,
        syntheticOnly: control.syntheticOnly === true,
    })
}

export function parseValidateAtendimentoStagingControlArgs(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    if (values.length === 2 && values[0] === '--release-sha' && SHA.test(values[1])) return values[1]
    if (values.length === 4 && values[0] === '--release-sha' && SHA.test(values[1]) && values[2] === '--surface' && /^(clientes|full)$/.test(values[3])) {
        return { releaseSha: values[1], surface: values[3] }
    }
    throw invalid('Usage: validate-atendimento-staging-control.mjs --release-sha <full-lowercase-sha> [--surface <clientes|full>]', 'ATENDIMENTO_STAGING_CONTROL_ARGUMENTS_INVALID')
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    const parsed = parseValidateAtendimentoStagingControlArgs(process.argv.slice(2))
    const releaseSha = typeof parsed === 'string' ? parsed : parsed.releaseSha
    const report = validateAtendimentoStagingControl({ releaseSha, ...(typeof parsed === 'string' ? {} : { surface: parsed.surface }) })
    console.log(JSON.stringify({ ok: true, ...report }))
}
