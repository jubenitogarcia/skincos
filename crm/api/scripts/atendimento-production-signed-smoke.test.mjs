import assert from 'node:assert/strict'
import test from 'node:test'
import { __testables, runAtendimentoProductionSignedSmoke } from './atendimento-production-signed-smoke.mjs'

const RELEASE_SHA = 'a'.repeat(40)
const ACTOR_KEY = 'production-smoke-test-key'
const READINESS_TOKEN = 'production-smoke-readiness-token'

function response(status, payload) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

test('production smoke qualifies full surface with a Novo Hamburgo consultant and preserves read-only guards', async () => {
    let references = 0
    const result = await runAtendimentoProductionSignedSmoke({
        expectedReleaseSha: RELEASE_SHA,
        surface: 'full',
        readEnvironment: async () => ({
            ATENDIMENTO_ACTOR_HMAC_KEY: ACTOR_KEY,
            ATENDIMENTO_READINESS_TOKEN: READINESS_TOKEN,
        }),
        fetchImpl: async (input) => {
            const url = new URL(String(input))
            if (url.pathname === '/health') return response(200, { ok: true, control: { releaseSha: RELEASE_SHA, surface: 'full' } })
            if (url.pathname === '/internal/readiness') return response(200, { ok: true })
            if (url.pathname === '/api/atendimento/references') {
                references += 1
                return references === 1
                    ? response(200, { ok: true, units: [{ slug: 'novo-hamburgo' }] })
                    : response(401, { ok: false, error: 'UNAUTHORIZED' })
            }
            if (url.pathname === '/api/atendimento/commercial/policy') return response(503, { ok: false, error: 'COMMERCIAL_READS_DISABLED' })
            if (url.pathname === '/api/atendimento/commercial/actions') return response(405, { ok: false, error: 'READ_ONLY_RUNTIME' })
            throw new Error(`UNEXPECTED_PRODUCTION_SMOKE_PATH_${url.pathname}`)
        },
    })

    assert.deepEqual(result, {
        healthStatus: 200,
        healthPublic: true,
        releaseShaMatches: true,
        surfaceMatches: true,
        readinessStatus: 200,
        readinessReady: true,
        baseReadStatus: 200,
        baseReadAccepted: true,
        unitScopeMatches: true,
        baseReplayStatus: 401,
        baseReplayRejected: true,
        commercialReadStatus: 503,
        commercialReadsDisabled: true,
        writeStatus: 405,
        writeRejected: true,
    })
})

test('production smoke keeps the legacy clients parser and refuses invalid surfaces', () => {
    assert.deepEqual(__testables.parseArgs(['--expected-release-sha', RELEASE_SHA]), {
        expectedReleaseSha: RELEASE_SHA,
        surface: 'clientes',
    })
    assert.deepEqual(__testables.parseArgs(['--expected-release-sha', RELEASE_SHA, '--surface', 'full']), {
        expectedReleaseSha: RELEASE_SHA,
        surface: 'full',
    })
    assert.equal(__testables.unitScopeMatches({ units: [{ slug: 'novo-hamburgo' }] }, 'full'), true)
    assert.equal(__testables.unitScopeMatches({ units: [{ slug: 'barra-shopping-sul' }] }, 'full'), false)
    assert.throws(
        () => __testables.parseArgs(['--expected-release-sha', RELEASE_SHA, '--surface', 'other']),
        (error) => error?.message === 'ATENDIMENTO_SMOKE_SURFACE_INVALID',
    )
})
