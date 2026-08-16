import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const runner = path.join(repositoryRoot, 'scripts', 'run-local-website.sh')
const runnerSource = readFileSync(runner, 'utf8')

const runFixture = ({ body, env = {}, cwd = repositoryRoot }) => {
  const result = spawnSync(
    'bash',
    ['-c', `set -euo pipefail\nsource "$RUNNER"\n${body}`],
    {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        RUNNER: runner,
        RUN_LOCAL_WEBSITE_LIBRARY: '1',
        WEBSITE_SOURCE_ROOT: repositoryRoot,
        WEBSITE_HOST: '127.0.0.1',
        WEBSITE_PORT: '3417',
        WEBSITE_ROUTE: '/fixture',
        WEBSITE_STATE_DIR: cwd,
        ...env,
      },
    },
  )

  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim()
}

const writeExecutable = (filePath, body) => {
  writeFileSync(filePath, body, { encoding: 'utf8', mode: 0o700 })
  chmodSync(filePath, 0o700)
}

test('falls through from an empty lsof result to ss and preserves the next-server PID', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'skincos-website-runner-'))
  try {
    writeExecutable(path.join(fixture, 'lsof'), '#!/usr/bin/env bash\nexit 1\n')
    writeExecutable(
      path.join(fixture, 'ss'),
      '#!/usr/bin/env bash\ncase "$*" in\n  *:3417*) printf \'LISTEN 0 511 127.0.0.1:3417 0.0.0.0:* users:(("next-server (v15)",pid=4242,fd=22))\\n\' ;;\nesac\n',
    )

    const output = runFixture({
      cwd: fixture,
      env: { PATH: `${fixture}:${process.env.PATH}` },
      body: 'port_listener_pids 3417',
    })
    assert.equal(output, '4242')
    assert.equal(
      runFixture({
        cwd: fixture,
        env: {
          PATH: `${fixture}:${process.env.PATH}`,
          WEBSITE_PORT: '3417',
          WEBSITE_ALLOW_PORT_FALLBACK: '1',
        },
        body: 'resolve_website_port "$WEBSITE_PORT"; printf "$WEBSITE_PORT"',
      }),
      '3418',
    )
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('strict readiness rejects generic 200 responses and accepts only exact instance headers', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'skincos-website-runner-'))
  try {
    writeExecutable(
      path.join(fixture, 'curl'),
      `#!/usr/bin/env bash
headers=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -D) headers="$2"; shift 2 ;;
    -o|--max-time) shift 2 ;;
    *) shift ;;
  esac
done
printf 'HTTP/1.1 200 OK\\r\\nX-Skincos-Preview-Fingerprint: fixture-fingerprint\\r\\nX-Skincos-Preview-Instance: %s\\r\\n' "$FIXTURE_HEADER_INSTANCE" > "$headers"
if [[ -n "$FIXTURE_SECOND_INSTANCE" ]]; then
  printf 'X-Skincos-Preview-Instance: %s\\r\\n' "$FIXTURE_SECOND_INSTANCE" >> "$headers"
fi
printf 'X-App-Build: unknown\\r\\n\\r\\n' >> "$headers"
`,
    )

    const commonEnvironment = {
      PATH: `${fixture}:${process.env.PATH}`,
      SKINCOS_LOCAL_PREVIEW: 'true',
      WEBSITE_INSTANCE_FINGERPRINT: 'fixture-fingerprint',
      WEBSITE_INSTANCE_ID: 'fixture-instance',
      FIXTURE_HEADER_INSTANCE: 'fixture-instance',
    }
    assert.equal(
      runFixture({ env: commonEnvironment, cwd: fixture, body: 'response_matches_instance_identity http://127.0.0.1:3417/fixture && printf accepted' }),
      'accepted',
    )
    assert.equal(
      runFixture({
        env: { ...commonEnvironment, FIXTURE_HEADER_INSTANCE: 'different-instance' },
        cwd: fixture,
        body: 'if response_matches_instance_identity http://127.0.0.1:3417/fixture; then exit 31; fi; printf rejected',
      }),
      'rejected',
    )
    assert.equal(
      runFixture({
        env: { ...commonEnvironment, FIXTURE_SECOND_INSTANCE: 'fixture-instance' },
        cwd: fixture,
        body: 'if response_matches_instance_identity http://127.0.0.1:3417/fixture; then exit 32; fi; printf duplicate-rejected',
      }),
      'duplicate-rejected',
    )
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('writes the attested instance state atomically only after the strict contract is active', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'skincos-website-runner-'))
  const instanceState = path.join(fixture, 'instance.json')
  try {
    runFixture({
      cwd: fixture,
      env: {
        SKINCOS_LOCAL_PREVIEW: 'true',
        WEBSITE_INSTANCE_FINGERPRINT: 'fixture-fingerprint',
        WEBSITE_INSTANCE_ID: 'fixture-instance',
        WEBSITE_INSTANCE_STATE_FILE: instanceState,
        WEBSITE_LOCAL_PREVIEW_DIST_DIR: '.next-codex-preview/fixture',
      },
      body: 'write_instance_state 123 456',
    })
    const state = JSON.parse(readFileSync(instanceState, 'utf8'))
    assert.deepEqual(
      {
        version: state.version,
        supervisorPid: state.supervisorPid,
        supervisorStartTicks: state.supervisorStartTicks,
        sourceRoot: state.sourceRoot,
        route: state.route,
        port: state.port,
        fingerprint: state.fingerprint,
        instanceId: state.instanceId,
        distDir: state.distDir,
      },
      {
        version: 1,
        supervisorPid: 123,
        supervisorStartTicks: '456',
        sourceRoot: repositoryRoot,
        route: '/fixture',
        port: 3417,
        fingerprint: 'fixture-fingerprint',
        instanceId: 'fixture-instance',
        distDir: '.next-codex-preview/fixture',
      },
    )
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('accepts a supervisor only when /proc start ticks, cwd, and launcher command all match', async () => {
  const child = spawn('bash', ['-c', `source "${runner}"; sleep 30 & wait`], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      RUN_LOCAL_WEBSITE_LIBRARY: '1',
      WEBSITE_SOURCE_ROOT: repositoryRoot,
      WEBSITE_STATE_DIR: repositoryRoot,
    },
    stdio: 'ignore',
  })
  try {
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.ok(child.pid)
    const ticks = runFixture({
      env: { TARGET_PID: String(child.pid) },
      body: 'ticks="$(pid_start_ticks "$TARGET_PID")"; is_owned_website_supervisor "$TARGET_PID" "$ticks"; printf "$ticks"',
    })
    assert.match(ticks, /^\d+$/)
    assert.equal(
      runFixture({
        env: { TARGET_PID: String(child.pid) },
        body: 'ticks="$(pid_start_ticks "$TARGET_PID")"; if is_owned_website_supervisor "$TARGET_PID" "$((ticks + 1))"; then exit 31; fi; printf rejected',
      }),
      'rejected',
    )
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await once(child, 'close')
    }
  }
})

test('keeps generic callers compatible while relaying the strict preview contract to the detached supervisor', () => {
  assert.equal(
    runFixture({ body: '[[ "$WEBSITE_INSTANCE_CONTRACT_ACTIVE" == "0" ]] && response_matches_instance_identity http://127.0.0.1:3417/fixture && printf generic' }),
    'generic',
  )
  assert.match(runnerSource, /WEBSITE_INSTANCE_CONTRACT_ACTIVE=0/)
  assert.match(runnerSource, /WEBSITE_INSTANCE_FINGERPRINT="\$WEBSITE_INSTANCE_FINGERPRINT"/)
  assert.match(runnerSource, /WEBSITE_INSTANCE_ID="\$WEBSITE_INSTANCE_ID"/)
  assert.match(runnerSource, /SKINCOS_LOCAL_PREVIEW="\$\{SKINCOS_LOCAL_PREVIEW:-\}"/)
  assert.match(runnerSource, /WEBSITE_LOCAL_PREVIEW_DIST_DIR="\$WEBSITE_LOCAL_PREVIEW_DIST_DIR"/)
  assert.match(runnerSource, /SKINCOS_LOCAL_PREVIEW_FINGERPRINT="\$SKINCOS_LOCAL_PREVIEW_FINGERPRINT"/)
  assert.match(runnerSource, /SKINCOS_LOCAL_PREVIEW_INSTANCE="\$SKINCOS_LOCAL_PREVIEW_INSTANCE"/)
  assert.match(runnerSource, /next-server/)
  assert.match(runnerSource, /pid_start_ticks/)
  assert.match(runnerSource, /wait_for_attested_site_or_supervisor/)
})
