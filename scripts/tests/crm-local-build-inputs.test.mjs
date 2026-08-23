import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { calculateBuildInputs, evaluateBuildReuse, writeBuildState } from '../crm-local-build-inputs.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-build-inputs-'))
  fs.mkdirSync(path.join(root, 'public'), { recursive: true })
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(root, 'App.tsx'), 'export const app = 1\n')
  fs.writeFileSync(path.join(root, 'package.json'), '{"scripts":{"build":"vite build"}}\n')
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n')
  fs.writeFileSync(path.join(root, 'public', 'asset.txt'), 'asset-v1\n')
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<p>built</p>\n')
  return root
}

test('build input fingerprint is deterministic and ignores local/runtime state', (context) => {
  const root = fixture()
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const initial = calculateBuildInputs(root)

  fs.mkdirSync(path.join(root, 'node_modules', 'example'), { recursive: true })
  fs.writeFileSync(path.join(root, 'node_modules', 'example', 'index.js'), 'ignored\n')
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<p>new generated output</p>\n')
  fs.writeFileSync(path.join(root, '.dev.vars'), 'SECRET=ignored\n')
  fs.mkdirSync(path.join(root, '.wrangler'), { recursive: true })
  fs.writeFileSync(path.join(root, '.wrangler', 'state.json'), '{}\n')

  const afterLocalState = calculateBuildInputs(root)
  assert.equal(afterLocalState.inputFingerprint, initial.inputFingerprint)
  assert.equal(afterLocalState.lockFingerprint, initial.lockFingerprint)
})

test('auto build reuses only a matching fingerprint with an existing dist', (context) => {
  const root = fixture()
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-build-runtime-'))
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(runtime, { recursive: true, force: true })
  })
  const statePath = path.join(runtime, 'build-state.json')

  assert.deepEqual(
    evaluateBuildReuse({ root, statePath }).action,
    'build',
  )
  writeBuildState({
    root,
    statePath,
    persona: 'GESTOR',
    commit: 'a'.repeat(40),
    sourceFingerprint: `commit:${'a'.repeat(40)}`,
  })
  assert.equal(evaluateBuildReuse({ root, statePath }).action, 'reuse')

  fs.writeFileSync(path.join(root, 'App.tsx'), 'export const app = 2\n')
  const changed = evaluateBuildReuse({ root, statePath })
  assert.equal(changed.action, 'build')
  assert.equal(changed.reason, 'input_changed')
})

test('lockfile drift requires dependency alignment and state writes atomically', (context) => {
  const root = fixture()
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-build-lock-'))
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(runtime, { recursive: true, force: true })
  })
  const statePath = path.join(runtime, 'build-state.json')
  writeBuildState({ root, statePath, persona: 'GESTOR', commit: 'a'.repeat(40), sourceFingerprint: 'fixture' })

  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n')
  const changed = evaluateBuildReuse({ root, statePath })
  assert.equal(changed.action, 'build')
  assert.equal(changed.lockChanged, true)
  assert.equal(fs.readdirSync(runtime).some((entry) => entry.includes('.tmp.')), false)
})
