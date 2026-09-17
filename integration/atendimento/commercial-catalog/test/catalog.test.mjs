import assert from 'node:assert/strict'
import test from 'node:test'
import { CATALOG_SCHEMA_VERSION, COMMERCIAL_CATALOG_SQL, createCatalogStore, mapCommercialOffer, normalizeCatalogUnits } from '../src/catalog.mjs'

test('normalizes only the two explicit catalog units', () => {
  assert.deepEqual(normalizeCatalogUnits({ units: 'novo-hamburgo,barra shopping sul' }), ['barra-shopping-sul', 'novo-hamburgo'])
  assert.throws(() => normalizeCatalogUnits({ unit: 'all' }), /UNIT_NOT_FOUND/)
  assert.throws(() => normalizeCatalogUnits({}), /UNIT_REQUIRED/)
})

test('maps an active offer without exposing database columns', () => {
  const offer = mapCommercialOffer({ id: 'offer-1', offer_key: 'test', unit_slug: 'novo-hamburgo', title: 'Teste', status: 'active', procedures: [] })
  assert.equal(offer.schemaVersion, 'crm-commercial-offer/v1')
  assert.equal(offer.unitSlug, 'novo-hamburgo')
  assert.equal(offer.id, undefined)
  assert.match(offer.contextHash, /^[a-f0-9]{64}$/)
})

test('reads the catalog with one parameterized read-only query and preserves both units', async () => {
  const calls = []
  const store = createCatalogStore({ pool: { async query(sql, params) {
    calls.push({ sql, params })
    if (sql.startsWith('select current_database')) return { rows: [{ database_name: 'skincos_clientes_production' }] }
    return { rows: [{ id: 'offer-1', offer_key: 'test', unit_slug: 'novo-hamburgo', title: 'Teste', status: 'active', procedures: [] }] }
  } }, clock: () => new Date('2026-09-17T12:00:00.000Z') })
  const result = await store.commercialCatalog({ units: ['novo-hamburgo', 'barra-shopping-sul'] })
  assert.equal(result.schemaVersion, CATALOG_SCHEMA_VERSION)
  assert.deepEqual(result.requestedUnits, ['barra-shopping-sul', 'novo-hamburgo'])
  assert.deepEqual(result.units['barra-shopping-sul'].offers, [])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].sql, COMMERCIAL_CATALOG_SQL)
  assert.deepEqual(calls[0].params, [['barra-shopping-sul', 'novo-hamburgo'], null])
})
