import { describe, expect, it } from 'vitest'

import { resolveInsumosUnitAccess } from '../insumosUnitAccess'

describe('Insumos unit access reconciliation', () => {
  it('keeps Novo Hamburgo-only users within Novo Hamburgo', () => {
    expect(resolveInsumosUnitAccess({ role: 'GESTOR', allowedUnits: ['NH'], savedUnit: 'barra-shopping-sul' })).toMatchObject({
      allowedUnits: ['novo-hamburgo'], visibleUnits: ['novo-hamburgo'], selectedUnit: 'novo-hamburgo', hasAuthorizedUnit: true,
    })
  })

  it('reconciles legacy saved storage to Barra Shopping Sul', () => {
    expect(resolveInsumosUnitAccess({ role: 'GESTOR', allowedUnits: ['BarraShoppingSul'], savedUnit: 'Novo Hamburgo' })).toMatchObject({
      visibleUnits: ['barra-shopping-sul'], selectedUnit: 'barra-shopping-sul', hasAuthorizedUnit: true,
    })
    expect(resolveInsumosUnitAccess({ role: 'GESTOR', allowedUnits: ['BSS'], savedUnit: 'unidade-invalida' })).toMatchObject({
      visibleUnits: ['barra-shopping-sul'], selectedUnit: 'barra-shopping-sul', hasAuthorizedUnit: true,
    })
  })

  it('supports both scopes, user changes in the same browser, empty scopes, and ADMIN', () => {
    expect(resolveInsumosUnitAccess({ role: 'GESTOR', allowedUnits: ['novo-hamburgo', 'BSS'], savedUnit: 'BSS' })).toMatchObject({
      visibleUnits: ['novo-hamburgo', 'barra-shopping-sul'], selectedUnit: 'barra-shopping-sul', hasAuthorizedUnit: true,
    })
    expect(resolveInsumosUnitAccess({ role: 'GESTOR', allowedUnits: [], savedUnit: 'novo-hamburgo' })).toMatchObject({
      visibleUnits: [], selectedUnit: '', hasAuthorizedUnit: false,
    })
    expect(resolveInsumosUnitAccess({ role: 'ADMIN', allowedUnits: [], savedUnit: 'BSS' })).toMatchObject({
      visibleUnits: ['novo-hamburgo', 'barra-shopping-sul'], selectedUnit: 'barra-shopping-sul', hasAuthorizedUnit: true,
    })
  })
})
