import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createAtendimentoStore } from '../store.js'

test('fails closed before the canary schema is managed', async () => {
    const store = createAtendimentoStore({
        schemaManaged: true,
        pool: { query: async () => ({ rows: [{}] }) },
    })
    await assert.rejects(
        store.commercialCanaryState({ id: 'gestor-1', role: 'GESTOR' }),
        (error) => error?.message === 'COMMERCIAL_CANARY_SELECTOR_NOT_READY' && error.statusCode === 503,
    )
})

test('keeps concurrency, scope, rollback, emergency-off and audit guards in the store', async () => {
    const source = await readFile(new URL('../store.js', import.meta.url), 'utf8')
    for (const invariant of [
        'pg_advisory_xact_lock(hashtext($1))',
        'for (const identityId of [...selectedIds].sort()) await acquireCommercialContactIdentityLock(client, identityId)',
        'COMMERCIAL_CANARY_COHORT_CONFLICT',
        'COMMERCIAL_CANARY_POLICY_CONFLICT',
        'COMMERCIAL_CANARY_SELECTION_SCOPE_OR_SOURCE_CHANGED',
        "'emergency_off'",
        "values('rollback'",
        'COMMERCIAL_CANARY_ROLLBACK_TARGET_NOT_ELIGIBLE',
        'commercial.canary.cohort.saved',
        "emergency ? 'emergency_off' : 'cohort_removed'",
        'messages_sent: 0',
    ]) {
        assert.match(source, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), invariant)
    }
})

test('keeps the cohort evidence schema append-only and idempotent', async () => {
    const sql = await readFile(new URL('../migrations/20260806_commercial_canary_identity_selector_v1.up.sql', import.meta.url), 'utf8')
    assert.match(sql, /idempotency_key text NOT NULL UNIQUE/)
    assert.match(sql, /commercial_canary_one_active_idx/)
    assert.match(sql, /BEFORE UPDATE OR DELETE/)
    assert.match(sql, /BEFORE TRUNCATE/)
    assert.match(sql, /unit_slug text NOT NULL/)
    assert.match(sql, /CHECK \(NOT \(snapshot \?\| ARRAY\[/)
})
