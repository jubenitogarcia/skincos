import test from 'node:test'
import assert from 'node:assert/strict'

import { actorSubject, opaqueActorSubject } from '../actorSubject.js'

test('accepts bounded opaque audit subjects', () => {
    assert.equal(opaqueActorSubject('crm:operator-1'), 'crm:operator-1')
    assert.equal(actorSubject({ subject: 'crm:operator-1', id: 'legacy-ignored' }), 'crm:operator-1')
    assert.equal(actorSubject({ subjectId: 'subject/1' }), 'subject/1')
    assert.equal(actorSubject({ id: 'operator_1' }), 'operator_1')
})

test('rejects PII-shaped or malformed audit subject fallbacks', () => {
    for (const value of [
        '',
        'operator@example.com',
        'Maria da Silva',
        ' operator-1 ',
        'operator\n1',
        'x'.repeat(161),
    ]) {
        assert.equal(opaqueActorSubject(value), value === ' operator-1 ' ? 'operator-1' : null)
    }
    assert.equal(actorSubject({ username: 'operator@example.com', email: 'operator@example.com' }), null)
})
