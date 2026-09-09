import { boundedProductionJson } from './public-read-production-http.mjs'

const worker = 'skincos-schedule-public-read'
const apiOrigin = 'https://api.cloudflare.com/client/v4'
const id = /^[a-f0-9]{32}$/
const fail = () => { throw new Error('production_adapter_private_surface_failed') }
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096

// Read-only supplemental proof: workers.dev/previews must still be checked by
// the caller. Canonical custody needs zone-read access across this account.
// No resource names, hostnames, patterns or provider diagnostics escape here.
export async function assertProductionAdapterPrivateSurface({ accountId, apiToken, fetchImpl = globalThis.fetch }) {
  try {
    if (typeof accountId !== 'string' || !id.test(accountId) || typeof apiToken !== 'string'
      || !/^[A-Za-z0-9_.-]{16,4096}$/.test(apiToken) || typeof fetchImpl !== 'function') fail()
    const deadline = Date.now() + 120_000
    const get = async (pathname, query = {}) => {
      const remaining = Math.min(15_000, deadline - Date.now())
      if (remaining <= 0) fail()
      const url = new URL(`${apiOrigin}${pathname}`)
      for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value))
      const controller = new AbortController()
      let timer
      try {
        return await Promise.race([
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error()) }, remaining) }),
          (async () => {
            const response = await fetchImpl(url.href, {
              method: 'GET', headers: { authorization: `Bearer ${apiToken}`, accept: 'application/json' },
              redirect: 'error', signal: controller.signal,
            })
            if (!response.ok || response.status < 200 || response.status >= 300 || response.redirected
              || (response.url && response.url !== url.href)) fail()
            const declared = response.headers.get('content-length')
            if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 256 * 1024)) fail()
            const payload = await boundedProductionJson(response)
            if (controller.signal.aborted || payload?.success !== true || !Array.isArray(payload.result)
              || (payload.errors !== undefined && (!Array.isArray(payload.errors) || payload.errors.length))) fail()
            return payload
          })(),
        ])
      } finally { clearTimeout(timer); controller.abort() }
    }
    const list = async (pathname, { query = {}, paginated = false } = {}) => {
      const items = [], seen = new Set()
      let expectedTotal, expectedPages, pageSize
      for (let page = 1; page <= 100; page++) {
        const payload = await get(pathname, { ...query, page, per_page: 50 })
        for (const item of payload.result) {
          if (!item || typeof item !== 'object' || Array.isArray(item) || !text(item.id) || seen.has(item.id)) fail()
          seen.add(item.id); items.push(item)
        }
        if (items.length > 5000) fail()
        const info = payload.result_info
        // Zones is explicitly paginated. Routes/domains also expose complete
        // unpaginated lists; when pagination metadata is present it is binding.
        if (info === undefined || info === null) {
          if (paginated || page !== 1) fail()
          return items
        }
        if (!Number.isSafeInteger(info.total_count) || info.total_count < 0 || info.total_count > 5000
          || !Number.isSafeInteger(info.total_pages) || info.total_pages < 0 || info.total_pages > 100
          || info.page !== page || !Number.isSafeInteger(info.per_page) || info.per_page < 1 || info.per_page > 50
          || (info.count !== undefined && info.count !== payload.result.length)
          || (info.total_count === 0 ? ![0, 1].includes(info.total_pages) : info.total_pages !== Math.ceil(info.total_count / info.per_page))
          || payload.result.length !== Math.min(info.per_page, Math.max(0, info.total_count - (page - 1) * info.per_page))) fail()
        if (page === 1) { expectedTotal = info.total_count; expectedPages = info.total_pages; pageSize = info.per_page }
        else if (info.total_count !== expectedTotal || info.total_pages !== expectedPages || info.per_page !== pageSize) fail()
        if (items.length === expectedTotal) return items
      }
      fail()
    }
    const zones = await list('/zones', { query: { 'account.id': accountId, type: 'full,partial,secondary,internal', order: 'name', direction: 'asc' }, paginated: true })
    if (!zones.length || zones.some(zone => !id.test(zone.id) || zone.account?.id !== accountId)) fail()
    for (const zone of zones) {
      const routes = await list(`/zones/${zone.id}/workers/routes`)
      for (const route of routes) {
        if (!text(route.pattern) || ['script', 'service'].some(key => route[key] != null && !text(route[key]))
          || route.script === worker || route.service === worker) fail()
      }
    }
    const domains = await list(`/accounts/${accountId}/workers/domains`)
    for (const domain of domains) {
      if ((!text(domain.service) && !text(domain.script))
        || ['script', 'service'].some(key => domain[key] != null && !text(domain[key]))
        || domain.service === worker || domain.script === worker) fail()
    }
    if (Date.now() >= deadline) fail()
    return Object.freeze({ worker, zonesInspected: zones.length, publicRoutesAbsent: true, customDomainsAbsent: true })
  } catch { fail() }
}
