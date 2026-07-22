import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCommercialProfile, elapsedDays, segmentCommercialProfiles } from '../clientCommercial.js'

test('commercial recency is based only on completed attendance, never on a later advance sale', () => {
    const profile = buildCommercialProfile({
        identityId: 'identity-1',
        name: 'Cliente',
        lastAttendance: '2025-01-01',
        lifetimeSales: 5000,
        saleCount: 3,
        // The sale date is intentionally absent from the commercial profile input.
    }, { asOf: '2026-01-01' })
    assert.equal(profile.recencyDays, 365)
    assert.equal(profile.ticketAverage, 1666.67)
})

test('future attendance dates do not produce a negative recency value', () => {
    assert.equal(elapsedDays('2026-12-01', '2026-07-22'), null)
    const profile = buildCommercialProfile({ lastAttendance: '2026-12-01', futureAttendanceCount: 1 }, { asOf: '2026-07-22' })
    assert.equal(profile.recencyDays, null)
    assert.deepEqual(profile.dataWarnings, ['atendimentos_futuros_excluidos'])
})

test('segments expose the evidence and do not infer a procedure balance', () => {
    const [profile] = segmentCommercialProfiles([{
        identityId: 'identity-1', name: 'Cliente', lastAttendance: '2025-01-01',
        lifetimeSales: 5000, saleCount: 1, visitCount: 1, procedureCount: 1,
        pendingSaleItems: 2,
    }], { asOf: '2026-01-01' })
    assert.ok(profile.segments.some((item) => item.key === 'return_at_risk'))
    assert.ok(profile.segments.some((item) => item.key === 'high_value_inactive'))
    assert.ok(profile.dataWarnings.includes('itens_de_venda_sem_classificacao'))
    assert.equal(profile.purchasedProcedures.length, 0)
})
