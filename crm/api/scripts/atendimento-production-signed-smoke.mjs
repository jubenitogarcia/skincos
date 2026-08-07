#!/usr/bin/env node
import { createHmac, randomUUID } from 'node:crypto'
import { readLiteralEnvironment } from '../server/atendimento/runtimeEnv.js'

const ENV_FILE = '/etc/skincos/crm-clientes-production-readonly.env'
const BASE_URL = 'http://127.0.0.1:8110'
const SHA = /^[0-9a-f]{40}$/

function parseArgs(args = []) {
    let expectedReleaseSha = ''
    for (let index = 0; index < args.length; index += 1) {
        const argument = String(args[index] || '')
        if (argument === '--expected-release-sha') {
            expectedReleaseSha = String(args[++index] || '').trim().toLowerCase()
        } else if (argument === '-h' || argument === '--help') {
            console.log('Usage: atendimento-production-signed-smoke.mjs --expected-release-sha <full-sha>')
            process.exit(0)
        } else {
            throw new Error('ATENDIMENTO_SMOKE_ARGUMENT_INVALID')
        }
    }
    if (!SHA.test(expectedReleaseSha)) throw new Error('ATENDIMENTO_SMOKE_RELEASE_SHA_INVALID')
    return { expectedReleaseSha }
}

function actorSignatureMessage({ timestamp, nonce, method, path, actor }) {
    return `atendimento-actor/v2.${timestamp}.${nonce}.${method}.${path}.${actor}`
}

function sign(secret, message) {
    return createHmac('sha256', secret).update(message).digest('base64url')
}

async function signedRequest({ secret, actor, method, path, body, nonce = randomUUID() }) {
    const timestamp = String(Date.now())
    const headers = {
        accept: 'application/json',
        'x-crm-user': actor,
        'x-crm-ts': timestamp,
        'x-crm-signature-version': '2',
        'x-crm-nonce': nonce,
        'x-crm-signature': sign(secret, actorSignatureMessage({ timestamp, nonce, method, path, actor })),
    }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetch(new URL(path, BASE_URL), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
    })
    return { response, headers }
}

const { expectedReleaseSha } = parseArgs(process.argv.slice(2))
const values = await readLiteralEnvironment(ENV_FILE, {
    allowedKeys: ['ATENDIMENTO_ACTOR_HMAC_KEY', 'ATENDIMENTO_READINESS_TOKEN'],
})
const actorHmacKey = String(values.ATENDIMENTO_ACTOR_HMAC_KEY || '').trim()
const readinessToken = String(values.ATENDIMENTO_READINESS_TOKEN || '').trim()
if (!actorHmacKey || !readinessToken) throw new Error('ATENDIMENTO_SMOKE_SECRET_MISSING')

const actor = Buffer.from(JSON.stringify({
    id: 'clientes-readonly-synthetic',
    role: 'GESTOR',
    allowedModules: ['atendimento'],
})).toString('base64url')

const health = await fetch(new URL('/health', BASE_URL), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
})
let healthPayload = {}
try { healthPayload = await health.clone().json() } catch { /* health result stays false below */ }
const readiness = await fetch(new URL('/internal/readiness', BASE_URL), {
    headers: { accept: 'application/json', 'x-atendimento-readiness-token': readinessToken },
    signal: AbortSignal.timeout(10_000),
})
const firstRead = await signedRequest({
    secret: actorHmacKey,
    actor,
    method: 'GET',
    path: '/api/atendimento/commercial/policy',
})
const replay = await fetch(new URL('/api/atendimento/commercial/policy', BASE_URL), {
    method: 'GET',
    headers: firstRead.headers,
    signal: AbortSignal.timeout(10_000),
})
const write = await signedRequest({
    secret: actorHmacKey,
    actor,
    method: 'POST',
    path: '/api/atendimento/commercial/actions',
    body: {},
})
let writePayload = {}
try { writePayload = await write.response.clone().json() } catch { /* stable false below */ }

const result = {
    healthStatus: health.status,
    healthPublic: health.status === 200 && healthPayload?.ok === true,
    releaseShaMatches: healthPayload?.control?.releaseSha === expectedReleaseSha,
    readinessStatus: readiness.status,
    readinessReady: readiness.status === 200,
    signedReadStatus: firstRead.response.status,
    signedRead: firstRead.response.status === 200,
    replayStatus: replay.status,
    replayRejected: replay.status === 401,
    writeStatus: write.response.status,
    writeRejected: write.response.status === 405 && writePayload?.error === 'READ_ONLY_RUNTIME',
}
console.log(JSON.stringify(result))
if (!Object.values(result).every((value) => typeof value !== 'boolean' || value)) process.exitCode = 1

export const __testables = { actorSignatureMessage, parseArgs, sign }
