import test from 'node:test'
import assert from 'node:assert/strict'

import { createAtendimentoStore } from '../store.js'

function createFakePool(handler) {
    const query = async (sql, params = []) => handler(String(sql || '').replace(/\s+/g, ' ').trim(), params)
    return {
        query,
        async connect() {
            return { query, release() {} }
        },
    }
}

function offerRow(overrides = {}) {
    return {
        id: 'offer-1',
        offer_key: 'botox-3-areas',
        revision: 4,
        unit_slug: 'barra-shopping-sul',
        title: 'Botox 3 áreas',
        description: 'Oferta vigente',
        price_cents: 129900,
        currency: 'BRL',
        price_qualifier: 'exact',
        installment_count: 6,
        installment_value_cents: 21650,
        discount_percent: 10,
        conditions: 'À vista ou em até 6 parcelas no cartão.',
        validity_start: '2026-08-01',
        validity_end: '2026-08-31',
        status: 'active',
        approved_by: 'gestor-1',
        approved_at: '2026-07-31T12:00:00.000Z',
        updated_at: '2026-07-31T12:00:00.000Z',
        procedures: [{
            id: 'procedure-1',
            name: 'Toxina botulínica',
            aliases: ['Botox'],
            quantity: 3,
            quantity_unit: 'áreas',
        }],
        ...overrides,
    }
}

test('commercialCatalog reads the official active catalog with procedure joins and no writes', async () => {
    const queries = []
    const pool = createFakePool((sql, params) => {
        queries.push({ sql, params })
        return { rows: [offerRow()], rowCount: 1 }
    })
    const store = createAtendimentoStore({ pool, schemaManaged: true })

    const result = await store.commercialCatalog({ units: ['novo-hamburgo', 'barra-shopping-sul'] })

    assert.equal(result.schemaVersion, 'crm-commercial-catalog/v1')
    assert.deepEqual(result.requestedUnits, ['barra-shopping-sul', 'novo-hamburgo'])
    const mappedOffer = result.units['barra-shopping-sul'].offers[0]
    assert.deepEqual(mappedOffer, {
        schemaVersion: 'crm-commercial-offer/v1',
        offerId: 'offer-1',
        offerKey: 'botox-3-areas',
        revision: 4,
        unitSlug: 'barra-shopping-sul',
        title: 'Botox 3 áreas',
        description: 'Oferta vigente',
        priceCents: 129900,
        currency: 'BRL',
        priceQualifier: 'exact',
        installmentCount: 6,
        installmentValueCents: 21650,
        discountPercent: 10,
        conditions: 'À vista ou em até 6 parcelas no cartão.',
        validityStart: '2026-08-01',
        validityEnd: '2026-08-31',
        procedures: [{
            id: 'procedure-1',
            name: 'Toxina botulínica',
            aliases: ['Botox'],
            quantity: 3,
            quantityUnit: 'áreas',
        }],
        status: 'active',
        approvedBy: 'gestor-1',
        approvedAt: '2026-07-31T12:00:00.000Z',
        updatedAt: '2026-07-31T12:00:00.000Z',
        contextHash: mappedOffer.contextHash,
    })
    assert.match(mappedOffer.contextHash, /^fnv1a-[a-f0-9]+$/)
    assert.deepEqual(result.units['novo-hamburgo'].offers, [])
    assert.equal(queries.length, 1)
    assert.deepEqual(queries[0].params, [['barra-shopping-sul', 'novo-hamburgo']])
    assert.match(queries[0].sql, /o\.status = 'active'/)
    assert.match(queries[0].sql, /validity_start is null or o\.validity_start <= current_date/)
    assert.match(queries[0].sql, /validity_end is null or o\.validity_end >= current_date/)
    assert.equal(queries[0].sql.toLowerCase().includes('insert '), false)
    assert.equal(queries[0].sql.toLowerCase().includes('update '), false)
    assert.equal(queries[0].sql.toLowerCase().includes('delete '), false)
})

test('commercialCatalog supports a single unit and the temporary Meta adapter keeps the old shape', async () => {
    const pool = createFakePool(() => ({ rows: [offerRow({ unit_slug: 'novo-hamburgo' })], rowCount: 1 }))
    const store = createAtendimentoStore({ pool, schemaManaged: true })

    const result = await store.commercialCatalog({ unit: 'Novo Hamburgo' })
    assert.equal(result.unitSlug, 'novo-hamburgo')
    assert.equal(result.offers[0].unitSlug, 'novo-hamburgo')

    const legacy = await store.metaAdsOfferContext({ unit: 'novo-hamburgo' })
    assert.deepEqual(Object.keys(legacy).sort(), ['asOf', 'offers', 'unitSlug'])
    assert.equal(legacy.unitSlug, 'novo-hamburgo')
})

test('commercialCatalog fails closed for absent, blank, unknown, and unsupported units', async () => {
    const pool = createFakePool(() => ({ rows: [], rowCount: 0 }))
    const store = createAtendimentoStore({ pool, schemaManaged: true })

    await assert.rejects(() => store.commercialCatalog({}), { message: 'UNIT_REQUIRED', statusCode: 400 })
    await assert.rejects(() => store.commercialCatalog({ units: '' }), { message: 'UNIT_REQUIRED', statusCode: 400 })
    await assert.rejects(() => store.commercialCatalog({ unit: 'invented-unit' }), { message: 'UNIT_NOT_FOUND', statusCode: 404 })
    await assert.rejects(() => store.commercialCatalog({ units: ['barra-shopping-sul', 'invented-unit'] }), { message: 'UNIT_NOT_FOUND', statusCode: 404 })
})
