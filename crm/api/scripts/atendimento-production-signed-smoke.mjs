#!/usr/bin/env node
import { createHmac, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readLiteralEnvironment } from '../server/atendimento/runtimeEnv.js'

const ENV_FILE = '/etc/skincos/crm-clientes-production-readonly.env'
const BASE_URL = 'http://127.0.0.1:8110'
const SHA = /^[0-9a-f]{40}$/
const SURFACES = new Set(['clientes', 'full'])
const FULL_READ_PROBE_PATH = '/api/atendimento/references'

function parseArgs(args = []) {
    let expectedReleaseSha = ''
    let surface = 'clientes'
    for (let index = 0; index < args.length; index += 1) {
        const argument = String(args[index] || '')
        if (argument === '--expected-release-sha') {
            expectedReleaseSha = String(args[++index] || '').trim().toLowerCase()
        } else if (argument === '--surface') {
            surface = String(args[++index] || '').trim().toLowerCase()
        } else if (argument === '-h' || argument === '--help') {
            console.log('Usage: atendimento-production-signed-smoke.mjs --expected-release-sha <full-sha> [--surface <clientes|full>]')
            process.exit(0)
        } else {
            throw new Error('ATENDIMENTO_SMOKE_ARGUMENT_INVALID')
        }
    }
    if (!SHA.test(expectedReleaseSha)) throw new Error('ATENDIMENTO_SMOKE_RELEASE_SHA_INVALID')
    if (!SURFACES.has(surface)) throw new Error('ATENDIMENTO_SMOKE_SURFACE_INVALID')
    return { expectedReleaseSha, surface }
}

function actorSignatureMessage({ timestamp, nonce, method, path, actor }) {
    return `atendimento-actor/v2.${timestamp}.${nonce}.${method}.${path}.${actor}`
}

function sign(secret, message) {
    return createHmac('sha256', secret).update(message).digest('base64url')
}

function unitScopeMatches(payload, surface) {
    if (surface !== 'full') return true
    const units = Array.isArray(payload?.units) ? payload.units : []
    return units.length > 0 && units.every((unit) => {
        const value = typeof unit === 'object' && unit !== null
            ? (unit.slug || unit.unitSlug || unit.name)
            : unit
        return String(value || '').trim().toLowerCase() === 'novo-hamburgo'
    })
}

async function signedRequest({ secret, actor, method, path, body, nonce = randomUUID(), timestamp = String(Date.now()), fetchImpl = fetch }) {
    const headers = {
        accept: 'application/json',
        'x-crm-user': actor,
        'x-crm-ts': timestamp,
        'x-crm-signature-version': '2',
        'x-crm-nonce': nonce,
        'x-crm-signature': sign(secret, actorSignatureMessage({ timestamp, nonce, method, path, actor })),
    }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetchImpl(new URL(path, BASE_URL), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
    })
    return { response, headers }
}

export async function runAtendimentoProductionSignedSmoke({
    expectedReleaseSha,
    surface = 'clientes',
    fetchImpl = fetch,
    readEnvironment = readLiteralEnvironment,
} = {}) {
    const releaseSha = String(expectedReleaseSha || '').trim().toLowerCase()
    const normalizedSurface = String(surface || '').trim().toLowerCase()
    if (!SHA.test(releaseSha)) throw new Error('ATENDIMENTO_SMOKE_RELEASE_SHA_INVALID')
    if (!SURFACES.has(normalizedSurface)) throw new Error('ATENDIMENTO_SMOKE_SURFACE_INVALID')

    const values = await readEnvironment(ENV_FILE, {
        allowedKeys: ['ATENDIMENTO_ACTOR_HMAC_KEY', 'ATENDIMENTO_READINESS_TOKEN'],
    })
    const actorHmacKey = String(values.ATENDIMENTO_ACTOR_HMAC_KEY || '').trim()
    const readinessToken = String(values.ATENDIMENTO_READINESS_TOKEN || '').trim()
    if (!actorHmacKey || !readinessToken) throw new Error('ATENDIMENTO_SMOKE_SECRET_MISSING')

    const actor = Buffer.from(JSON.stringify({
        id: normalizedSurface === 'full' ? 'atendimento-production-consultor-synthetic' : 'clientes-readonly-synthetic',
        role: normalizedSurface === 'full' ? 'CONSULTOR' : 'GESTOR',
        allowedModules: ['atendimento'],
        ...(normalizedSurface === 'full' ? { allowedUnits: ['novo-hamburgo'] } : {}),
    })).toString('base64url')

    const health = await fetchImpl(new URL('/health', BASE_URL), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
    })
    let healthPayload = {}
    try { healthPayload = await health.clone().json() } catch { /* health result stays false below */ }
    const readiness = await fetchImpl(new URL('/internal/readiness', BASE_URL), {
        headers: { accept: 'application/json', 'x-atendimento-readiness-token': readinessToken },
        signal: AbortSignal.timeout(10_000),
    })
    const firstReadPath = normalizedSurface === 'full' ? FULL_READ_PROBE_PATH : '/api/atendimento/commercial/policy'
    const firstReadNonce = randomUUID()
    const firstReadTimestamp = String(Date.now())
    const firstRead = await signedRequest({
        secret: actorHmacKey,
        actor,
        method: 'GET',
        path: firstReadPath,
        nonce: firstReadNonce,
        timestamp: firstReadTimestamp,
        fetchImpl,
    })
    const replayRead = normalizedSurface === 'full'
        ? await signedRequest({
            secret: actorHmacKey,
            actor,
            method: 'GET',
            path: firstReadPath,
            nonce: firstReadNonce,
            timestamp: firstReadTimestamp,
            fetchImpl,
        })
        : null
    const commercialRead = normalizedSurface === 'full'
        ? await signedRequest({ secret: actorHmacKey, actor, method: 'GET', path: '/api/atendimento/commercial/policy', fetchImpl })
        : firstRead
    const write = await signedRequest({
        secret: actorHmacKey,
        actor,
        method: 'POST',
        path: '/api/atendimento/commercial/actions',
        body: {},
        fetchImpl,
    })
    let firstReadPayload = {}
    try { firstReadPayload = await firstRead.response.clone().json() } catch { /* stable false below */ }
    let replayPayload = {}
    if (replayRead) {
        try { replayPayload = await replayRead.response.clone().json() } catch { /* stable false below */ }
    }
    let writePayload = {}
    try { writePayload = await write.response.clone().json() } catch { /* stable false below */ }
    let commercialPayload = {}
    try { commercialPayload = await commercialRead.response.clone().json() } catch { /* stable false below */ }

    return {
        healthStatus: health.status,
        healthPublic: health.status === 200 && healthPayload?.ok === true,
        releaseShaMatches: healthPayload?.control?.releaseSha === releaseSha,
        surfaceMatches: normalizedSurface === 'clientes'
            ? (!healthPayload?.control?.surface || healthPayload?.control?.surface === 'clientes')
            : healthPayload?.control?.surface === 'full',
        readinessStatus: readiness.status,
        readinessReady: readiness.status === 200,
        baseReadStatus: firstRead.response.status,
        baseReadAccepted: normalizedSurface === 'full'
            ? firstRead.response.status === 200 && firstReadPayload?.ok === true
            : true,
        unitScopeMatches: unitScopeMatches(firstReadPayload, normalizedSurface),
        baseReplayStatus: replayRead?.response?.status ?? null,
        baseReplayRejected: normalizedSurface === 'full'
            ? replayRead.response.status === 401 && replayPayload?.error === 'UNAUTHORIZED'
            : true,
        commercialReadStatus: commercialRead.response.status,
        commercialReadsDisabled: commercialRead.response.status === 503 && commercialPayload?.error === 'COMMERCIAL_READS_DISABLED',
        writeStatus: write.response.status,
        writeRejected: write.response.status === 405 && writePayload?.error === 'READ_ONLY_RUNTIME',
    }
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    const { expectedReleaseSha, surface } = parseArgs(process.argv.slice(2))
    const result = await runAtendimentoProductionSignedSmoke({ expectedReleaseSha, surface })
    console.log(JSON.stringify(result))
    if (!Object.values(result).every((value) => typeof value !== 'boolean' || value)) process.exitCode = 1
}

export const __testables = { actorSignatureMessage, parseArgs, sign, unitScopeMatches }
