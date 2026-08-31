import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CLIENTES_READONLY_STAGING_RELEASE_CONTRACT_VERSION,
  assessClientesReadonlyStagingRelease,
} from '../src/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readyPlan(overrides = {}) {
  return {
    contract: CLIENTES_READONLY_STAGING_RELEASE_CONTRACT_VERSION,
    target: 'staging',
    operation: 'deploy',
    enabled: true,
    syntheticOnly: true,
    sourceSha: 'a'.repeat(40),
    predecessorReleaseSha: 'b'.repeat(40),
    singlePublisher: true,
    publisher: { owner: 'skincos-clientes-readonly', workflow: 'isolated-staging-release' },
    publicRoute: false,
    syntheticSmoke: { implemented: true, passed: true },
    rollback: { artifactSha: 'b'.repeat(40), tested: true },
    actorAdapter: { secretConfigured: true, replayStoreConfigured: true, owner: 'skincos-clientes-readonly' },
    readModel: {
      serviceConfigured: true,
      interfaceVersion: 'clientes-readonly/read-model/v1',
      owner: 'skincos-clientes-read-model',
      dataOwner: 'skincos-clientes-read-model',
      migrationsOwner: 'skincos-clientes-read-model',
    },
    ...overrides,
  }
}

test('the committed staging release plan is fail-closed and not deployable', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'release', 'staging-gate.json'), 'utf8'))
  const result = assessClientesReadonlyStagingRelease(plan)
  assert.equal(result.ok, false)
  assert.ok(result.reasons.includes('CLIENTES_RELEASE_DISABLED'))
  assert.ok(result.reasons.includes('CLIENTES_RELEASE_READ_MODEL_REQUIRED'))
  assert.ok(result.reasons.includes('CLIENTES_RELEASE_ACTOR_ADAPTER_REQUIRED'))
})

test('a staging release requires one publisher, a predecessor and dedicated dependencies', () => {
  assert.deepEqual(assessClientesReadonlyStagingRelease(readyPlan()), {
    ok: true,
    contract: CLIENTES_READONLY_STAGING_RELEASE_CONTRACT_VERSION,
    target: 'staging',
    reasons: [],
  })
  const missingPredecessor = assessClientesReadonlyStagingRelease(readyPlan({ predecessorReleaseSha: '' }))
  assert.equal(missingPredecessor.ok, false)
  assert.ok(missingPredecessor.reasons.includes('CLIENTES_RELEASE_PREDECESSOR_REQUIRED'))
  const competingPublisher = assessClientesReadonlyStagingRelease(readyPlan({ singlePublisher: false }))
  assert.equal(competingPublisher.ok, false)
  assert.ok(competingPublisher.reasons.includes('CLIENTES_RELEASE_SINGLE_PUBLISHER_REQUIRED'))
  const untestedRollback = assessClientesReadonlyStagingRelease(readyPlan({ rollback: { artifactSha: 'b'.repeat(40), tested: false } }))
  assert.equal(untestedRollback.ok, false)
  assert.ok(untestedRollback.reasons.includes('CLIENTES_RELEASE_ROLLBACK_REQUIRED'))
})

test('a rollback can only select the recorded predecessor artifact', () => {
  const validRollback = assessClientesReadonlyStagingRelease(readyPlan({
    operation: 'rollback',
    sourceSha: 'b'.repeat(40),
  }))
  assert.equal(validRollback.ok, true)
  const wrongRollbackArtifact = assessClientesReadonlyStagingRelease(readyPlan({ operation: 'rollback' }))
  assert.equal(wrongRollbackArtifact.ok, false)
  assert.ok(wrongRollbackArtifact.reasons.includes('CLIENTES_RELEASE_ROLLBACK_TARGET_INVALID'))
})
