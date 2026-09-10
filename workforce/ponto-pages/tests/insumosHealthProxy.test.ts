import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../functions/api/insumos/health'

const context = (method = 'GET', env: Record<string, string> = {}) => ({
  request: new Request('https://ponto.example.test/api/insumos/health', { method, headers: { cookie: 'session=test', host: 'ponto.example.test' } }),
  env,
})

afterEach(() => vi.unstubAllGlobals())

describe('Ponto insumos health proxy', () => {
  it('fails closed before a governed environment binding exists', async () => {
    const response = await onRequest(context())
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: 'PONTO_INSUMOS_HEALTH_UNCONFIGURED' })
  })

  it('permits only read methods', async () => {
    const response = await onRequest(context('POST'))
    expect(response.status).toBe(405)
  })

  it('proxies only the approved production health endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, unidades: ['novo-hamburgo'] }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await onRequest(context('GET', { SKINCOS_DEPLOYMENT_ENV: 'production', INSUMOS_API_TARGET: 'https://api.skincos.com.br' }))
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('https://api.skincos.com.br/insumos/health', expect.objectContaining({ method: 'GET' }))
    await expect(response.json()).resolves.toMatchObject({ ok: true })
  })
})
