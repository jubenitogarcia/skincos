import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCommercialProfile, elapsedDays, minimizeCommercialOverviewProfile, segmentCommercialProfiles } from '../clientCommercial.js'

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

test('keeps a single-source profile visible without presenting it as a confirmed merge', () => {
    const profile = buildCommercialProfile({
        identityId: 'identity-single',
        name: 'Cadastro isolado',
        sourceTypes: ['lead_profile'],
    }, { asOf: '2026-08-04' })

    assert.equal(profile.identityQuality, 'unresolved_single_source')
})

test('keeps direct identifiers out of the paginated commercial overview projection', () => {
    const overviewProfile = minimizeCommercialOverviewProfile({
        identityId: 'identity-1',
        name: 'Cliente de teste',
        phone: '5551999990000',
        email: 'cliente@example.test',
        priority: 'high',
    })
    assert.deepEqual(overviewProfile, { identityId: 'identity-1', priority: 'high' })
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
