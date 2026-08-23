import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  LOCAL_LAUNCH_PORT_PLAN,
  discoverLocalLaunchCatalog,
} from './crm-local-module-catalog.mjs'

const sourceCatalog = JSON.parse(readFileSync(
  new URL('../crm/console/modules/localLaunchCatalog.json', import.meta.url),
  'utf8',
))
const sourceRolePolicy = JSON.parse(readFileSync(
  new URL('../crm/console/modules/localRolePolicy.json', import.meta.url),
  'utf8',
))

test('discovers every catalog-defined Gestor and policy-defined Consultor combination', () => {
  const output = discoverLocalLaunchCatalog()
  assert.equal(output.schemaVersion, 1)
  assert.equal(output.launcherContractVersion, 1)
  assert.match(output.launcherContractFingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.deepEqual(
    output.roles,
    sourceRolePolicy.launchRoles.map((role) => ({ role: role.label, roleKey: role.key })),
  )
  assert.equal(
    output.combinations.filter((entry) => entry.roleKey === 'GESTOR').length,
    sourceCatalog.modules.length,
  )
  assert.deepEqual(
    output.combinations.filter((entry) => entry.roleKey === 'CONSULTOR').map((entry) => entry.module),
    sourceRolePolicy.restrictedRoleModules.CONSULTOR,
  )
  assert.deepEqual(
    output.combinations
      .filter((entry) => entry.roleKey === 'CONSULTOR')
      .map((entry) => entry.auth),
    sourceRolePolicy.restrictedRoleModules.CONSULTOR.map(() => ({
      testUserAdmin: false,
      allowedModules: sourceRolePolicy.fixedModuleGrants.CONSULTOR,
    })),
  )
  assert.equal(
    output.combinations.length,
    sourceCatalog.modules.length + sourceRolePolicy.restrictedRoleModules.CONSULTOR.length,
  )
})

test('accepts a new local module without changing validator or port-plan code', () => {
  const catalog = structuredClone(sourceCatalog)
  catalog.catalogVersion += 1
  catalog.modules.push({
    key: 'future-module',
    label: 'Future Module',
    route: '/?module=future-module',
    dependencyIds: ['crm-local-adapter'],
  })

  const output = discoverLocalLaunchCatalog({ catalog, rolePolicy: sourceRolePolicy })
  const future = output.combinations.filter((entry) => entry.module === 'future-module')
  assert.equal(future.length, 1)
  assert.equal(future[0].roleKey, 'GESTOR')
  assert.equal(
    output.combinations.length,
    catalog.modules.length + sourceRolePolicy.restrictedRoleModules.CONSULTOR.length,
  )
  assert.equal(
    new Set(output.combinations.flatMap((entry) => Object.values(entry.ports).filter(Number.isInteger))).size,
    output.combinations.flatMap((entry) => Object.values(entry.ports).filter(Number.isInteger)).length,
  )
})

test('assigns deterministic collision-free port bundles and fingerprints', () => {
  const first = discoverLocalLaunchCatalog()
  const second = discoverLocalLaunchCatalog()
  assert.deepEqual(second, first)

  const runtimeIds = new Set()
  const ports = new Set()
  const fingerprints = new Set()
  for (const entry of first.combinations) {
    assert.match(entry.runtimeId, /^crm-local--[a-z0-9-]+--(?:gestor|consultor)$/)
    assert.match(entry.configFingerprint, /^sha256:[a-f0-9]{64}$/)
    assert.equal(entry.launcherContractVersion, first.launcherContractVersion)
    assert.equal(entry.launcherContractFingerprint, first.launcherContractFingerprint)
    assert.equal(runtimeIds.has(entry.runtimeId), false)
    assert.equal(fingerprints.has(entry.configFingerprint), false)
    runtimeIds.add(entry.runtimeId)
    fingerprints.add(entry.configFingerprint)
    for (const port of Object.values(entry.ports).filter(Number.isInteger)) {
      assert.equal(ports.has(port), false, `port ${port} collided`)
      ports.add(port)
    }
  }

  const shifted = discoverLocalLaunchCatalog({
    portPlan: {
      ...LOCAL_LAUNCH_PORT_PLAN,
      base: LOCAL_LAUNCH_PORT_PLAN.base + 1000,
    },
  })
  assert.notEqual(shifted.combinations[0].configFingerprint, first.combinations[0].configFingerprint)
})

test('exposes dependency flags and nullable service ports consistently', () => {
  const { combinations } = discoverLocalLaunchCatalog()
  for (const entry of combinations) {
    assert.deepEqual(Object.keys(entry.dependencies), ['insumos', 'timekeeping', 'whatsapp'])
    for (const service of ['insumos', 'timekeeping', 'whatsapp']) {
      assert.equal(entry.ports[service] === null, !entry.dependencies[service])
    }
  }
  assert.equal(combinations.find((entry) => entry.module === 'insumos')?.dependencies.insumos, true)
  assert.equal(combinations.find((entry) => entry.module === 'ponto')?.dependencies.timekeeping, true)
  assert.equal(combinations.find((entry) => entry.module === 'atendimento')?.dependencies.whatsapp, true)
  assert.equal(combinations.find((entry) => entry.module === 'unit-monitor')?.dependencies.whatsapp, true)
  assert.equal(combinations.find((entry) => entry.module === 'meta-ads')?.localScenario, 'connected-ready')
  assert.equal(combinations.find((entry) => entry.module === 'site-tracking')?.localScenario, 'connected-ready')
})

test('CLI emits one JSON object and refuses forbidden combinations', () => {
  const script = fileURLToPath(new URL('./crm-local-module-catalog.mjs', import.meta.url))
  const success = spawnSync(process.execPath, [script, '--json', '--role', 'CONSULTOR'], { encoding: 'utf8' })
  assert.equal(success.status, 0, success.stderr)
  const parsed = JSON.parse(success.stdout)
  assert.equal(
    parsed.combinations.length,
    sourceRolePolicy.restrictedRoleModules.CONSULTOR.length,
  )

  const denied = spawnSync(process.execPath, [script, '--json', '--role', 'CONSULTOR', '--module', 'insumos'], { encoding: 'utf8' })
  assert.equal(denied.status, 2)
  assert.match(denied.stderr, /CRM_LOCAL_COMBINATION_NOT_AVAILABLE/)
})

test('rejects fixed auth grants outside the role navigation policy', () => {
  const rolePolicy = structuredClone(sourceRolePolicy)
  rolePolicy.fixedModuleGrants.CONSULTOR.push('insumos')
  assert.throws(
    () => discoverLocalLaunchCatalog({ catalog: sourceCatalog, rolePolicy }),
    /CRM_LOCAL_ROLE_FIXED_GRANTS_OUTSIDE_POLICY:CONSULTOR/,
  )
})
