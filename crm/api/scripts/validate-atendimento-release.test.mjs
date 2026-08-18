import assert from 'node:assert/strict'
import test from 'node:test'
import { __testables, validateAtendimentoRelease } from './validate-atendimento-release.mjs'

const SHA = 'a'.repeat(40)
const PREDECESSOR = 'b'.repeat(40)
const TREE = 'c'.repeat(40)
const SOURCE_ROOT = `/opt/skincos/releases/${SHA}/source`
const STAGING_MANIFEST = Object.freeze({
  releaseSha: SHA,
  sourceTree: TREE,
  target: 'staging',
  domain: 'atendimento',
  surface: 'clientes',
  syntheticOnly: true,
})

function stagedReleaseDependencies(manifest = STAGING_MANIFEST) {
  const files = new Map([
    [`${SOURCE_ROOT}/.skincos-release-lineage.json`, JSON.stringify({
      releaseId: SHA,
      parentReleaseId: PREDECESSOR,
      verifiedAncestor: true,
      sourceTree: TREE,
      target: 'staging',
      surface: 'clientes',
    })],
    [`${SOURCE_ROOT}/crm/api/server/atendimentoRuntime.js`, ''],
    [`${SOURCE_ROOT}/crm/api/server/atendimento/isolatedRuntimeControl.js`, ''],
    [`${SOURCE_ROOT}/scripts/runtime/install-atendimento-production-service.sh`, ''],
  ])
  if (manifest !== null) files.set(`${SOURCE_ROOT}/.skincos-atendimento-release.json`, JSON.stringify(manifest))
  return {
    lstatImpl: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    readFileImpl: async (filePath) => {
      if (files.has(filePath)) return files.get(filePath)
      throw new Error('ENOENT')
    },
  }
}

test('immutable release validator accepts only a canonical full-SHA source root', () => {
  assert.deepEqual(__testables.parseArgs([
    '--source-root', `/opt/skincos/releases/${SHA}/source`,
    '--release-sha', SHA,
    '--predecessor-sha', PREDECESSOR,
  ]), {
    sourceRoot: `/opt/skincos/releases/${SHA}/source`,
    releaseSha: SHA,
    predecessorSha: PREDECESSOR,
    target: null,
    surface: null,
  })
})

test('immutable release validator accepts only the explicit managed targets', () => {
  assert.equal(__testables.parseArgs([
    '--source-root', `/opt/skincos/releases/${SHA}/source`,
    '--release-sha', SHA,
    '--target', 'staging',
  ]).target, 'staging')
  assert.equal(__testables.parseArgs([
    '--source-root', `/opt/skincos/releases/${SHA}/source`,
    '--release-sha', SHA,
    '--target', 'production',
  ]).target, 'production')
  assert.throws(
    () => __testables.parseArgs([
      '--source-root', `/opt/skincos/releases/${SHA}/source`,
      '--release-sha', SHA,
      '--target', 'other',
    ]),
    /ATENDIMENTO_RELEASE_IDENTITY_INVALID/,
  )
})

test('explicit staging validation binds the release, lineage and isolated manifest together', async () => {
  const args = [
    '--source-root', SOURCE_ROOT,
    '--release-sha', SHA,
    '--predecessor-sha', PREDECESSOR,
    '--target', 'staging',
  ]
  assert.deepEqual(await validateAtendimentoRelease(args, stagedReleaseDependencies()), {
    valid: true,
    releaseSha: SHA,
    predecessorSha: PREDECESSOR,
    target: 'staging',
    surface: 'clientes',
    readOnly: true,
    syntheticOnly: true,
  })
  await assert.rejects(
    () => validateAtendimentoRelease(args, stagedReleaseDependencies({
      releaseSha: SHA,
      sourceTree: 'd'.repeat(40),
      target: 'staging',
      domain: 'atendimento',
      syntheticOnly: true,
    })),
    /ATENDIMENTO_STAGING_RELEASE_MANIFEST_INVALID/,
  )
  await assert.rejects(
    () => validateAtendimentoRelease(args, stagedReleaseDependencies(null)),
    /ATENDIMENTO_STAGING_RELEASE_MANIFEST_UNREADABLE/,
  )
  assert.equal(__testables.parseArgs([
    '--source-root', SOURCE_ROOT,
    '--release-sha', SHA,
    '--surface', 'full',
  ]).surface, 'full')
  await assert.rejects(
    () => validateAtendimentoRelease([
      '--source-root', SOURCE_ROOT,
      '--release-sha', SHA,
      '--predecessor-sha', PREDECESSOR,
      '--target', 'staging',
      '--surface', 'full',
    ], stagedReleaseDependencies()),
    /ATENDIMENTO_STAGING_RELEASE_MANIFEST_INVALID/,
  )
  await assert.rejects(
    () => validateAtendimentoRelease([
      '--source-root', SOURCE_ROOT,
      '--release-sha', SHA,
      '--predecessor-sha', PREDECESSOR,
      '--target', 'staging',
      '--surface', 'full',
    ], stagedReleaseDependencies({ ...STAGING_MANIFEST, surface: 'full' })),
    /ATENDIMENTO_STAGING_RELEASE_MANIFEST_INVALID/,
  )
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
