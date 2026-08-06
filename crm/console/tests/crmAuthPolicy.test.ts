import { describe, expect, it } from 'vitest'

import { getLocalDevAuthUser, isLocalDevAuthBypassEnabled } from '../functions/_lib/crmAuth'

describe('CRM auth adapter role policy', () => {
  it('narrows a legacy local consultant account before the browser or API proxy sees it', () => {
    const user = getLocalDevAuthUser({
      env: {
        LOCAL_AUTH_ROLE: 'CONSULTOR',
        LOCAL_AUTH_ALLOWED_MODULES: 'insumos,atendimento,status',
      },
    })

    expect(user.role).toBe('CONSULTOR')
    expect(user.allowedModules).toEqual(['atendimento'])
  })

  it('allows only the explicitly published WSL host for local bypass', () => {
    const request = (url: string, allowedHosts?: string) => ({
      request: new Request(url),
      env: { LOCAL_AUTH_BYPASS: 'true', LOCAL_AUTH_ALLOWED_HOSTS: allowedHosts },
    })

    expect(isLocalDevAuthBypassEnabled(request('http://172.18.61.30:25000/insumos', '172.18.61.30'))).toBe(true)
    expect(isLocalDevAuthBypassEnabled(request('http://172.18.61.30:25000/insumos', '10.0.0.7'))).toBe(false)
    expect(isLocalDevAuthBypassEnabled(request('http://localhost:25000/insumos'))).toBe(true)
  })
})
