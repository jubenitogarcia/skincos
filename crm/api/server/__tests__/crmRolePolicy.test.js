import assert from 'node:assert/strict'
import test from 'node:test'

import {
  crmRolePolicy,
  effectiveAllowedModules,
  normalizeCrmRole,
  validateCrmRolePolicy,
} from '../crmRolePolicy.js'

test('uses the canonical aliases and fixed Consultant grants', () => {
  for (const [alias, role] of Object.entries(crmRolePolicy.roleAliases)) {
    assert.equal(normalizeCrmRole(alias), role)
  }
  assert.deepEqual(
    effectiveAllowedModules('CONSULTOR', ['insumos', 'atendimento', 'status']),
    crmRolePolicy.fixedModuleGrants.CONSULTOR,
  )
  assert.deepEqual(
    effectiveAllowedModules('EMPLOYEE', []),
    crmRolePolicy.fixedModuleGrants.CONSULTOR,
  )
})

test('preserves normalized explicit grants for roles without a fixed policy', () => {
  assert.deepEqual(
    effectiveAllowedModules('GESTOR', ['insumos', ' insumos ', '', 'ponto']),
    ['insumos', 'ponto'],
  )
})

test('fails closed when fixed grants exceed the restricted role policy', () => {
  const policy = structuredClone(crmRolePolicy)
  policy.fixedModuleGrants.CONSULTOR.push('insumos')
  assert.throws(
    () => validateCrmRolePolicy(policy),
    /CRM_ROLE_POLICY_FIXED_GRANTS_OUTSIDE_POLICY:CONSULTOR/,
  )
})
