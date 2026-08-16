import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  calculateWebsitePreviewIdentity,
  DEFAULT_BUILD_CONTRACT,
  DEFAULT_PREVIEW_PROTOCOL,
  DEFAULT_PREVIEW_ROUTE,
  fingerprintWebsitePreviewInputs,
  inspectWebsitePreviewSupervisor,
  PREVIEW_IDENTITY_VERSION,
} from '../website-local-preview-state.mjs'

const helperPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'website-local-preview-state.mjs')

const fixtureFiles = {
  'website/src/app/page.tsx': 'export default function Page() { return <main>initial</main> }\n',
  'website/src/styles/site.css': 'body { color: #123; }\n',
  'website/public/brand.svg': '<svg viewBox="0 0 1 1"/>\n',
  'website/next.config.mjs': 'export default {}\n',
  'website/open-next.config.ts': 'export default {}\n',
  'website/contentSecurityPolicy.mjs': 'export default {}\n',
  'website/package.json': '{"name":"fixture","scripts":{"dev":"next dev"}}\n',
  'website/package-lock.json': '{"lockfileVersion":3,"packages":{}}\n',
  'website/tsconfig.json': '{"compilerOptions":{}}\n',
  'website/next-env.d.ts': '/// <reference types="next" />\n',
  'scripts/start-beauty-movement-local-preview.ps1': 'param()\n',
  'scripts/materialize-website-local-preview-source.sh': '#!/usr/bin/env bash\n',
  'scripts/run-local-website.sh': '#!/usr/bin/env bash\n',
  'scripts/website-local-preview-state.mjs': '// fixture contract\n',
  '.codex/environments/environment.toml': '[[actions]]\nname = "fixture"\n',
}

async function tempDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function writeFixture(root, entries = Object.entries(fixtureFiles)) {
  for (const [relativePath, content] of entries) {
    const target = path.join(root, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
}

async function createFixture(t, prefix = 'website-preview-identity-') {
  const root = await tempDirectory(prefix)
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await writeFixture(root)
  return root
}

test('fingerprints deterministic runtime inputs independent of mtime', async (t) => {
  const root = await createFixture(t, 'website-preview-deterministic-')
  const first = await fingerprintWebsitePreviewInputs(root, { includeEntries: true })
  const oldTime = new Date('2001-01-01T00:00:00.000Z')
  await fs.utimes(path.join(root, 'website', 'src', 'app', 'page.tsx'), oldTime, oldTime)
  const second = await fingerprintWebsitePreviewInputs(root, { includeEntries: true })

  assert.equal(second.fingerprint, first.fingerprint)
  assert.deepEqual(second.entries.map((entry) => entry.path), first.entries.map((entry) => entry.path))
  assert.ok(first.entries.some((entry) => entry.path === 'src/app/page.tsx'))
  assert.ok(first.entries.some((entry) => entry.path === 'public/brand.svg'))
  assert.ok(first.entries.some((entry) => entry.path === 'next.config.mjs'))
  assert.ok(first.entries.some((entry) => entry.path === 'package-lock.json'))
})

test('relevant tracked-like and untracked website changes invalidate the input fingerprint', async (t) => {
  const root = await createFixture(t, 'website-preview-inputs-')
  let previous = await fingerprintWebsitePreviewInputs(root)

  for (const relativePath of [
    'website/src/app/page.tsx',
    'website/public/brand.svg',
    'website/next.config.mjs',
    'website/open-next.config.ts',
    'website/contentSecurityPolicy.mjs',
    'website/package.json',
    'website/package-lock.json',
    'website/tsconfig.json',
  ]) {
    await fs.appendFile(path.join(root, relativePath), `// changed ${relativePath}\n`)
    const current = await fingerprintWebsitePreviewInputs(root)
    assert.notEqual(current.fingerprint, previous.fingerprint, `${relativePath} did not invalidate the preview`)
    previous = current
  }

  const untrackedPath = path.join(root, 'website', 'src', 'app', 'uncommitted-preview-sentinel.ts')
  await fs.writeFile(untrackedPath, 'export const sentinel = "uncommitted"\n')
  const untracked = await fingerprintWebsitePreviewInputs(root)
  assert.notEqual(untracked.fingerprint, previous.fingerprint, 'an untracked relevant file did not invalidate the preview')
  await fs.appendFile(untrackedPath, '// modified without a commit\n')
  assert.notEqual((await fingerprintWebsitePreviewInputs(root)).fingerprint, untracked.fingerprint,
    'editing an existing untracked file did not invalidate the preview')
})

test('local environment files are fingerprinted without exposing their contents or individual digests', async (t) => {
  const root = await createFixture(t, 'website-preview-local-env-')
  const envPath = path.join(root, 'website', '.env.local')
  const devVarsPath = path.join(root, 'website', '.dev.vars.local')
  const firstSecret = 'FIRST_LOCAL_SECRET_DO_NOT_PRINT'
  const secondSecret = 'SECOND_LOCAL_SECRET_DO_NOT_PRINT'
  await fs.writeFile(envPath, `PREVIEW_SECRET=${firstSecret}\n`)
  await fs.writeFile(devVarsPath, 'BINDING=one\n')
  const first = await fingerprintWebsitePreviewInputs(root, { includeEntries: true })
  const firstEntry = first.entries.find((entry) => entry.path === '.env.local')
  assert.deepEqual(firstEntry, {
    path: '.env.local',
    type: 'file',
    size: `PREVIEW_SECRET=${firstSecret}\n`.length,
    sensitive: true,
  })
  assert.ok(first.entries.find((entry) => entry.path === '.dev.vars.local')?.sensitive)
  assert.equal(JSON.stringify(first).includes(firstSecret), false)
  assert.equal(JSON.stringify(first).includes('digest'), false)

  await fs.writeFile(envPath, `PREVIEW_SECRET=${secondSecret}\n`)
  const second = await fingerprintWebsitePreviewInputs(root)
  assert.notEqual(second.fingerprint, first.fingerprint)
  await fs.appendFile(devVarsPath, 'BINDING=two\n')
  assert.notEqual((await fingerprintWebsitePreviewInputs(root)).fingerprint, second.fingerprint)
})

test('generated artifacts and non-runtime areas do not invalidate the preview fingerprint', async (t) => {
  const root = await createFixture(t, 'website-preview-excluded-')
  const baseline = await fingerprintWebsitePreviewInputs(root, { includeEntries: true })
  const excluded = {
    'website/.next/server/app/page.js': 'old generated output\n',
    'website/.next-codex-preview/old/server/app/page.js': 'old isolated output\n',
    'website/node_modules/next/index.js': 'dependency output\n',
    'website/docs/reference.md': '# documentation\n',
    'website/src/docs/reference.ts': 'not route runtime input\n',
    'website/src/.next/server/app/page.js': 'nested generated output\n',
    'website/tests/local-preview.test.ts': 'test only\n',
    'website/reports/quality.json': '{}\n',
    'website/tmp/runtime.log': 'temporary runtime data\n',
    'website/logs/preview.log': 'runtime log\n',
  }
  await writeFixture(root, Object.entries(excluded))
  const current = await fingerprintWebsitePreviewInputs(root, { includeEntries: true })

  assert.equal(current.fingerprint, baseline.fingerprint)
  for (const relativePath of Object.keys(excluded)) {
    const websitePath = relativePath.replace(/^website\//, '')
    assert.equal(current.entries.some((entry) => entry.path === websitePath), false, `${websitePath} was included`)
  }
})

test('instance identity binds canonical worktree, route, protocol and build contract while HEAD stays diagnostic', async (t) => {
  const root = await createFixture(t, 'website-preview-instance-')
  const first = await calculateWebsitePreviewIdentity(root, {
    sourceCommit: 'a'.repeat(40),
  })
  const differentHead = await calculateWebsitePreviewIdentity(root, {
    sourceCommit: 'b'.repeat(40),
  })
  const differentRoute = await calculateWebsitePreviewIdentity(root, {
    route: '/beleza-em-movimento/other-preview',
    sourceCommit: 'a'.repeat(40),
  })
  const differentProtocol = await calculateWebsitePreviewIdentity(root, {
    protocol: 'beauty-movement-local-preview-v3',
    sourceCommit: 'a'.repeat(40),
  })
  const differentContract = await calculateWebsitePreviewIdentity(root, {
    buildContract: 'next-dev-isolated-v2',
    sourceCommit: 'a'.repeat(40),
  })

  assert.equal(first.version, PREVIEW_IDENTITY_VERSION)
  assert.equal(first.route, DEFAULT_PREVIEW_ROUTE)
  assert.equal(first.protocol, DEFAULT_PREVIEW_PROTOCOL)
  assert.equal(first.buildContract, DEFAULT_BUILD_CONTRACT)
  assert.match(first.inputFingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.match(first.contractFingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.match(first.instanceFingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.equal(first.cacheKey, first.instanceFingerprint.slice('sha256:'.length))
  assert.equal(first.inputFingerprint, differentHead.inputFingerprint)
  assert.equal(first.contractFingerprint, differentHead.contractFingerprint)
  assert.equal(first.instanceFingerprint, differentHead.instanceFingerprint)
  assert.equal(first.sourceCommit, 'a'.repeat(40))
  assert.equal(differentHead.sourceCommit, 'b'.repeat(40))
  assert.notEqual(first.instanceFingerprint, differentRoute.instanceFingerprint)
  assert.notEqual(first.instanceFingerprint, differentProtocol.instanceFingerprint)
  assert.notEqual(first.instanceFingerprint, differentContract.instanceFingerprint)
  assert.ok(first.sourceRoot.endsWith(path.basename(root)))
})

test('Action contract changes invalidate the instance without falsely treating Git HEAD as an input', async (t) => {
  const root = await createFixture(t, 'website-preview-contract-')
  const first = await calculateWebsitePreviewIdentity(root, { sourceCommit: 'c'.repeat(40) })
  await fs.appendFile(path.join(root, 'scripts', 'run-local-website.sh'), '# changed runner\n')
  const afterRunner = await calculateWebsitePreviewIdentity(root, { sourceCommit: 'c'.repeat(40) })
  await fs.appendFile(path.join(root, 'scripts', 'materialize-website-local-preview-source.sh'), '# changed materializer\n')
  const afterMaterializer = await calculateWebsitePreviewIdentity(root, { sourceCommit: 'c'.repeat(40) })
  await fs.appendFile(path.join(root, '.codex', 'environments', 'environment.toml'), '# changed Action config\n')
  const afterConfig = await calculateWebsitePreviewIdentity(root, { sourceCommit: 'd'.repeat(40) })

  assert.equal(first.inputFingerprint, afterRunner.inputFingerprint)
  assert.notEqual(first.contractFingerprint, afterRunner.contractFingerprint)
  assert.notEqual(first.instanceFingerprint, afterRunner.instanceFingerprint)
  assert.equal(afterRunner.inputFingerprint, afterMaterializer.inputFingerprint)
  assert.notEqual(afterRunner.contractFingerprint, afterMaterializer.contractFingerprint)
  assert.notEqual(afterRunner.instanceFingerprint, afterMaterializer.instanceFingerprint)
  assert.equal(afterMaterializer.inputFingerprint, afterConfig.inputFingerprint)
  assert.notEqual(afterMaterializer.contractFingerprint, afterConfig.contractFingerprint)
  assert.notEqual(afterMaterializer.instanceFingerprint, afterConfig.instanceFingerprint)
})

test('CLI emits one JSON object suitable for the PowerShell launcher without local secret contents', async (t) => {
  const root = await createFixture(t, 'website-preview-cli-')
  const secret = 'CLI_LOCAL_SECRET_DO_NOT_PRINT'
  await fs.writeFile(path.join(root, 'website', '.env.local'), `TOKEN=${secret}\n`)
  const result = spawnSync(process.execPath, [
    helperPath,
    'identity',
    '--source-root',
    root,
    '--route',
    DEFAULT_PREVIEW_ROUTE,
    '--protocol',
    DEFAULT_PREVIEW_PROTOCOL,
    '--build-contract',
    DEFAULT_BUILD_CONTRACT,
    '--json',
  ], { encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim().split('\n').length, 1)
  const output = JSON.parse(result.stdout)
  assert.equal(output.ok, true)
  assert.equal(output.module, 'website')
  assert.equal(output.route, DEFAULT_PREVIEW_ROUTE)
  assert.equal(output.protocol, DEFAULT_PREVIEW_PROTOCOL)
  assert.match(output.instanceFingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.equal(result.stdout.includes(secret), false)
  assert.equal(result.stdout.includes('inputEntries'), false)
})

test('WSL supervisor probe proves PID start ticks, cwd and script marker fail-closed', async (t) => {
  if (process.platform !== 'linux') {
    t.skip('process proof is intentionally available only inside WSL/Linux')
    return
  }
  const sourceRoot = process.cwd()
  const verified = await inspectWebsitePreviewSupervisor(process.pid, {
    sourceRoot,
    scriptMarker: 'website-local-preview-state.test.mjs',
  })
  assert.equal(verified.alive, true)
  assert.equal(verified.valid, true)
  assert.match(verified.startTicks, /^[0-9]+$/)
  assert.equal(verified.cwdMatches, true)
  assert.equal(verified.commandMarkerMatches, true)
  assert.match(verified.commandLineFingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.equal(Object.hasOwn(verified, 'commandLine'), false)

  const wrongTicks = await inspectWebsitePreviewSupervisor(process.pid, {
    sourceRoot,
    scriptMarker: 'website-local-preview-state.test.mjs',
    expectedStartTicks: `${Number(verified.startTicks) + 1}`,
  })
  assert.equal(wrongTicks.valid, false)
  assert.equal(wrongTicks.reason, 'start_ticks_mismatch')

  const wrongRoot = await createFixture(t, 'website-preview-wrong-root-')
  const wrongCwd = await inspectWebsitePreviewSupervisor(process.pid, {
    sourceRoot: wrongRoot,
    scriptMarker: 'website-local-preview-state.test.mjs',
  })
  assert.equal(wrongCwd.valid, false)
  assert.equal(wrongCwd.reason, 'cwd_mismatch')

  const wrongMarker = await inspectWebsitePreviewSupervisor(process.pid, {
    sourceRoot,
    scriptMarker: 'not-a-supervisor-marker',
  })
  assert.equal(wrongMarker.valid, false)
  assert.equal(wrongMarker.reason, 'script_marker_mismatch')

  const missing = await inspectWebsitePreviewSupervisor(2_000_000_000, {
    sourceRoot,
    scriptMarker: 'website-local-preview-state.test.mjs',
  })
  assert.equal(missing.valid, false)
  assert.equal(missing.reason, 'process_missing')

  const cli = spawnSync(process.execPath, [
    helperPath,
    'process',
    '--pid',
    String(process.pid),
    '--source-root',
    sourceRoot,
    '--script-marker',
    'website-local-preview-state.test.mjs',
    '--json',
  ], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  const cliOutput = JSON.parse(cli.stdout)
  assert.equal(cliOutput.ok, true)
  assert.equal(cliOutput.valid, true)
  assert.equal(Object.hasOwn(cliOutput, 'commandLine'), false)
})
