import test from 'node:test'
import assert from 'node:assert/strict'

import { __testables } from '../mirror.js'

test('accepts only the local Atendimento mirror database as destination', () => {
    assert.equal(
        __testables.isLocalMirrorDestination('postgresql://skincos@/skincos_crm_local?host=/var/run/postgresql'),
        true,
    )
    assert.equal(
        __testables.isLocalMirrorDestination('postgresql://skincos@127.0.0.1:5432/skincos_crm_local'),
        true,
    )
    assert.equal(
        __testables.isLocalMirrorDestination('postgresql://skincos@db.example.test:5432/skincos_crm_local'),
        false,
    )
    assert.equal(
        __testables.isLocalMirrorDestination('postgresql://skincos@127.0.0.1:5432/skincos_crm'),
        false,
    )
})

test('builds a non-sensitive connection fingerprint for source and destination comparison', () => {
    const source = __testables.connectionFingerprint('postgresql://reader:secret@db.example.test:5432/production')
    const sameEndpointDifferentPassword = __testables.connectionFingerprint('postgresql://reader:other-secret@db.example.test:5432/production')
    const otherDatabase = __testables.connectionFingerprint('postgresql://reader:secret@db.example.test:5432/other')

    assert.equal(source, sameEndpointDifferentPassword)
    assert.notEqual(source, otherDatabase)
    assert.doesNotMatch(source, /secret/)
})
