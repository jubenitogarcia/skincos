import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const command = path.join(repositoryRoot, 'start-website-local.command')
const realPython3 = execFileSync('bash', ['-lc', 'command -v python3'], { encoding: 'utf8' }).trim()

function executable(target, source) {
  writeFileSync(target, source, { mode: 0o755 })
  chmodSync(target, 0o755)
}

test('macOS Finder wrapper opens only the attested local URL after runner success', () => {
  const bin = mkdtempSync(path.join(os.tmpdir(), 'skincos-command-bin-'))
  const opened = path.join(bin, 'opened')
  try {
    executable(path.join(bin, 'uname'), '#!/usr/bin/env bash\nprintf Darwin\n')
    executable(path.join(bin, 'python3'), [
      '#!/usr/bin/env bash',
      'if [[ "${1:-}" == "-c" ]]; then exec "$REAL_PYTHON3" "$@"; fi',
      'if [[ "${FAIL_RUNNER:-0}" == 1 ]]; then exit 17; fi',
      'if [[ "${MALFORMED_JSON:-0}" == 1 ]]; then printf \'not-json\\n\'; exit 0; fi',
      'if [[ -n "${RUNNER_OUTPUT:-}" ]]; then printf \'%s\\n\' "$RUNNER_OUTPUT"; exit 0; fi',
      'printf \'%s\\n\' \'{"url":"http://127.0.0.1:3417/servi\\u00e7o\\"quoted"}\'',
      ''
    ].join('\n'))
    executable(path.join(bin, 'open'), '#!/usr/bin/env bash\nprintf "%s" "$1" > "$FIXTURE_OPENED_MARKER"\n')
    const environment = { ...process.env, PATH: `${bin}:${process.env.PATH}`, REAL_PYTHON3: realPython3, FIXTURE_OPENED_MARKER: opened }
    const success = spawnSync('bash', [command, '/serviço'], { cwd: repositoryRoot, encoding: 'utf8', env: { ...environment, OPEN_BROWSER: '1' } })
    assert.equal(success.status, 0, success.stderr)
    assert.equal(readFileSync(opened, 'utf8'), 'http://127.0.0.1:3417/serviço"quoted')

    rmSync(opened)
    const optOut = spawnSync('bash', [command, '/'], { cwd: repositoryRoot, encoding: 'utf8', env: { ...environment, OPEN_BROWSER: '0' } })
    assert.equal(optOut.status, 0, optOut.stderr)
    assert.equal(existsSync(opened), false)

    const malformed = spawnSync('bash', [command, '/'], { cwd: repositoryRoot, encoding: 'utf8', env: { ...environment, OPEN_BROWSER: '1', MALFORMED_JSON: '1' } })
    assert.equal(malformed.status, 2)
    assert.equal(existsSync(opened), false)

    const invalidType = spawnSync('bash', [command, '/'], { cwd: repositoryRoot, encoding: 'utf8', env: { ...environment, OPEN_BROWSER: '1', RUNNER_OUTPUT: '{"url":{}}' } })
    assert.equal(invalidType.status, 2)
    assert.equal(existsSync(opened), false)

    const external = spawnSync('bash', [command, '/'], { cwd: repositoryRoot, encoding: 'utf8', env: { ...environment, OPEN_BROWSER: '1', RUNNER_OUTPUT: '{"url":"http://example.invalid:3417/"}' } })
    assert.equal(external.status, 2)
    assert.equal(existsSync(opened), false)

    const failed = spawnSync('bash', [command, '/'], { cwd: repositoryRoot, encoding: 'utf8', env: { ...environment, OPEN_BROWSER: '1', FAIL_RUNNER: '1' } })
    assert.equal(failed.status, 17)
    assert.equal(existsSync(opened), false)
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
})
