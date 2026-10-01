import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { CLIENTES_READONLY_STAGING_RELEASE_EVIDENCE_CONTRACT_VERSION } from '../src/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(root, 'scripts', 'release-evidence.mjs')
const releaseGate = path.join(root, 'scripts', 'release-gate.mjs')

function runEvidence(args) {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function runReleaseGate(args) {
  return execFileSync(process.execPath, [releaseGate, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

test('release identity evidence is generated outside the checkout for the current commit', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'clientes-readonly-evidence-'))
  const outputPath = path.join(temporaryDirectory, 'release-evidence.json')
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const sourceTree = execFileSync('git', ['rev-parse', `${sourceSha}^{tree}`], { cwd: root, encoding: 'utf8' }).trim()
  try {
    const result = JSON.parse(runEvidence(['--source-sha', sourceSha, '--output', outputPath]))
    const evidence = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    assert.deepEqual(result, { ok: true, target: 'staging', sourceSha, sourceTree })
    assert.deepEqual(evidence, {
      contract: CLIENTES_READONLY_STAGING_RELEASE_EVIDENCE_CONTRACT_VERSION,
      target: 'staging',
      sourceSha,
      sourceTree,
    })
    assert.throws(() => runReleaseGate([
      '--plan', 'release/staging-gate.json',
      '--require-ready',
      '--expected-source-sha', sourceSha,
      '--release-evidence', outputPath,
    ]), (error) => error?.status === 1 && String(error.stdout).includes('CLIENTES_RELEASE_DISABLED'))
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})

test('release identity evidence refuses a checked-in output path', () => {
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  assert.throws(() => runEvidence([
    '--source-sha', sourceSha,
    '--output', path.join(root, 'release', 'forbidden-evidence.json'),
  ]), (error) => error?.status === 2)
})
