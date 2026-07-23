import test from 'node:test'
import assert from 'node:assert/strict'

import { __testables } from '../routes.js'

function actorHeader(actor) {
    return Buffer.from(JSON.stringify(actor)).toString('base64url')
}

test('treats only the socket peer, never a forged Host header, as local', () => {
    assert.equal(__testables.isLocalRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'example.test' } }), true)
    assert.equal(__testables.isLocalRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { host: 'example.test' } }), true)
    assert.equal(__testables.isLocalRequest({ socket: { remoteAddress: '10.0.0.50' }, headers: { host: 'localhost' } }), false)
})

test('accepts an unsigned actor only from an explicit loopback development runtime', async () => {
    const before = process.env.CRM_LOCAL_NO_AUTH
    process.env.CRM_LOCAL_NO_AUTH = 'true'
    const headers = { 'x-crm-user': actorHeader({ id: 'operator-1', role: 'INJETOR', allowedUnits: ['novo-hamburgo'] }) }
    try {
        assert.equal(await __testables.verifySignedActor({ headers, socket: { remoteAddress: '10.0.0.50' } }, ''), null)
        assert.equal((await __testables.verifySignedActor({ headers, socket: { remoteAddress: '127.0.0.1' } }, ''))?.id, 'operator-1')
    } finally {
        if (before === undefined) delete process.env.CRM_LOCAL_NO_AUTH
        else process.env.CRM_LOCAL_NO_AUTH = before
    }
})

test('redacts untrusted internal failures before returning them to a browser', () => {
    const error = new Error('connect ECONNREFUSED postgres.internal:5432 for Cynthia Cordova')
    const response = __testables.errorPayload(error)
    assert.equal(response.status, 500)
    assert.deepEqual(response.body, { ok: false, error: 'INTERNAL_ERROR', hint: undefined })
})
