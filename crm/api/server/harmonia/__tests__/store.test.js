import assert from 'node:assert/strict'
import test from 'node:test'

import { createHarmoniaStore } from '../store/store.js'

test('Harmonia takes the shared phone lock before it persists an opt-out', async () => {
    const queries = []
    const tx = {
        query: async (sql, params) => {
            queries.push({ sql, params })
            if (sql.startsWith('select phone_raw from harmonia.contacts')) {
                return { rows: [{ phone_raw: '5511999999999' }] }
            }
            if (sql.startsWith('update harmonia.contacts set opted_out_at')) {
                return { rows: [{ id: 'contact-1', opted_out_at: '2026-08-04T18:00:00.000Z' }] }
            }
            return { rows: [] }
        },
    }
    const store = createHarmoniaStore({ databaseUrl: '' })

    assert.equal(await store.lockContactPhone(tx, '+55 (11) 99999-9999'), true)
    assert.equal(queries[0].params[0], 'skincos.contact-phone:5511999999999')

    queries.length = 0
    const optedOut = await store.markOptOut(tx, 'contact-1')
    assert.equal(optedOut.id, 'contact-1')
    assert.equal(queries[0].sql.startsWith('select phone_raw from harmonia.contacts'), true)
    assert.equal(queries[1].params[0], 'skincos.contact-phone:5511999999999')
    assert.equal(queries[2].sql.startsWith('update harmonia.contacts set opted_out_at'), true)
})
