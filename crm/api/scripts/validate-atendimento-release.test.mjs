import assert from 'node:assert/strict'
import test from 'node:test'
import { __testables } from './validate-atendimento-release.mjs'

const SHA = 'a'.repeat(40)
const PREDECESSOR = 'b'.repeat(40)

test('immutable release validator accepts only a canonical full-SHA source root', () => {
  assert.deepEqual(__testables.parseArgs([
    '--source-root', `/opt/skincos/releases/${SHA}/source`,
    '--release-sha', SHA,
    '--predecessor-sha', PREDECESSOR,
  ]), {
    sourceRoot: `/opt/skincos/releases/${SHA}/source`,
    releaseSha: SHA,
    predecessorSha: PREDECESSOR,
  })
})

test('immutable release validator rejects aliases, partial SHAs and duplicate arguments', () => {
  assert.throws(
    () => __testables.parseArgs(['--source-root', '/opt/skincos/current/source', '--release-sha', SHA]),
    /ATENDIMENTO_RELEASE_IDENTITY_INVALID/,
  )
  assert.throws(
    () => __testables.parseArgs(['--source-root', `/opt/skincos/releases/${SHA}/source`, '--release-sha', 'a'.repeat(12)]),
    /ATENDIMENTO_RELEASE_IDENTITY_INVALID/,
  )
  assert.throws(
    () => __testables.parseArgs([
      '--source-root', `/opt/skincos/releases/${SHA}/source`,
      '--release-sha', SHA,
      '--release-sha', SHA,
    ]),
    /ATENDIMENTO_RELEASE_ARGUMENT_INVALID/,
  )
})
