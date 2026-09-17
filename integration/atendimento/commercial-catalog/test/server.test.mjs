import assert from 'node:assert/strict'
import test from 'node:test'
import { createCommercialCatalogApp, resolveDatabaseSsl } from '../server.mjs'

test('uses explicit database SSL mode instead of forcing TLS on the local owner database', () => {
  assert.equal(resolveDatabaseSsl({ NODE_ENV: 'production', ATENDIMENTO_COMMERCIAL_CATALOG_DATABASE_SSL: 'disable' }, 'postgresql://localhost/db'), undefined)
  assert.deepEqual(resolveDatabaseSsl({ NODE_ENV: 'production', ATENDIMENTO_COMMERCIAL_CATALOG_DATABASE_SSL: 'require' }, 'postgresql://localhost/db'), { rejectUnauthorized: false })
  assert.equal(resolveDatabaseSsl({ NODE_ENV: 'production' }, 'postgresql://localhost/db?sslmode=disable'), undefined)
})

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()
  try { return await fn(`http://127.0.0.1:${port}`) } finally { await new Promise((resolve) => server.close(resolve)) }
}

test('requires the dedicated bearer token and exposes the generic contract', async () => {
  const app = createCommercialCatalogApp({
    token: 'catalog-secret',
    store: {
      async readiness() { return { ok: true } },
      async commercialCatalog() { return { schemaVersion: 'crm-commercial-catalog/v1', asOf: '2026-09-17', requestedUnits: ['novo-hamburgo'], units: { 'novo-hamburgo': { unitSlug: 'novo-hamburgo', offers: [] } }, unitSlug: 'novo-hamburgo', offers: [] } },
    },
  })
  await withServer(app, async (base) => {
    const denied = await fetch(`${base}/api/atendimento/internal/commercial/catalog?unit=novo-hamburgo`)
    assert.equal(denied.status, 401)
    const response = await fetch(`${base}/api/atendimento/internal/commercial/catalog?unit=novo-hamburgo`, { headers: { authorization: 'Bearer catalog-secret' } })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).schemaVersion, 'crm-commercial-catalog/v1')
  })
})
