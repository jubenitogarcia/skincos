import { describe, expect, it, vi } from 'vitest'
import { resolveFinanceBootstrapEnabled } from '../financeBootstrap'

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

describe('Finance bootstrap convergence', () => {
  it('recovers from a transient upstream 503 without exposing Finance early', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(503, { ok: false, error: 'domain_service_degraded' }))
      .mockResolvedValueOnce(response(200, { ok: true, moduleEnabled: true, canAccess: true }))
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(resolveFinanceBootstrapEnabled({ fetchImpl, wait })).resolves.toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledWith(400)
  })

  it('fails closed without retrying an authorization denial', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(403, { ok: false, error: 'FINANCE_MODULE_DENIED' }))
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(resolveFinanceBootstrapEnabled({ fetchImpl, wait })).resolves.toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it('keeps the module hidden when the operational gate is disabled', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ok: true, moduleEnabled: false, canAccess: true }))

    await expect(resolveFinanceBootstrapEnabled({ fetchImpl })).resolves.toBe(false)
  })
})
