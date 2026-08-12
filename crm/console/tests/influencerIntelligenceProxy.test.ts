import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequest, __testables } from '../functions/api/influencer-intelligence/[[path]].ts'

const baseEnv = {
  INFLUENCER_INTELLIGENCE_ENABLED: 'true',
  INFLUENCER_INTELLIGENCE_API_TARGET: 'http://127.0.0.1:8899',
  INFLUENCER_INTELLIGENCE_ACTOR_HMAC_KEY: 'synthetic-only-key',
  LOCAL_AUTH_BYPASS: 'true',
  LOCAL_AUTH_ALLOWED_MODULES: 'module.influencer-intelligence.access',
}

function context(path: string, init: RequestInit = {}, env: Record<string, unknown> = baseEnv) {
  return { request: new Request(`http://127.0.0.1${path}`, init), env }
}

describe('Influencer Intelligence CRM internal proxy', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('remains off when the server-side flag is absent', async () => {
    const response = await onRequest(context('/api/influencer-intelligence/v1/creators', {}, { ...baseEnv, INFLUENCER_INTELLIGENCE_ENABLED: 'false' }))
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ ok: false, error: 'NOT_FOUND' }))
  })

  it('requires the explicit server grant even for a local manager persona', async () => {
    const response = await onRequest(context('/api/influencer-intelligence/v1/creators', {}, { ...baseEnv, LOCAL_AUTH_ALLOWED_MODULES: 'influencer-intelligence' }))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ error: 'GRANT_REQUIRED' }))
  })

  it('forwards only an allowlisted read request and strips cookies and PII from the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { creatorKey: 'creator-1', handle: 'synthetic' }, email: 'not-needed@example.test' }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequest(context('/api/influencer-intelligence/v1/creators/creator-1/analysis', {
      headers: { cookie: 'session=secret', authorization: 'Bearer secret', accept: 'application/json' },
    }))

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({ data: { creatorKey: 'creator-1', handle: 'synthetic' } })
    expect(fetchMock).toHaveBeenCalledOnce()
    const upstream = fetchMock.mock.calls[0][0] as Request
    expect(upstream.url).toBe('http://127.0.0.1:8899/internal/influencer-intelligence/v1/creators/creator-1/analysis')
    expect(upstream.headers.get('cookie')).toBeNull()
    expect(upstream.headers.get('authorization')).toBeNull()
    expect(upstream.headers.get('x-crm-actor-scope')).toMatch(/^[a-f0-9]{64}$/)
    expect(upstream.headers.get('x-influencer-audit')).toBe('required')
  })

  it('permits only bounded registry and comparison bodies, never arbitrary provider paths', async () => {
    expect(__testables.hasGrant({ allowedModules: ['influencer-intelligence'] })).toBe(false)
    expect(__testables.hasGrant({ allowedModules: ['module.influencer-intelligence.access'] })).toBe(true)
    expect(__testables.isAllowedRoute('/v1/creators', 'POST')).toBe(true)
    expect(__testables.isAllowedRoute('/v1/compare', 'POST')).toBe(true)
    expect(__testables.isAllowedRoute('/v1/campaign-fit', 'POST')).toBe(true)
    expect(__testables.isAllowedRoute('/v1/providers/meta-graph/raw', 'GET')).toBe(false)
    expect(__testables.validateBody('/creators', { handle: '@creator' })).toBe(true)
    expect(__testables.validateBody('/creators', { handle: '@creator', token: 'secret' })).toBe(false)
    expect(__testables.validateBody('/compare', { creatorKeys: ['a', 'b'] })).toBe(true)
    expect(__testables.validateBody('/compare', { creatorKeys: ['a'], sql: 'select 1' })).toBe(false)
    expect(__testables.validateBody('/campaign-fit', { campaignKey: 'campaign-1', campaignVersion: 1, creatorKeys: ['a', 'b'] })).toBe(true)
    expect(__testables.validateBody('/campaign-fit', { campaignKey: 'campaign-1', brief: { category: 'skincare' } })).toBe(false)
  })
})
