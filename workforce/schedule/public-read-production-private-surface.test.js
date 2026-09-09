import test from 'node:test'
import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { readFileSync } from 'node:fs'
import { assertProductionAdapterPrivateSurface } from './scripts/public-read-production-private-surface.mjs'

const accountId = 'a'.repeat(32), apiToken = 'synthetic-private-api-token'
const worker = 'skincos-schedule-public-read'
const zone = number => ({ id: number.toString(16).padStart(32, '0'), account: { id: accountId } })
const body = (result, result_info) => ({ success: true, errors: [], result, ...(result_info === undefined ? {} : { result_info }) })
const page = (items, current, size = 50) => body(items.slice((current - 1) * size, current * size), {
  page: current, per_page: size, count: Math.min(size, Math.max(0, items.length - (current - 1) * size)),
  total_count: items.length, total_pages: Math.ceil(items.length / size),
})
const response = payload => new Response(JSON.stringify(payload))

function fixture({ zones = [zone(1)], domains = [], routes = [], override } = {}) {
  const calls = []
  const fetchImpl = async (address, options) => {
    const url = new URL(address); calls.push({ url, options })
    assert.equal(url.origin, 'https://api.cloudflare.com')
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error')
    assert.equal(options.headers.authorization, `Bearer ${apiToken}`)
    assert.equal(options.body, undefined)
    const replacement = await override?.(url, options, calls)
    if (replacement !== undefined) return replacement
    const current = Number(url.searchParams.get('page'))
    if (url.pathname === '/client/v4/zones') {
      assert.equal(url.searchParams.get('account.id'), accountId)
      assert.equal(url.searchParams.get('type'), 'full,partial,secondary,internal')
      return response(page(zones, current))
    }
    if (url.pathname.endsWith('/workers/routes')) return response(body(routes))
    assert.equal(url.pathname, `/client/v4/accounts/${accountId}/workers/domains`)
    return response(page(domains, current))
  }
  return { calls, fetchImpl, run: () => assertProductionAdapterPrivateSurface({ accountId, apiToken, fetchImpl }) }
}

test('private-surface proof scans every account zone and complete paginated domains using GET only', async () => {
  const h = fixture({ zones: Array.from({ length: 51 }, (_, index) => zone(index + 1)),
    domains: Array.from({ length: 51 }, (_, index) => ({ id: `synthetic-${index}`, service: 'other-worker' })),
    routes: [{ id: 'synthetic-disabled-route', pattern: 'synthetic.invalid/*', script: null }] })
  const proof = await h.run()
  assert.deepEqual(proof, { worker, zonesInspected: 51, publicRoutesAbsent: true, customDomainsAbsent: true })
  assert.equal(Object.isFrozen(proof), true)
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('/workers/routes')).length, 51)
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('/workers/domains')).length, 2)
  assert.equal(h.calls.filter(call => call.url.pathname === '/client/v4/zones').length, 2)
  assert.doesNotMatch(JSON.stringify(proof), /synthetic|api-token|\.invalid|accountId/)
})

test('any route or custom-domain association, including later pages and deprecated service/script fields, refuses proof', async () => {
  for (const mode of ['route-script', 'route-service', 'domain-service', 'domain-script']) {
    const key = mode.split('-')[1], isRoute = mode.startsWith('route')
    const h = fixture({ zones: Array.from({ length: 51 }, (_, index) => zone(index + 1)),
      domains: Array.from({ length: 51 }, (_, index) => ({ id: `synthetic-${index}`, [key]: index === 50 && !isRoute ? worker : 'other-worker' })),
      override: async url => isRoute && url.pathname === `/client/v4/zones/${zone(51).id}/workers/routes`
        ? response(body([{ id: 'synthetic-route', pattern: 'private-hostname.invalid/*', [key]: worker }])) : undefined,
    })
    await assert.rejects(h.run(), { message: 'production_adapter_private_surface_failed' })
  }
})

test('zones pagination fails closed on missing metadata, duplicates, truncation, count drift, foreign account and page budget', async () => {
  const valid = page([zone(1)], 1)
  const malformed = [body([zone(1)]), body([]), { ...valid, result: [zone(1), zone(1)] },
    { ...valid, result: [{ ...zone(1), account: { id: 'b'.repeat(32) } }] },
    { ...valid, result_info: { ...valid.result_info, total_count: 51, total_pages: 2 } },
    { ...valid, result_info: { ...valid.result_info, page: 2 } },
    { ...valid, result_info: { ...valid.result_info, total_count: 5001, total_pages: 101 } },
  ]
  for (const payload of malformed) {
    const h = fixture({ override: async () => response(payload) })
    await assert.rejects(h.run(), { message: 'production_adapter_private_surface_failed' })
    assert.equal(h.calls.length, 1)
  }
  const zones = Array.from({ length: 51 }, (_, index) => zone(index + 1))
  for (const mode of ['duplicate', 'missing', 'drift']) {
    const h = fixture({ zones, override: async url => {
      if (url.pathname !== '/client/v4/zones' || url.searchParams.get('page') !== '2') return undefined
      const payload = page(zones, 2)
      if (mode === 'duplicate') payload.result = [zone(1)]
      if (mode === 'missing') delete payload.result_info
      if (mode === 'drift') { payload.result_info.total_count = 52; payload.result_info.count = 2; payload.result.push(zone(52)) }
      return response(payload)
    } })
    await assert.rejects(h.run(), { message: 'production_adapter_private_surface_failed' })
  }
})

test('complete unpaginated custom domains are supported; malformed associations and incomplete pagination are not', async () => {
  const good = fixture({ override: async url => url.pathname.endsWith('/workers/domains') ? response(body([])) : undefined })
  assert.equal((await good.run()).customDomainsAbsent, true)
  for (const payload of [body([{ id: 'unclassifiable' }]), body([{ id: 'invalid-service', service: {} }]),
    body([], { page: 1, per_page: 50, total_pages: 2, total_count: 51 })]) {
    const h = fixture({ override: async url => url.pathname.endsWith('/workers/domains') ? response(payload) : undefined })
    await assert.rejects(h.run(), { message: 'production_adapter_private_surface_failed' })
  }
})

test('provider errors, redirects and oversized declared or streamed responses stay bounded and sanitized', async () => {
  for (const mode of ['throw', 'denied', 'redirect', 'declared', 'stream']) {
    const h = fixture({ override: async (_url, options) => {
      if (mode === 'throw') throw new Error(`private-hostname.invalid ${apiToken}`)
      if (mode === 'denied') return new Response(JSON.stringify({ success: false, errors: [{ message: apiToken }] }), { status: 403 })
      if (mode === 'redirect') return { ok: true, status: 200, redirected: true }
      if (mode === 'declared') return new Response('', { headers: { 'content-length': '262145' } })
      return new Response('x'.repeat(262145))
    } })
    await assert.rejects(h.run(), error => error.message === 'production_adapter_private_surface_failed'
      && error.cause === undefined && !inspect(error).includes(apiToken) && !inspect(error).includes('private-hostname'))
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.signal.aborted, true)
  }
})

test('request and response-body stalls stop at the fixed deadline without retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const bodyStall of [false, true]) {
    let signal, calls = 0
    const pending = assertProductionAdapterPrivateSurface({ accountId, apiToken, fetchImpl: async (_url, options) => {
      signal = options.signal; calls++
      if (!bodyStall) return new Promise(() => {})
      return new Response(new ReadableStream({ pull() { return new Promise(() => {}) } }))
    } })
    await Promise.resolve(); await Promise.resolve()
    t.mock.timers.tick(15_000)
    await assert.rejects(pending, { message: 'production_adapter_private_surface_failed' })
    assert.equal(calls, 1); assert.equal(signal.aborted, true)
  }
})

test('the fixed overall deadline prevents another account inventory request', async t => {
  let now = 1800000000000
  t.mock.method(Date, 'now', () => now)
  const h = fixture({ override: async () => { now += 120_000; return response(page([zone(1)], 1)) } })
  await assert.rejects(h.run(), { message: 'production_adapter_private_surface_failed' })
  assert.equal(h.calls.length, 1)
})

test('invalid input cannot choose another worker, origin or credential path', async () => {
  let calls = 0
  for (const patch of [{ accountId: 'foreign/path' }, { apiToken: 'short' }, { accountId: null }, { fetchImpl: null }]) {
    await assert.rejects(assertProductionAdapterPrivateSurface({ accountId, apiToken, fetchImpl: async () => { calls++ }, ...patch }),
      { message: 'production_adapter_private_surface_failed' })
  }
  assert.equal(calls, 0)
})

test('adapter checkpoints, readback and durable disabled recovery require complete private-surface proof', () => {
  const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
  const resources = read('./scripts/public-read-production-resources.mjs')
  const guard = read('./scripts/public-read-production-release-guard.mjs')
  assert.match(resources, /from '\.\/public-read-production-private-surface\.mjs'/)
  assert.match(resources, /return assertProductionAdapterPrivateSurface\(/)
  assert.match(resources.split("if (operation === 'checkpoint')")[1].split("if (operation === 'readback')")[0], /await privateAdapterSurface\(state === null\)/)
  assert.match(resources.split("if (operation === 'readback')")[1].split("if (operation === 'prepare')")[0], /await privateAdapterSurface\(\)/)
  assert.match(guard, /await assertProductionAdapterPrivateSurface\(/)
})
