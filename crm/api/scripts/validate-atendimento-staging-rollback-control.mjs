#!/usr/bin/env node
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAtendimentoStagingControl } from './validate-atendimento-staging-control.mjs'

export const STAGING_CONTROL_BACKUP_ROOT = '/var/backups/skincos/clientes/staging-control'
const SHA = /^[0-9a-f]{40}$/
const BACKUP_NAME = /^[0-9]{8}T[0-9]{6}Z-module-control\.[A-Za-z0-9]{6}\.json$/

function invalid(message, code) {
    const error = new Error(message)
    error.code = code
    return error
}

export function parseAtendimentoStagingRollbackControlArgs(args = []) {
    const values = {}
    for (let index = 0; index < args.length; index += 1) {
        const key = String(args[index] || '')
        if (!['--release-sha', '--backup-name'].includes(key) || values[key]) {
            throw invalid('ATENDIMENTO_STAGING_ROLLBACK_CONTROL_ARGUMENTS_INVALID', 'ATENDIMENTO_STAGING_ROLLBACK_CONTROL_ARGUMENTS_INVALID')
        }
        const value = String(args[++index] || '').trim()
        if (!value) throw invalid('ATENDIMENTO_STAGING_ROLLBACK_CONTROL_ARGUMENTS_INVALID', 'ATENDIMENTO_STAGING_ROLLBACK_CONTROL_ARGUMENTS_INVALID')
        values[key] = key === '--release-sha' ? value.toLowerCase() : value
    }
    const releaseSha = String(values['--release-sha'] || '')
    const backupName = String(values['--backup-name'] || '')
    if (!SHA.test(releaseSha) || !BACKUP_NAME.test(backupName)) {
        throw invalid('ATENDIMENTO_STAGING_ROLLBACK_CONTROL_ARGUMENTS_INVALID', 'ATENDIMENTO_STAGING_ROLLBACK_CONTROL_ARGUMENTS_INVALID')
    }
    return { releaseSha, backupName }
}

export async function validateAtendimentoStagingRollbackControl({
    releaseSha,
    backupName,
    backupRoot = STAGING_CONTROL_BACKUP_ROOT,
} = {}) {
    const normalizedRelease = String(releaseSha || '').trim().toLowerCase()
    const normalizedName = String(backupName || '').trim()
    if (!SHA.test(normalizedRelease) || !BACKUP_NAME.test(normalizedName)) {
        throw invalid('ATENDIMENTO_STAGING_ROLLBACK_CONTROL_ARGUMENTS_INVALID', 'ATENDIMENTO_STAGING_ROLLBACK_CONTROL_ARGUMENTS_INVALID')
    }
    const root = path.resolve(String(backupRoot || ''))
    const filePath = path.join(root, normalizedName)
    if (path.dirname(filePath) !== root) {
        throw invalid('ATENDIMENTO_STAGING_ROLLBACK_CONTROL_PATH_INVALID', 'ATENDIMENTO_STAGING_ROLLBACK_CONTROL_PATH_INVALID')
    }
    let metadata
    try {
        metadata = await lstat(filePath)
    } catch {
        throw invalid('ATENDIMENTO_STAGING_ROLLBACK_CONTROL_UNREADABLE', 'ATENDIMENTO_STAGING_ROLLBACK_CONTROL_UNREADABLE')
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw invalid('ATENDIMENTO_STAGING_ROLLBACK_CONTROL_NOT_REGULAR', 'ATENDIMENTO_STAGING_ROLLBACK_CONTROL_NOT_REGULAR')
    }
    const control = validateAtendimentoStagingControl({ releaseSha: normalizedRelease, filePath })
    if (control.state !== 'maintenance') {
        throw invalid('ATENDIMENTO_STAGING_ROLLBACK_CONTROL_NOT_MAINTENANCE', 'ATENDIMENTO_STAGING_ROLLBACK_CONTROL_NOT_MAINTENANCE')
    }
    return Object.freeze({ backupName: normalizedName, ...control })
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    const { releaseSha, backupName } = parseAtendimentoStagingRollbackControlArgs(process.argv.slice(2))
    const report = await validateAtendimentoStagingRollbackControl({ releaseSha, backupName })
    console.log(JSON.stringify({ ok: true, ...report }))
}

export const __testables = { BACKUP_NAME }
