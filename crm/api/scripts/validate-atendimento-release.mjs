#!/usr/bin/env node
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA = /^[0-9a-f]{40}$/

function parseArgs(args = []) {
    const values = {}
    for (let index = 0; index < args.length; index += 1) {
        const key = String(args[index] || '')
        if (!['--source-root', '--release-sha', '--predecessor-sha'].includes(key)) {
            throw new Error('ATENDIMENTO_RELEASE_ARGUMENT_INVALID')
        }
        const value = String(args[++index] || '').trim()
        if (!value || values[key]) throw new Error('ATENDIMENTO_RELEASE_ARGUMENT_INVALID')
        values[key] = value
    }
    const releaseSha = String(values['--release-sha'] || '').toLowerCase()
    const predecessorSha = String(values['--predecessor-sha'] || '').toLowerCase()
    const sourceRoot = String(values['--source-root'] || '')
    if (!SHA.test(releaseSha) || (predecessorSha && !SHA.test(predecessorSha))
        || sourceRoot !== `/opt/skincos/releases/${releaseSha}/source`) {
        throw new Error('ATENDIMENTO_RELEASE_IDENTITY_INVALID')
    }
    return { sourceRoot, releaseSha, predecessorSha }
}

export async function validateAtendimentoRelease(args = process.argv.slice(2)) {
    const input = parseArgs(args)
    try {
        const stat = await lstat(input.sourceRoot)
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('ATENDIMENTO_RELEASE_SOURCE_NOT_IMMUTABLE')
    } catch (error) {
        if (String(error?.message || '') === 'ATENDIMENTO_RELEASE_SOURCE_NOT_IMMUTABLE') throw error
        throw new Error('ATENDIMENTO_RELEASE_SOURCE_UNREADABLE')
    }
    let lineage
    try {
        lineage = JSON.parse(await readFile(`${input.sourceRoot}/.skincos-release-lineage.json`, 'utf8'))
    } catch {
        throw new Error('ATENDIMENTO_RELEASE_LINEAGE_UNREADABLE')
    }
    const lineageParent = String(lineage?.parentReleaseId || '').toLowerCase()
    if (lineage?.releaseId !== input.releaseSha
        || !SHA.test(lineageParent)
        || (input.predecessorSha && lineageParent !== input.predecessorSha)
        || lineage?.verifiedAncestor !== true) {
        throw new Error('ATENDIMENTO_RELEASE_LINEAGE_INVALID')
    }
    for (const required of [
        'crm/api/server/atendimentoRuntime.js',
        'crm/api/server/atendimento/isolatedRuntimeControl.js',
        'scripts/runtime/install-atendimento-production-service.sh',
    ]) {
        try { await readFile(`${input.sourceRoot}/${required}`, 'utf8') } catch { throw new Error('ATENDIMENTO_RELEASE_CONTENT_INVALID') }
    }
    return {
        valid: true,
        releaseSha: input.releaseSha,
        predecessorSha: lineageParent,
        readOnly: true,
        syntheticOnly: true,
    }
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    console.log(JSON.stringify(await validateAtendimentoRelease()))
}

export const __testables = { parseArgs }
