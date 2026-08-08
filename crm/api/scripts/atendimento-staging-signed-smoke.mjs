#!/usr/bin/env node
import { createHmac, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readLiteralEnvironment } from '../server/atendimento/runtimeEnv.js'

const ENV_FILE = '/etc/skincos/crm-atendimento-staging.env'
const BASE_URL = 'http://127.0.0.1:8111'
const SHA = /^[0-9a-f]{40}$/
const READINESS_FIELDS = [
    'databaseReachable',
    'databaseIdentity',
    'schemaReady',
    'sourceOperationsReady',
    'clinicalApprovalReady',
    'transactionReadOnly',
    'migrationRegistryReadable',
    'persistentWritePrivilegesBlocked',
    'persistentPiiReadPrivilegesBlocked',
    'replayProtectionReady',
]
// This path is deliberately not a Clientes surface. A signed GET reaches the
// v2 actor verifier, then terminates without a store call or source-data read.
const SIGNATURE_PROBE_PATH = '/api/atendimento/__staging-smoke__/signature-replay'
// The outer read-only guard rejects this before the router, body parser, or
// any commercial/domain handler can receive a request.
const WRITE_PROBE_PATH = '/api/atendimento/__staging-smoke__/write-guard'

function parseArgs(args = []) {
    let expectedReleaseSha = ''
    for (let index = 0; index < args.length; index += 1) {
        const argument = String(args[index] || '')
        if (argument === '--expected-release-sha') {
            expectedReleaseSha = String(args[++index] || '').trim().toLowerCase()
        } else if (argument === '-h' || argument === '--help') {
            console.log('Usage: atendimento-staging-signed-smoke.mjs --expected-release-sha <full-sha>')
            process.exit(0)
        } else {
            throw new Error('ATENDIMENTO_STAGING_SMOKE_ARGUMENT_INVALID')
        }
    }
    if (!SHA.test(expectedReleaseSha)) throw new Error('ATENDIMENTO_STAGING_SMOKE_RELEASE_SHA_INVALID')
    return { expectedReleaseSha }
}

function actorSignatureMessage({ timestamp, nonce, method, path: requestPath, actor }) {
    return `atendimento-actor/v2.${timestamp}.${nonce}.${method}.${requestPath}.${actor}`
}

function sign(secret, message) {
    return createHmac('sha256', secret).update(message).digest('base64url')
}

async function responseJson(response) {
    try {
        return await response.clone().json()
    } catch {
        return {}
    }
}

function readinessIsReady(payload) {
    return payload?.ok === true && READINESS_FIELDS.every((field) => payload?.[field] === true)
}

async function signedRequest({ secret, actor, method, requestPath, nonce = randomUUID(), timestamp = String(Date.now()), fetchImpl = fetch }) {
    const headers = {
        accept: 'application/json',
        'x-crm-user': actor,
        'x-crm-ts': timestamp,
        'x-crm-signature-version': '2',
        'x-crm-nonce': nonce,
        'x-crm-signature': sign(secret, actorSignatureMessage({ timestamp, nonce, method, path: requestPath, actor })),
    }
    const response = await fetchImpl(new URL(requestPath, BASE_URL), {
        method,
        headers,
        signal: AbortSignal.timeout(10_000),
    })
    return { response, nonce, timestamp }
}

function controlsPassed(result) {
    return Object.values(result).every((value) => typeof value !== 'boolean' || value)
}

export async function runAtendimentoStagingSignedSmoke({
    expectedReleaseSha,
    fetchImpl = fetch,
    readEnvironment = readLiteralEnvironment,
} = {}) {
    const releaseSha = String(expectedReleaseSha || '').trim().toLowerCase()
    if (!SHA.test(releaseSha)) throw new Error('ATENDIMENTO_STAGING_SMOKE_RELEASE_SHA_INVALID')

    const values = await readEnvironment(ENV_FILE, {
        allowedKeys: ['ATENDIMENTO_ACTOR_HMAC_KEY', 'ATENDIMENTO_READINESS_TOKEN'],
    })
    const actorHmacKey = String(values.ATENDIMENTO_ACTOR_HMAC_KEY || '').trim()
    const readinessToken = String(values.ATENDIMENTO_READINESS_TOKEN || '').trim()
    if (!actorHmacKey || !readinessToken) throw new Error('ATENDIMENTO_STAGING_SMOKE_SECRET_MISSING')

    const actor = Buffer.from(JSON.stringify({
        id: 'clientes-staging-readonly-synthetic',
        role: 'GESTOR',
        allowedModules: ['atendimento'],
    })).toString('base64url')

    const health = await fetchImpl(new URL('/health', BASE_URL), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
    })
    const healthPayload = await responseJson(health)
    const readiness = await fetchImpl(new URL('/internal/readiness', BASE_URL), {
        headers: { accept: 'application/json', 'x-atendimento-readiness-token': readinessToken },
        signal: AbortSignal.timeout(10_000),
    })
    const readinessPayload = await responseJson(readiness)

    const nonce = randomUUID()
    const timestamp = String(Date.now())
    const signedProbe = await signedRequest({
        secret: actorHmacKey,
        actor,
        method: 'GET',
        requestPath: SIGNATURE_PROBE_PATH,
        nonce,
        timestamp,
        fetchImpl,
    })
    const replayProbe = await signedRequest({
        secret: actorHmacKey,
        actor,
        method: 'GET',
        requestPath: SIGNATURE_PROBE_PATH,
        nonce,
        timestamp,
        fetchImpl,
    })
    const writeProbe = await signedRequest({
        secret: actorHmacKey,
        actor,
        method: 'POST',
        requestPath: WRITE_PROBE_PATH,
        fetchImpl,
    })
    const signedPayload = await responseJson(signedProbe.response)
    const replayPayload = await responseJson(replayProbe.response)
    const writePayload = await responseJson(writeProbe.response)

    return {
        healthStatus: health.status,
        healthPublic: health.status === 200 && healthPayload?.ok === true,
        releaseShaMatches: healthPayload?.control?.releaseSha === releaseSha,
        readinessStatus: readiness.status,
        readinessReady: readiness.status === 200 && readinessIsReady(readinessPayload),
        signatureProbeStatus: signedProbe.response.status,
        signatureAccepted: signedProbe.response.status === 404 && signedPayload?.error === 'CLIENTES_SURFACE_ONLY',
        replayProbeStatus: replayProbe.response.status,
        replayRejected: replayProbe.response.status === 401 && replayPayload?.error === 'UNAUTHORIZED',
        writeProbeStatus: writeProbe.response.status,
        writeRejected: writeProbe.response.status === 405 && writePayload?.error === 'READ_ONLY_RUNTIME',
    }
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    const { expectedReleaseSha } = parseArgs(process.argv.slice(2))
    const result = await runAtendimentoStagingSignedSmoke({ expectedReleaseSha })
    console.log(JSON.stringify(result))
    if (!controlsPassed(result)) process.exitCode = 1
}

export const __testables = {
    actorSignatureMessage,
    controlsPassed,
    parseArgs,
    readinessIsReady,
    sign,
}
