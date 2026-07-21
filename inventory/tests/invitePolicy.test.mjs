import assert from 'node:assert/strict';
import test from 'node:test';

import { hasRequiredInviteScope, normalizeInviteEmail, validateInviteDelegation } from '../src/invitePolicy.js';

test('normalizes the recipient email and requires both scopes', () => {
  assert.equal(normalizeInviteEmail(' Ana.Souza@Empresa.com '), 'ana.souza@empresa.com');
  assert.equal(normalizeInviteEmail('not-an-email'), '');
  assert.equal(hasRequiredInviteScope({ allowedUnits: ['novo-hamburgo'], allowedModules: ['insumos'] }), true);
  assert.equal(hasRequiredInviteScope({ allowedUnits: [], allowedModules: ['insumos'] }), false);
  assert.equal(hasRequiredInviteScope({ allowedUnits: ['novo-hamburgo'], allowedModules: [] }), false);
});

test('only scoped gestores can delegate lower roles within their own access', () => {
  const base = {
    actorRole: 'GESTOR',
    actorAllowedUnits: ['novo-hamburgo', 'barra-shopping-sul'],
    actorAllowedModules: ['users', 'insumos', 'status'],
    allowedUnits: ['novo-hamburgo'],
    allowedModules: ['insumos'],
  };

  assert.equal(validateInviteDelegation({ ...base, targetRole: 'CONSULTOR' }), null);
  assert.equal(validateInviteDelegation({ ...base, targetRole: 'GESTOR' }), 'ROLE_DENIED');
  assert.equal(validateInviteDelegation({ ...base, targetRole: 'ADMIN' }), 'ROLE_DENIED');
  assert.equal(validateInviteDelegation({ ...base, targetRole: 'GERENTE', allowedUnits: ['unidade-nao-permitida'] }), 'INVITE_UNITS_DENIED');
  assert.equal(validateInviteDelegation({ ...base, targetRole: 'SUPERVISOR', allowedModules: ['meta-ads'] }), 'INVITE_MODULES_DENIED');
  assert.equal(validateInviteDelegation({ ...base, actorAllowedModules: [], targetRole: 'CONSULTOR' }), 'INVITER_SCOPE_REQUIRED');
});
