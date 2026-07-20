import { describe, expect, it, vi } from 'vitest'
import { consumeLocalAuthReset } from '../localDevAuthReset'

describe('local CRM auth reset', () => {
  it('clears only the local auth opt-out and removes the one-time query parameter', () => {
    const removeItem = vi.fn()
    const clearCookie = vi.fn()
    const replaceUrl = vi.fn()

    const consumed = consumeLocalAuthReset(
      { href: 'http://localhost:8791/?module=insumos&localAuthReset=1', hostname: 'localhost' },
      { removeItem },
      clearCookie,
      replaceUrl,
    )

    expect(consumed).toBe(true)
    expect(removeItem).toHaveBeenCalledWith('crm.localAuth')
    expect(clearCookie).toHaveBeenCalledWith('crm.localAuth=; Path=/; Max-Age=0; SameSite=Lax')
    expect(clearCookie).toHaveBeenCalledWith('crm_local_auth=; Path=/; Max-Age=0; SameSite=Lax')
    expect(replaceUrl).toHaveBeenCalledWith('/?module=insumos')
  })

  it('does not affect a non-local URL or a normal launch', () => {
    const removeItem = vi.fn()
    const clearCookie = vi.fn()
    const replaceUrl = vi.fn()

    expect(consumeLocalAuthReset(
      { href: 'https://crm.skincos.com.br/?localAuthReset=1', hostname: 'crm.skincos.com.br' },
      { removeItem },
      clearCookie,
      replaceUrl,
    )).toBe(false)
    expect(removeItem).not.toHaveBeenCalled()
    expect(clearCookie).not.toHaveBeenCalled()
    expect(replaceUrl).not.toHaveBeenCalled()
  })
})
