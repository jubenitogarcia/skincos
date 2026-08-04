import assert from 'node:assert/strict'
import test from 'node:test'

import { contactPhoneLockKey, lockContactPhone, normalizeContactPhoneKey } from '../contactPhoneLock.js'

test('normalizes and locks one shared phone namespace for cross-module contact controls', async () => {
    const queries = []
    const tx = { query: async (sql, params) => queries.push({ sql, params }) }

    assert.equal(normalizeContactPhoneKey('+55 (11) 99999-9999'), '5511999999999')
    assert.equal(contactPhoneLockKey('5511999999999'), 'skincos.contact-phone:5511999999999')
    assert.equal(await lockContactPhone(tx, '(11) 99999-9999'), true)
    assert.deepEqual(queries, [{
        sql: 'select pg_advisory_xact_lock(hashtext($1)::bigint)',
        params: ['skincos.contact-phone:11999999999'],
    }])
    assert.equal(await lockContactPhone(tx, ''), false)
    assert.equal(queries.length, 1)
})
