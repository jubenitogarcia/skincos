import assert from 'node:assert/strict';
import test from 'node:test';

import { hasUnitScopeAccess } from '../../shared/identity-contract/index.js';

test('Inventory RBAC accepts only the canonical scope for a one-unit actor', () => {
  assert.equal(hasUnitScopeAccess({ role: 'GESTOR', allowedUnits: ['novo-hamburgo'] }, 'novo-hamburgo'), true);
  assert.equal(hasUnitScopeAccess({ role: 'GESTOR', allowedUnits: ['novo-hamburgo'] }, 'barra-shopping-sul'), false);
  assert.equal(hasUnitScopeAccess({ role: 'GESTOR', allowedUnits: ['barra-shopping-sul'] }, 'barra-shopping-sul'), true);
  assert.equal(hasUnitScopeAccess({ role: 'GESTOR', allowedUnits: ['barra-shopping-sul'] }, 'novo-hamburgo'), false);
});

test('Inventory RBAC supports both canonical scopes, aliases at Identity input, and preserves denial', () => {
  assert.equal(hasUnitScopeAccess({ role: 'GESTOR', allowedUnits: ['NH', 'BSS'] }, 'novo-hamburgo'), true);
  assert.equal(hasUnitScopeAccess({ role: 'GESTOR', allowedUnits: ['NH', 'BSS'] }, 'barra-shopping-sul'), true);
  assert.equal(hasUnitScopeAccess({ role: 'GESTOR', allowedUnits: [] }, 'novo-hamburgo'), false);
  assert.equal(hasUnitScopeAccess({ role: 'GESTOR', allowedUnits: ['novo-hamburgo'] }, 'invalida'), false);
  assert.equal(hasUnitScopeAccess({ role: 'ADMIN', allowedUnits: [] }, 'novo-hamburgo'), true);
});
