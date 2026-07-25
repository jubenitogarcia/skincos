import assert from 'node:assert/strict';
import test from 'node:test';
import { canCreateEmployee, resolveEmployeeProfile, validateOnboardingInput } from './employeeOnboarding.js';

test('normalizes business role aliases without granting technical ADMIN', () => {
  assert.equal(resolveEmployeeProfile('Diretor').profile, 'GESTOR');
  assert.equal(resolveEmployeeProfile('Admin').profile, 'GESTOR');
  assert.equal(resolveEmployeeProfile('Responsável Técnico').profile, 'INJETOR');
  assert.equal(resolveEmployeeProfile('OPERADOR').profile, 'INJETOR');
});

test('derives closed unit scopes and fail-closes pending profiles', () => {
  const input = validateOnboardingInput({ fullName: 'Pessoa Teste', corporateEmail: 'corp@example.com', personalEmail: 'personal@example.com', mobilePhone: '(51) 99999-9999', units: ['NH', 'Barra Shopping Sul'], jobTitle: 'Coordenador', department: 'Recepção' });
  assert.deepEqual(input.units, ['novo-hamburgo', 'barra-shopping-sul']);
  assert.equal(input.accountStatus, 'PENDING_ACCESS');
  assert.deepEqual(input.modules, []);
  assert.equal(validateOnboardingInput({ ...input, units: ['unidade-invalida'] }), null);
});

test('enforces hierarchy and unit subset without treating empty scope as global', () => {
  assert.equal(canCreateEmployee({ actorRole: 'GESTOR', actorAllowedUnits: ['novo-hamburgo'], targetProfile: 'GERENTE', units: ['novo-hamburgo'] }), null);
  assert.equal(canCreateEmployee({ actorRole: 'GERENTE', actorAllowedUnits: ['novo-hamburgo'], targetProfile: 'GESTOR', units: ['novo-hamburgo'] }), 'ROLE_DENIED');
  assert.equal(canCreateEmployee({ actorRole: 'GESTOR', actorAllowedUnits: [], targetProfile: 'CONSULTOR', units: ['novo-hamburgo'] }), 'INVITER_SCOPE_REQUIRED');
  assert.equal(canCreateEmployee({ actorRole: 'GESTOR', actorAllowedUnits: ['novo-hamburgo'], targetProfile: 'CONSULTOR', units: ['barra-shopping-sul'] }), 'INVITE_UNITS_DENIED');
});
