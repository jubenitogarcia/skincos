import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  acquireBuildLock,
  buildStateMatches,
  calculateBuildFingerprints,
  createBuildState,
  fingerprintBuildInputs,
  fingerprintDist,
  fingerprintLockfile,
  inspectBuildState,
  inspectBuildLock,
  readBuildState,
  releaseBuildLock,
  validateBuildState,
  writeBuildStateAtomic,
} from '../crm-local-build-state.mjs'

const helperPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'crm-local-build-state.mjs')
const fixtureFiles = {
  'App.tsx': 'export const App = () => null\n',
  'index.html': '<div id="root"></div>\n',
  'vite.config.ts': 'export default {}\n',
  'package.json': '{"name":"fixture","scripts":{"build":"vite build"}}\n',
  'package-lock.json': '{"lockfileVersion":3,"packages":{}}\n',
  'functions/api/status.ts': 'export const onRequest = () => new Response("ok")\n',
  'modules/example.ts': 'export const module = "example"\n',
  'public/logo.bin': Buffer.from([0, 1, 2, 255]),
  'scripts/check-bundle-budget.mjs': 'export const budget = 1\n',
}

async function writeFixture(root, entries = Object.entries(fixtureFiles)) {
  for (const [relativePath, content] of entries) {
    const target = path.join(root, relativePath)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, content)
  }
}

async function tempDirectory(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('build input fingerprint is deterministic across creation order and metadata changes', async (t) => {
  const first = await tempDirectory('crm-build-input-a-')
  const second = await tempDirectory('crm-build-input-b-')
  t.after(() => Promise.all([
    fsp.rm(first, { recursive: true, force: true }),
    fsp.rm(second, { recursive: true, force: true }),
  ]))
  await writeFixture(first)
  await writeFixture(second, Object.entries(fixtureFiles).reverse())

  const oldTime = new Date('2001-01-01T00:00:00.000Z')
  await fsp.utimes(path.join(second, 'App.tsx'), oldTime, oldTime)
  const left = await fingerprintBuildInputs(first, { includeEntries: true })
  const right = await fingerprintBuildInputs(second, { includeEntries: true })

  assert.equal(left.fingerprint, right.fingerprint)
  assert.equal(left.fileCount, Object.keys(fixtureFiles).length)
  assert.deepEqual(left.entries.map((entry) => entry.path), right.entries.map((entry) => entry.path))
})

test('build input fingerprint includes code, config, functions and public assets', async (t) => {
  const root = await tempDirectory('crm-build-includes-')
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  await writeFixture(root)
  let previous = await fingerprintBuildInputs(root)

  for (const relativePath of ['App.tsx', 'vite.config.ts', 'functions/api/status.ts', 'public/logo.bin', 'package.json']) {
    await fsp.appendFile(path.join(root, relativePath), Buffer.from([3]))
    const current = await fingerprintBuildInputs(root)
    assert.notEqual(current.fingerprint, previous.fingerprint, `${relativePath} did not invalidate the build`)
    previous = current
  }
})

test('build input fingerprint includes shared identity contract imported outside crm/console', async (t) => {
  const sourceRoot = await tempDirectory('crm-build-shared-input-')
  t.after(() => fsp.rm(sourceRoot, { recursive: true, force: true }))
  const consoleDir = path.join(sourceRoot, 'crm', 'console')
  const identityContract = path.join(sourceRoot, 'shared', 'identity-contract', 'index.js')
  await writeFixture(consoleDir)
  await writeFixture(consoleDir, [['dist/index.html', '<h1>built</h1>\n']])
  await fsp.mkdir(path.dirname(identityContract), { recursive: true })
  await fsp.writeFile(identityContract, 'export const normalizeUnit = (value) => value\n')

  const before = await calculateBuildFingerprints(consoleDir, { includeEntries: true })
  const state = createBuildState(before, { builtAt: '2026-07-29T12:00:00.000Z' })
  assert.ok(before.inputs.entries.some((entry) => entry.path === 'repo/shared/identity-contract/index.js'))

  await fsp.appendFile(identityContract, '// changed\n')
  const after = await calculateBuildFingerprints(consoleDir)

  assert.notEqual(after.inputs.fingerprint, before.inputs.fingerprint)
  assert.equal(after.lockfile.fingerprint, before.lockfile.fingerprint)
  assert.equal(after.dist.fingerprint, before.dist.fingerprint)
  assert.equal(buildStateMatches(state, after), false)
})

test('changing public/downloads invalidates the build input fingerprint and recorded state', async (t) => {
  const root = await tempDirectory('crm-build-public-downloads-')
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  await writeFixture(root)
  await writeFixture(root, [
    ['public/downloads/catalog.pdf', Buffer.from([0x25, 0x50, 0x44, 0x46, 0x31])],
    ['dist/index.html', '<h1>built</h1>\n'],
  ])

  const before = await calculateBuildFingerprints(root, { includeEntries: true })
  const state = createBuildState(before, { builtAt: '2026-07-29T12:00:00.000Z' })
  assert.ok(before.inputs.entries.some((entry) => entry.path === 'public/downloads/catalog.pdf'))

  await fsp.appendFile(path.join(root, 'public', 'downloads', 'catalog.pdf'), Buffer.from([0x32]))
  const after = await calculateBuildFingerprints(root)

  assert.notEqual(after.inputs.fingerprint, before.inputs.fingerprint)
  assert.equal(after.lockfile.fingerprint, before.lockfile.fingerprint)
  assert.equal(after.dist.fingerprint, before.dist.fingerprint)
  assert.equal(buildStateMatches(state, after), false)
})

test('build input fingerprint excludes local state and generated artifacts', async (t) => {
  const root = await tempDirectory('crm-build-excludes-')
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  await writeFixture(root)
  const baseline = await fingerprintBuildInputs(root)

  const excluded = {
    '.dev.vars': 'SECRET=value\n',
    '.dev.vars.local': 'SECRET=other\n',
    'node_modules/pkg/index.js': 'generated\n',
    'dist/index.html': 'generated\n',
    '.wrangler/state.json': '{}\n',
    '.wrangler-staging/state.json': '{}\n',
    'test-results/result.json': '{}\n',
    'playwright-report/index.html': 'report\n',
    '.playwright-output/trace.zip': 'trace\n',
    'logs/runtime.txt': 'local output\n',
    'pids/runtime.pid.lock': '123\n',
    'downloads/export.json': '{}\n',
    'tests/unit.test.ts': 'throw new Error("test only")\n',
    'e2e/example.spec.ts': 'test("only")\n',
    'runtime.log': 'local log\n',
  }
  await writeFixture(root, Object.entries(excluded))
  const current = await fingerprintBuildInputs(root, { includeEntries: true })

  assert.equal(current.fingerprint, baseline.fingerprint)
  for (const relativePath of Object.keys(excluded)) {
    assert.ok(!current.entries.some((entry) => entry.path === relativePath), `${relativePath} was included`)
  }
})

test('lockfile fingerprint is independent and detects dependency changes', async (t) => {
  const root = await tempDirectory('crm-lockfile-fingerprint-')
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  await writeFixture(root)

  const first = await fingerprintLockfile(root)
  await fsp.appendFile(path.join(root, 'App.tsx'), '// code only\n')
  assert.equal((await fingerprintLockfile(root)).fingerprint, first.fingerprint)
  await fsp.appendFile(path.join(root, 'package-lock.json'), '\n')
  assert.notEqual((await fingerprintLockfile(root)).fingerprint, first.fingerprint)
})

test('dist fingerprint distinguishes missing, empty and changed artifacts', async (t) => {
  const root = await tempDirectory('crm-dist-fingerprint-')
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  await writeFixture(root)
  assert.deepEqual(await fingerprintDist(root), {
    fingerprint: null,
    fileCount: 0,
    totalBytes: 0,
    exists: false,
  })

  await fsp.mkdir(path.join(root, 'dist'))
  const empty = await fingerprintDist(root)
  assert.equal(empty.exists, true)
  assert.match(empty.fingerprint, /^sha256:[a-f0-9]{64}$/)

  await writeFixture(root, [['dist/index.html', '<h1>one</h1>\n']])
  const first = await fingerprintDist(root)
  await fsp.writeFile(path.join(root, 'dist', 'index.html'), '<h1>two</h1>\n')
  const second = await fingerprintDist(root)
  assert.notEqual(second.fingerprint, first.fingerprint)
})

test('changing dist/downloads invalidates the artifact fingerprint and recorded state', async (t) => {
  const root = await tempDirectory('crm-build-dist-downloads-')
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  await writeFixture(root)
  await writeFixture(root, [
    ['dist/index.html', '<h1>built</h1>\n'],
    ['dist/downloads/catalog.pdf', Buffer.from([0x25, 0x50, 0x44, 0x46, 0x31])],
  ])

  const before = await calculateBuildFingerprints(root, { includeEntries: true })
  const state = createBuildState(before, { builtAt: '2026-07-29T12:00:00.000Z' })
  assert.ok(before.dist.entries.some((entry) => entry.path === 'downloads/catalog.pdf'))

  await fsp.appendFile(path.join(root, 'dist', 'downloads', 'catalog.pdf'), Buffer.from([0x32]))
  const after = await calculateBuildFingerprints(root)

  assert.equal(after.inputs.fingerprint, before.inputs.fingerprint)
  assert.equal(after.lockfile.fingerprint, before.lockfile.fingerprint)
  assert.notEqual(after.dist.fingerprint, before.dist.fingerprint)
  assert.equal(buildStateMatches(state, after), false)
})

test('valid build state is written atomically and read back', async (t) => {
  const root = await tempDirectory('crm-build-state-')
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  await writeFixture(root)
  await writeFixture(root, [['dist/index.html', '<h1>built</h1>\n']])
  const fingerprints = await calculateBuildFingerprints(root)
  const state = createBuildState(fingerprints, { builtAt: '2026-07-29T12:00:00.000Z' })
  const stateFile = path.join(root, 'private-state', 'build-state.json')

  await writeBuildStateAtomic(stateFile, state)
  assert.deepEqual(await readBuildState(stateFile), state)
  assert.equal(buildStateMatches(state, fingerprints), true)
  assert.deepEqual(await fsp.readdir(path.dirname(stateFile)), ['build-state.json'])

  await fsp.writeFile(path.join(root, 'dist', 'index.html'), '<h1>changed</h1>\n')
  assert.equal(buildStateMatches(state, await calculateBuildFingerprints(root)), false)
})

test('invalid build state is rejected for validation, read and write', async (t) => {
  const root = await tempDirectory('crm-invalid-build-state-')
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const invalid = { version: 99, inputFingerprint: 'bad' }
  assert.equal(validateBuildState(invalid).valid, false)

  const stateFile = path.join(root, 'invalid.json')
  await fsp.writeFile(stateFile, JSON.stringify(invalid))
  await assert.rejects(readBuildState(stateFile), (error) => error.code === 'INVALID_BUILD_STATE')
  await assert.rejects(writeBuildStateAtomic(stateFile, invalid), (error) => error.code === 'INVALID_BUILD_STATE')
})

test('live lock cannot be stolen and only its token can release it', async (t) => {
  const root = await tempDirectory('crm-build-lock-live-')
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const lockDir = path.join(root, 'build.lock')

  const first = await acquireBuildLock(lockDir, { ownerPid: process.pid })
  assert.equal(first.acquired, true)
  const second = await acquireBuildLock(lockDir, { ownerPid: process.pid, token: 'second-token' })
  assert.equal(second.acquired, false)
  assert.equal(second.reason, 'owner_alive')
  await assert.rejects(releaseBuildLock(lockDir, 'wrong-token'), (error) => error.code === 'LOCK_NOT_OWNER')
  assert.equal((await inspectBuildLock(lockDir)).exists, true)
  assert.equal((await releaseBuildLock(lockDir, first.owner.token)).released, true)
  assert.equal((await inspectBuildLock(lockDir)).exists, false)
})

test('dead lock owner is recovered without deleting a live replacement', async (t) => {
  const root = await tempDirectory('crm-build-lock-stale-')
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const lockDir = path.join(root, 'build.lock')
  await fsp.mkdir(lockDir)
  await fsp.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({
    version: 1,
    token: 'dead-owner',
    pid: 2_000_000_000,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
    processStartMarker: null,
  }))

  const acquired = await acquireBuildLock(lockDir, { ownerPid: process.pid, token: 'replacement' })
  assert.equal(acquired.acquired, true)
  assert.equal(acquired.owner.token, 'replacement')
  assert.equal((await inspectBuildLock(lockDir)).owner.token, 'replacement')
  await releaseBuildLock(lockDir, 'replacement')
})

test('CLI emits machine-readable JSON for Bash integration', async (t) => {
  const root = await tempDirectory('crm-build-cli-')
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  await writeFixture(root)
  await writeFixture(root, [['dist/index.html', '<h1>built</h1>\n']])

  const result = spawnSync(process.execPath, [
    helperPath,
    'fingerprint',
    '--console-dir',
    root,
    '--json',
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.ok, true)
  assert.match(output.inputs.fingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.match(output.lockfile.fingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.match(output.dist.fingerprint, /^sha256:[a-f0-9]{64}$/)
})

test('inspect CLI resolves a source root and validates the recorded artifact state', async (t) => {
  const sourceRoot = await tempDirectory('crm-build-inspect-')
  t.after(() => fsp.rm(sourceRoot, { recursive: true, force: true }))
  const consoleDir = path.join(sourceRoot, 'crm', 'console')
  const stateFile = path.join(sourceRoot, 'private', 'build-state.json')
  await writeFixture(consoleDir)
  await fsp.mkdir(path.join(sourceRoot, 'shared', 'identity-contract'), { recursive: true })
  await fsp.writeFile(
    path.join(sourceRoot, 'shared', 'identity-contract', 'index.js'),
    'export const normalizeUnit = (value) => value\n',
  )

  let inspection = await inspectBuildState(sourceRoot, stateFile)
  assert.equal(inspection.artifactFingerprint, null)
  assert.equal(inspection.stateValid, false)

  await writeFixture(consoleDir, [['dist/index.html', '<h1>built</h1>\n']])
  const fingerprints = await calculateBuildFingerprints(consoleDir)
  await writeBuildStateAtomic(stateFile, createBuildState(fingerprints))
  inspection = await inspectBuildState(sourceRoot, stateFile)
  assert.match(inspection.artifactFingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.equal(inspection.stateValid, true)

  const result = spawnSync(process.execPath, [
    helperPath,
    'inspect',
    '--root',
    sourceRoot,
    '--state',
    stateFile,
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim().split('\n').length, 1)
  assert.deepEqual(Object.keys(JSON.parse(result.stdout)).sort(), [
    'artifactFingerprint',
    'inputFingerprint',
    'lockfileFingerprint',
    'stateValid',
  ])
  assert.equal(JSON.parse(result.stdout).stateValid, true)

  await fsp.writeFile(path.join(consoleDir, 'dist', 'index.html'), '')
  inspection = await inspectBuildState(sourceRoot, stateFile)
  assert.equal(inspection.artifactFingerprint, null)
  assert.equal(inspection.stateValid, false)
})

test('CLI lock acquisition uses the supplied Bash owner PID and reports contention', async (t) => {
  const root = await tempDirectory('crm-build-cli-lock-')
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const lockDir = path.join(root, 'build.lock')
  const acquired = spawnSync(process.execPath, [
    helperPath,
    'lock-acquire',
    '--lock-dir',
    lockDir,
    '--owner-pid',
    String(process.pid),
    '--json',
  ], { encoding: 'utf8' })
  assert.equal(acquired.status, 0, acquired.stderr)
  const owner = JSON.parse(acquired.stdout).owner
  assert.equal(owner.pid, process.pid)

  const busy = spawnSync(process.execPath, [
    helperPath,
    'lock-acquire',
    '--lock-dir',
    lockDir,
    '--owner-pid',
    String(process.pid),
    '--json',
  ], { encoding: 'utf8' })
  assert.equal(busy.status, 73, busy.stderr)
  assert.equal(JSON.parse(busy.stdout).reason, 'owner_alive')
  await releaseBuildLock(lockDir, owner.token)
})
