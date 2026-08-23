import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  LOCAL_LAUNCH_PORT_PLAN,
  discoverLocalLaunchCatalog,
} from './crm-local-module-catalog.mjs'

test('discovers exactly 14 Gestor and 2 Consultor launch combinations', () => {
  const output = discoverLocalLaunchCatalog()
  assert.equal(output.schemaVersion, 1)
  assert.deepEqual(output.roles, [
    { role: 'Gestor', roleKey: 'GESTOR' },
    { role: 'Consultor', roleKey: 'CONSULTOR' },
  ])
  assert.equal(output.combinations.filter((entry) => entry.roleKey === 'GESTOR').length, 14)
  assert.deepEqual(
    output.combinations.filter((entry) => entry.roleKey === 'CONSULTOR').map((entry) => entry.module),
    ['atendimento', 'ponto'],
  )
  assert.equal(output.combinations.length, 16)
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
})

test('CLI emits one JSON object and refuses forbidden combinations', () => {
  const script = fileURLToPath(new URL('./crm-local-module-catalog.mjs', import.meta.url))
  const success = spawnSync(process.execPath, [script, '--json', '--role', 'CONSULTOR'], { encoding: 'utf8' })
  assert.equal(success.status, 0, success.stderr)
  const parsed = JSON.parse(success.stdout)
  assert.equal(parsed.combinations.length, 2)

  const denied = spawnSync(process.execPath, [script, '--json', '--role', 'CONSULTOR', '--module', 'insumos'], { encoding: 'utf8' })
  assert.equal(denied.status, 2)
  assert.match(denied.stderr, /CRM_LOCAL_COMBINATION_NOT_AVAILABLE/)
})
