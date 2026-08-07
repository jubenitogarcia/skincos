import assert from 'node:assert/strict'
import test from 'node:test'

import { createClientesSourceAdapters, __testables } from '../sourceAdapters.js'

const FINGERPRINT_KEY = 'source-operation-test-key-with-at-least-thirty-two-bytes'

test('fails closed before reading an external payload when the HMAC fingerprint key is absent', async () => {
    let read = false
    const adapters = createClientesSourceAdapters({
        fingerprintKey: '',
        readers: {
            'atendimento.google_sheet': async () => { read = true; return {} },
        },
    })

    const result = await adapters['atendimento.google_sheet'].read()
    assert.equal(result.status, 'unavailable')
    assert.equal(result.configured, false)
    assert.equal(result.errorCode, 'SOURCE_FINGERPRINT_KEY_UNAVAILABLE')
    assert.equal(read, false)
})

test('emits HMAC-backed aggregate proof without serializing a transient source payload', async () => {
    const adapters = createClientesSourceAdapters({
        fingerprintKey: FINGERPRINT_KEY,
        readers: {
            'atendimento.google_sheet': async () => ({
                tabs: ['unidade-a', 'unidade-b'],
                records: [
                    { date: '2026-08-06', privateRecord: 'synthetic-private-record' },
                    { date: '2026-08-07', privateRecord: 'synthetic-private-record' },
                ],
                cache: {},
            }),
        },
    })

    const result = await adapters['atendimento.google_sheet'].read()
    assert.equal(result.status, 'complete')
    assert.equal(result.snapshotProof.complete, true)
    assert.match(result.fingerprint, /^sha256:[a-f0-9]{64}$/)
    assert.match(result.snapshotProof.scopeHash, /^sha256:[a-f0-9]{64}$/)
    assert.equal(result.recordsRead, 2)
    assert.equal(result.snapshot.records[0].privateRecord, 'synthetic-private-record')
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private-record/)
})

test('uses a canonical HMAC fingerprint and permits a proven empty aggregate snapshot', async () => {
    assert.equal(
        __testables.hmacFingerprint(FINGERPRINT_KEY, { b: 2, a: { z: 1, y: 0 } }),
        __testables.hmacFingerprint(FINGERPRINT_KEY, { a: { y: 0, z: 1 }, b: 2 }),
    )
    const adapters = createClientesSourceAdapters({
        fingerprintKey: FINGERPRINT_KEY,
        pool: { async query() { return { rows: [{ records: 0, updated_at: null }] } } },
    })
    const result = await adapters['consent.harmonia_opt_outs'].read()
    assert.equal(result.status, 'complete')
    assert.equal(result.snapshotProof.complete, true)
    assert.equal(result.recordsRead, 0)
})

test('does not treat a reader-observation timestamp as a Gerência source watermark', async () => {
    const reader = async (importedAt) => ({
        importedAt,
        tabs: [{ tabName: 'procedimento' }, { tabName: 'equipe' }],
        rawRows: [{ privateRecord: 'synthetic-private-record' }],
        procedures: ['item-a'],
        schedules: [],
    })
    const first = createClientesSourceAdapters({
        fingerprintKey: FINGERPRINT_KEY,
        readers: { 'cadastro.gerencia_google_sheet': () => reader('2026-08-07T14:00:00.000Z') },
    })
    const second = createClientesSourceAdapters({
        fingerprintKey: FINGERPRINT_KEY,
        readers: { 'cadastro.gerencia_google_sheet': () => reader('2026-08-07T15:00:00.000Z') },
    })

    const [before, after] = await Promise.all([
        first['cadastro.gerencia_google_sheet'].read(),
        second['cadastro.gerencia_google_sheet'].read(),
    ])
    assert.equal(before.status, 'incomplete')
    assert.equal(after.status, 'incomplete')
    assert.equal(before.fingerprint, after.fingerprint)
    assert.equal(before.snapshotProof.complete, false)
})

test('marks the unavailable application registration connector explicitly instead of deriving freshness from materialization', async () => {
    const adapters = createClientesSourceAdapters({ fingerprintKey: FINGERPRINT_KEY })
    const result = await adapters['cadastro.app_registrations'].read()
    assert.equal(result.status, 'unavailable')
    assert.equal(result.errorCode, 'SOURCE_APP_REGISTRATION_CONNECTOR_UNAVAILABLE')
})

test('queries only aggregate fields for contact controls and records a safe complete proof', async () => {
    const queries = []
    const adapters = createClientesSourceAdapters({
        fingerprintKey: FINGERPRINT_KEY,
        pool: {
            async query(sql) {
                queries.push(sql)
                return { rows: [{ records: 2, updated_at: '2026-08-07T14:00:00.000Z' }] }
            },
        },
    })
    const result = await adapters['blocks.commercial_permissions'].read()
    assert.equal(result.status, 'complete')
    assert.equal(result.recordsRead, 2)
    assert.equal(result.snapshotProof.complete, true)
    assert.equal(queries.length, 1)
    assert.doesNotMatch(queries[0], /phone_raw|email|display_name/i)
})

test('accepts mutation only through an injected reviewed bridge, never a command string', async () => {
    const bridge = {
        backup: async () => ({ reference: 'backup.synthetic', encrypted: true, restorable: true, manifestHash: 'sha256:a'.padEnd(71, 'a') }),
        apply: async () => ({ recordsApplied: 1 }),
        rollback: async () => ({ rolledBack: true }),
    }
    const adapters = createClientesSourceAdapters({ fingerprintKey: FINGERPRINT_KEY, bridges: { 'atendimento.google_sheet': bridge } })
    assert.equal(typeof adapters['atendimento.google_sheet'].backup, 'function')
    assert.equal(typeof adapters['atendimento.google_sheet'].apply, 'function')
    assert.equal(typeof adapters['atendimento.google_sheet'].rollback, 'function')
    assert.equal(__testables.safeFingerprintKey('short'), null)
})
