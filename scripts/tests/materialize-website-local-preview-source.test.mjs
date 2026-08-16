import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const materializer = path.join(repositoryRoot, 'scripts', 'materialize-website-local-preview-source.sh')

async function writeFile(target, content) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

test('private materialization copies runtime inputs, excludes artifacts, and reuses only private dependencies', async (t) => {
  if (process.platform !== 'linux') {
    t.skip('the materializer intentionally runs inside WSL/Linux')
    return
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'website-preview-materialize-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  const privateState = path.join(root, 'state')
  const destination = path.join(privateState, 'source', 'identity')
  const dependencies = path.join(privateState, 'dependencies', 'lock')
  const fakeBin = path.join(root, 'bin')
  const npmLog = path.join(root, 'npm.log')
  const sourcePage = path.join(source, 'website', 'src', 'app', 'page.tsx')
  const sourceLock = path.join(source, 'website', 'package-lock.json')

  await writeFile(path.join(source, 'website', 'package.json'), JSON.stringify({
    name: 'preview-fixture', version: '1.0.0', scripts: { dev: 'next dev' },
  }))
  await writeFile(sourceLock, JSON.stringify({ name: 'preview-fixture', lockfileVersion: 3, packages: { '': { name: 'preview-fixture' } } }))
  await writeFile(sourcePage, 'export default function Page() { return <main>first</main> }\n')
  await writeFile(path.join(source, 'website', '.env.local'), 'PRIVATE_VALUE=not-exposed\n')
  await writeFile(path.join(source, 'website', 'docs', 'ignored.md'), 'ignored\n')
  await writeFile(path.join(source, 'website', '.next', 'stale.js'), 'generated\n')
  await writeFile(path.join(source, 'website', 'node_modules', 'old', 'index.js'), 'old\n')
  await fs.mkdir(privateState, { recursive: true })
  await writeFile(path.join(fakeBin, 'npm'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${npmLog}"
mkdir -p "$2/node_modules/fixture"
printf 'prepared\\n' > "$2/node_modules/fixture/index.js"
`)
  await fs.chmod(path.join(fakeBin, 'npm'), 0o755)

  const run = () => spawnSync('bash', [materializer], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      PREVIEW_MATERIALIZE_SOURCE_ROOT: source,
      PREVIEW_MATERIALIZE_DESTINATION_ROOT: destination,
      PREVIEW_MATERIALIZE_ALLOWED_ROOT: privateState,
      PREVIEW_MATERIALIZE_DEPENDENCY_ROOT: dependencies,
      PREVIEW_MATERIALIZE_DEPENDENCY_STATE_FILE: path.join(dependencies, 'website', '.preview-dependencies.state'),
    },
  })

  const first = run()
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /materialized source=/)
  assert.equal(await fs.readFile(path.join(destination, 'website', 'src', 'app', 'page.tsx'), 'utf8'),
    'export default function Page() { return <main>first</main> }\n')
  assert.equal(await fs.readFile(path.join(destination, 'website', '.env.local'), 'utf8'), 'PRIVATE_VALUE=not-exposed\n')
  await assert.rejects(fs.access(path.join(destination, 'website', 'docs', 'ignored.md')))
  await assert.rejects(fs.access(path.join(destination, 'website', '.next', 'stale.js')))
  assert.equal((await fs.lstat(path.join(destination, 'website', 'node_modules'))).isSymbolicLink(), true)
  assert.equal(await fs.realpath(path.join(destination, 'website', 'node_modules')),
    await fs.realpath(path.join(dependencies, 'website', 'node_modules')))
  assert.equal((await fs.readFile(npmLog, 'utf8')).trim().split('\n').length, 1)
  assert.match(await fs.readFile(path.join(dependencies, 'website', '.preview-dependencies.state'), 'utf8'), /dependencyFingerprint=sha256:/)

  await writeFile(sourcePage, 'export default function Page() { return <main>second</main> }\n')
  const second = run()
  assert.equal(second.status, 0, second.stderr)
  assert.equal(await fs.readFile(path.join(destination, 'website', 'src', 'app', 'page.tsx'), 'utf8'),
    'export default function Page() { return <main>second</main> }\n')
  assert.equal((await fs.readFile(npmLog, 'utf8')).trim().split('\n').length, 1,
    'a source-only change must not reinstall dependencies')

  await fs.appendFile(sourceLock, '\n')
  const third = run()
  assert.equal(third.status, 0, third.stderr)
  assert.equal((await fs.readFile(npmLog, 'utf8')).trim().split('\n').length, 2,
    'a dependency-input change must rebuild the private dependency cache')
  assert.equal(await fs.readFile(sourcePage, 'utf8'), 'export default function Page() { return <main>second</main> }\n',
    'materialization must not rewrite the source checkout')
})
