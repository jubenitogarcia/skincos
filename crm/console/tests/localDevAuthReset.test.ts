import { describe, expect, it, vi } from 'vitest'
import { consumeLocalAuthReset } from '../localDevAuthReset'

describe('local auth reset', () => {
  it('clears every local persona override before opening the requested module', () => {
    const removeItem = vi.fn()
    const clearCookie = vi.fn()
    const replaceUrl = vi.fn()

    expect(consumeLocalAuthReset(
      { href: 'http://localhost:8791/?module=ponto&localAuthReset=1', hostname: 'localhost' },
      { removeItem },
      clearCookie,
      replaceUrl,
    )).toBe(true)

    expect(removeItem.mock.calls.map(([key]) => key)).toEqual([
      'crm.localAuth',
      'crm.localRole',
      'crm.localEmail',
      'crm.localUser',
      'crm.localName',
    ])
    expect(replaceUrl).toHaveBeenCalledWith('/?module=ponto')
  })

  it('does not clear browser state outside localhost', () => {
    const removeItem = vi.fn()
    expect(consumeLocalAuthReset(
      { href: 'https://crm.skincos.com.br/?localAuthReset=1', hostname: 'crm.skincos.com.br' },
      { removeItem },
      vi.fn(),
      vi.fn(),
    )).toBe(false)
    expect(removeItem).not.toHaveBeenCalled()
  })
})
