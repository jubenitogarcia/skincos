import { describe, expect, it } from 'vitest'

import { getLocalDevAuthUser } from '../functions/_lib/crmAuth'

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
})
