import assert from 'node:assert/strict'
import test from 'node:test'
import { __testables, runAtendimentoStagingSignedSmoke } from './atendimento-staging-signed-smoke.mjs'

const RELEASE_SHA = 'a'.repeat(40)
const ACTOR_KEY = 'staging-smoke-test-key'
const READINESS_TOKEN = 'staging-smoke-readiness-token'

function response(status, body) {
    return {
        status,
        clone() {
            return { json: async () => body }
        },
    }
}

function readyPayload() {
    return {
        ok: true,
        databaseReachable: true,
        databaseIdentity: true,
        schemaReady: true,
        sourceOperationsReady: true,
        clinicalApprovalReady: true,
        transactionReadOnly: true,
        migrationRegistryReadable: true,
        persistentWritePrivilegesBlocked: true,
        persistentPiiReadPrivilegesBlocked: true,
        replayProtectionReady: true,
    }
}

test('staging signed smoke stays fixed to loopback and proves v2 replay plus the global write guard', async () => {
    const requests = []
    let signatureProbeCount = 0
    const result = await runAtendimentoStagingSignedSmoke({
        expectedReleaseSha: RELEASE_SHA,
        readEnvironment: async (filePath, options) => {
            assert.equal(filePath, '/etc/skincos/crm-atendimento-staging.env')
            assert.deepEqual(options, { allowedKeys: ['ATENDIMENTO_ACTOR_HMAC_KEY', 'ATENDIMENTO_READINESS_TOKEN'] })
            return { ATENDIMENTO_ACTOR_HMAC_KEY: ACTOR_KEY, ATENDIMENTO_READINESS_TOKEN: READINESS_TOKEN }
        },
        fetchImpl: async (input, init = {}) => {
            const url = new URL(String(input))
            requests.push({ url, init })
            if (url.pathname === '/health') return response(200, { ok: true, control: { releaseSha: RELEASE_SHA } })
            if (url.pathname === '/internal/readiness') return response(200, readyPayload())
            if (url.pathname === '/api/atendimento/__staging-smoke__/signature-replay') {
                signatureProbeCount += 1
                return signatureProbeCount === 1
                    ? response(404, { ok: false, error: 'CLIENTES_SURFACE_ONLY' })
                    : response(401, { ok: false, error: 'UNAUTHORIZED' })
            }
            if (url.pathname === '/api/atendimento/__staging-smoke__/write-guard') {
                return response(405, { ok: false, error: 'READ_ONLY_RUNTIME' })
            }
            throw new Error(`UNEXPECTED_SMOKE_PATH_${url.pathname}`)
        },
    })

    assert.deepEqual(result, {
        healthStatus: 200,
        healthPublic: true,
        releaseShaMatches: true,
        surfaceMatches: true,
        readinessStatus: 200,
        readinessReady: true,
        signatureProbeStatus: 404,
        signatureAccepted: true,
        unitScopeMatches: true,
        replayProbeStatus: 401,
        replayRejected: true,
        writeProbeStatus: 405,
        writeRejected: true,
    })
    assert.equal(__testables.controlsPassed(result), true)
    assert.equal(JSON.stringify(result).includes(ACTOR_KEY), false)
    assert.equal(JSON.stringify(result).includes(READINESS_TOKEN), false)
    assert.equal(requests.length, 5)
    for (const request of requests) {
        assert.equal(request.url.protocol, 'http:')
        assert.equal(request.url.hostname, '127.0.0.1')
        assert.equal(request.url.port, '8111')
    }

    const [health, readiness, signed, replay, write] = requests
    assert.deepEqual(health.init.headers, { accept: 'application/json' })
    assert.deepEqual(readiness.init.headers, {
        accept: 'application/json',
        'x-atendimento-readiness-token': READINESS_TOKEN,
    })
    assert.equal(signed.init.method, 'GET')
    assert.equal(replay.init.method, 'GET')
    assert.equal(signed.init.headers['x-crm-signature-version'], '2')
    assert.equal(signed.init.headers['x-crm-nonce'], replay.init.headers['x-crm-nonce'])
    assert.equal(signed.init.headers['x-crm-ts'], replay.init.headers['x-crm-ts'])
    assert.equal(signed.init.headers['x-crm-signature'], replay.init.headers['x-crm-signature'])
    assert.equal(signed.init.headers['x-crm-signature'], __testables.sign(
        ACTOR_KEY,
        __testables.actorSignatureMessage({
            timestamp: signed.init.headers['x-crm-ts'],
            nonce: signed.init.headers['x-crm-nonce'],
            method: 'GET',
            path: signed.url.pathname,
            actor: signed.init.headers['x-crm-user'],
        }),
    ))
    assert.equal(write.init.method, 'POST')
    assert.equal(write.init.body, undefined)
    assert.equal(write.init.headers['x-crm-signature-version'], '2')
    assert.notEqual(write.init.headers['x-crm-nonce'], signed.init.headers['x-crm-nonce'])
})

test('staging signed smoke fails closed when authenticated readiness omits a read-only invariant', async () => {
    const result = await runAtendimentoStagingSignedSmoke({
        expectedReleaseSha: RELEASE_SHA,
        readEnvironment: async () => ({ ATENDIMENTO_ACTOR_HMAC_KEY: ACTOR_KEY, ATENDIMENTO_READINESS_TOKEN: READINESS_TOKEN }),
        fetchImpl: async (input) => {
            const url = new URL(String(input))
            if (url.pathname === '/health') return response(200, { ok: true, control: { releaseSha: RELEASE_SHA } })
            if (url.pathname === '/internal/readiness') return response(200, { ...readyPayload(), persistentPiiReadPrivilegesBlocked: false })
            if (url.pathname === '/api/atendimento/__staging-smoke__/signature-replay') return response(404, { ok: false, error: 'CLIENTES_SURFACE_ONLY' })
            if (url.pathname === '/api/atendimento/__staging-smoke__/write-guard') return response(405, { ok: false, error: 'READ_ONLY_RUNTIME' })
            throw new Error('UNEXPECTED_SMOKE_PATH')
        },
    })

    assert.equal(result.readinessReady, false)
    assert.equal(__testables.controlsPassed(result), false)
})

test('staging signed smoke qualifies the explicit full surface with a consultant limited to Novo Hamburgo', async () => {
    let readCount = 0
    const result = await runAtendimentoStagingSignedSmoke({
        expectedReleaseSha: RELEASE_SHA,
        surface: 'full',
        readEnvironment: async () => ({ ATENDIMENTO_ACTOR_HMAC_KEY: ACTOR_KEY, ATENDIMENTO_READINESS_TOKEN: READINESS_TOKEN }),
        fetchImpl: async (input) => {
            const url = new URL(String(input))
            if (url.pathname === '/health') return response(200, { ok: true, control: { releaseSha: RELEASE_SHA, surface: 'full' } })
            if (url.pathname === '/internal/readiness') return response(200, readyPayload())
            if (url.pathname === '/api/atendimento/references') {
                readCount += 1
                return readCount === 1
                    ? response(200, { ok: true, units: ['novo-hamburgo'], members: [] })
                    : response(401, { ok: false, error: 'UNAUTHORIZED' })
            }
            if (url.pathname === '/api/atendimento/__staging-smoke__/write-guard') return response(405, { ok: false, error: 'READ_ONLY_RUNTIME' })
            throw new Error(`UNEXPECTED_FULL_SMOKE_PATH_${url.pathname}`)
        },
    })

    assert.deepEqual(result, {
        healthStatus: 200,
        healthPublic: true,
        releaseShaMatches: true,
        surfaceMatches: true,
        readinessStatus: 200,
        readinessReady: true,
        signatureProbeStatus: 200,
        signatureAccepted: true,
        unitScopeMatches: true,
        replayProbeStatus: 401,
        replayRejected: true,
        writeProbeStatus: 405,
        writeRejected: true,
    })
    assert.equal(__testables.controlsPassed(result), true)
})

test('staging signed smoke accepts only one literal full release SHA argument', () => {
    assert.deepEqual(__testables.parseArgs(['--expected-release-sha', RELEASE_SHA]), { expectedReleaseSha: RELEASE_SHA })
    assert.deepEqual(__testables.parseArgs(['--expected-release-sha', RELEASE_SHA, '--surface', 'full']), { expectedReleaseSha: RELEASE_SHA, surface: 'full' })
    assert.throws(
        () => __testables.parseArgs(['--expected-release-sha', '../not-a-sha']),
        (error) => error?.message === 'ATENDIMENTO_STAGING_SMOKE_RELEASE_SHA_INVALID',
    )
    assert.throws(
        () => __testables.parseArgs(['--environment', 'production']),
        (error) => error?.message === 'ATENDIMENTO_STAGING_SMOKE_ARGUMENT_INVALID',
    )
})
