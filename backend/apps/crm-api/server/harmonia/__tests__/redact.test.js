import test from 'node:test'
import assert from 'node:assert/strict'
import { redactSecrets } from '../util/redact.js'

test('redactSecrets redacts apikey and tokens', () => {
    const input = {
        apikey: 'secret',
        nested: { authorization: 'Bearer x', access_token: 'y', ok: true },
    }
    const out = redactSecrets(input)
    assert.equal(out.apikey, '[REDACTED]')
    assert.equal(out.nested.authorization, '[REDACTED]')
    assert.equal(out.nested.access_token, '[REDACTED]')
    assert.equal(out.nested.ok, true)
})

