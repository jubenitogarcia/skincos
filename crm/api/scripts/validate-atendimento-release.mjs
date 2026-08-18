#!/usr/bin/env node
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeAtendimentoSurface } from '../server/atendimento/surfaceProfile.js'

const SHA = /^[0-9a-f]{40}$/

function parseArgs(args = []) {
    const values = {}
    for (let index = 0; index < args.length; index += 1) {
        const key = String(args[index] || '')
        if (!['--source-root', '--release-sha', '--predecessor-sha', '--target', '--surface'].includes(key)) {
            throw new Error('ATENDIMENTO_RELEASE_ARGUMENT_INVALID')
        }
        const value = String(args[++index] || '').trim()
        if (!value || values[key]) throw new Error('ATENDIMENTO_RELEASE_ARGUMENT_INVALID')
        values[key] = value
    }
    const releaseSha = String(values['--release-sha'] || '').toLowerCase()
    const predecessorSha = String(values['--predecessor-sha'] || '').toLowerCase()
    const sourceRoot = String(values['--source-root'] || '')
    const target = String(values['--target'] || '').trim().toLowerCase()
    const surfaceValue = String(values['--surface'] || '').trim().toLowerCase()
    if (!SHA.test(releaseSha) || (predecessorSha && !SHA.test(predecessorSha))
        || (target && !['staging', 'production'].includes(target))
        || (surfaceValue && !normalizeAtendimentoSurface(surfaceValue))
        || sourceRoot !== `/opt/skincos/releases/${releaseSha}/source`) {
        throw new Error('ATENDIMENTO_RELEASE_IDENTITY_INVALID')
    }
    return { sourceRoot, releaseSha, predecessorSha, target: target || null, surface: surfaceValue || null }
}

export async function validateAtendimentoRelease(
    args = process.argv.slice(2),
    { lstatImpl = lstat, readFileImpl = readFile } = {},
) {
    const input = parseArgs(args)
    try {
        const stat = await lstatImpl(input.sourceRoot)
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('ATENDIMENTO_RELEASE_SOURCE_NOT_IMMUTABLE')
    } catch (error) {
        if (String(error?.message || '') === 'ATENDIMENTO_RELEASE_SOURCE_NOT_IMMUTABLE') throw error
        throw new Error('ATENDIMENTO_RELEASE_SOURCE_UNREADABLE')
    }
    let lineage
    try {
        lineage = JSON.parse(await readFileImpl(`${input.sourceRoot}/.skincos-release-lineage.json`, 'utf8'))
    } catch {
        throw new Error('ATENDIMENTO_RELEASE_LINEAGE_UNREADABLE')
    }
    const lineageParent = String(lineage?.parentReleaseId || '').toLowerCase()
    const lineageTree = String(lineage?.sourceTree || '').toLowerCase()
    if (lineage?.releaseId !== input.releaseSha
        || !SHA.test(lineageParent)
        || (input.target === 'staging' && (!SHA.test(lineageTree) || lineage?.target !== 'staging'))
        || (input.predecessorSha && lineageParent !== input.predecessorSha)
        || lineage?.verifiedAncestor !== true) {
        throw new Error('ATENDIMENTO_RELEASE_LINEAGE_INVALID')
    }
    if (input.target === 'staging') {
        let stagingManifest
        try {
            stagingManifest = JSON.parse(await readFileImpl(`${input.sourceRoot}/.skincos-atendimento-release.json`, 'utf8'))
        } catch {
            throw new Error('ATENDIMENTO_STAGING_RELEASE_MANIFEST_UNREADABLE')
        }
        const manifestSurface = Object.prototype.hasOwnProperty.call(stagingManifest || {}, 'surface')
            ? normalizeAtendimentoSurface(stagingManifest.surface)
            : 'clientes'
        const lineageSurface = Object.prototype.hasOwnProperty.call(lineage || {}, 'surface')
            ? normalizeAtendimentoSurface(lineage.surface)
            : 'clientes'
        if (stagingManifest?.releaseSha !== input.releaseSha
            || stagingManifest?.target !== 'staging'
            || stagingManifest?.domain !== 'atendimento'
            || stagingManifest?.syntheticOnly !== true
            || !manifestSurface
            || !lineageSurface
            || lineageSurface !== manifestSurface
            || (input.surface && manifestSurface !== input.surface)
            || (input.surface === 'full' && !Object.prototype.hasOwnProperty.call(stagingManifest, 'surface'))
            || String(stagingManifest?.sourceTree || '').toLowerCase() !== lineageTree) {
            throw new Error('ATENDIMENTO_STAGING_RELEASE_MANIFEST_INVALID')
        }
        input.surface = manifestSurface
    }
    for (const required of [
        'crm/api/server/atendimentoRuntime.js',
        'crm/api/server/atendimento/isolatedRuntimeControl.js',
        'scripts/runtime/install-atendimento-production-service.sh',
    ]) {
        try { await readFileImpl(`${input.sourceRoot}/${required}`, 'utf8') } catch { throw new Error('ATENDIMENTO_RELEASE_CONTENT_INVALID') }
    }
    return {
        valid: true,
        releaseSha: input.releaseSha,
        predecessorSha: lineageParent,
        target: input.target,
        surface: input.surface || 'clientes',
        readOnly: true,
        syntheticOnly: true,
    }
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    console.log(JSON.stringify(await validateAtendimentoRelease()))
}

export const __testables = { parseArgs }
