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
    initialDeployment: false,
    predecessorReleaseSha: 'b'.repeat(40),
    singlePublisher: true,
    publisher: { owner: 'skincos-clientes-readonly', workflow: 'isolated-staging-release' },
    publicRoute: false,
    syntheticSmoke: { implemented: true, passed: true },
    rollback: {
      mode: 'restore-predecessor',
      artifactSha: 'b'.repeat(40),
      targetReleaseSha: 'b'.repeat(40),
      tested: true,
      workflow: 'isolated-staging-release',
    },
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
  const untestedRollback = assessClientesReadonlyStagingRelease(readyPlan({
    rollback: {
      mode: 'restore-predecessor',
      artifactSha: 'b'.repeat(40),
      targetReleaseSha: 'b'.repeat(40),
      tested: false,
      workflow: 'isolated-staging-release',
    },
  }))
  assert.equal(untestedRollback.ok, false)
  assert.ok(untestedRollback.reasons.includes('CLIENTES_RELEASE_ROLLBACK_REQUIRED'))

  const rollbackThroughAnotherWorkflow = assessClientesReadonlyStagingRelease(readyPlan({
    rollback: {
      mode: 'restore-predecessor',
      artifactSha: 'b'.repeat(40),
      targetReleaseSha: 'b'.repeat(40),
      tested: true,
      workflow: 'unrelated-staging-release',
    },
  }))
  assert.equal(rollbackThroughAnotherWorkflow.ok, false)
  assert.ok(rollbackThroughAnotherWorkflow.reasons.includes('CLIENTES_RELEASE_ROLLBACK_REQUIRED'))
  assert.ok(rollbackThroughAnotherWorkflow.reasons.includes('CLIENTES_RELEASE_ROLLBACK_PUBLISHER_MISMATCH'))
})

test('a non-initial release cannot select itself as its rollback predecessor', () => {
  const sourceSha = 'a'.repeat(40)
  const selfRollback = assessClientesReadonlyStagingRelease(readyPlan({
    sourceSha,
    predecessorReleaseSha: sourceSha,
    rollback: {
      mode: 'restore-predecessor',
      artifactSha: sourceSha,
      targetReleaseSha: sourceSha,
      tested: true,
      workflow: 'isolated-staging-release',
    },
  }))
  assert.equal(selfRollback.ok, false)
  assert.ok(selfRollback.reasons.includes('CLIENTES_RELEASE_PREDECESSOR_MUST_DIFFER'))
})

test('a rollback targets the recorded predecessor without replacing the plan source SHA', () => {
  const validRollback = assessClientesReadonlyStagingRelease(readyPlan({
    operation: 'rollback',
  }))
  assert.equal(validRollback.ok, true)
  assert.equal(assessClientesReadonlyStagingRelease(readyPlan({
    operation: 'rollback',
  }), { expectedSourceSha: 'a'.repeat(40) }).ok, true)
  const wrongRollbackTarget = assessClientesReadonlyStagingRelease(readyPlan({
    operation: 'rollback',
    rollback: {
      mode: 'restore-predecessor',
      artifactSha: 'b'.repeat(40),
      targetReleaseSha: 'c'.repeat(40),
      tested: true,
      workflow: 'isolated-staging-release',
    },
  }))
  assert.equal(wrongRollbackTarget.ok, false)
  assert.ok(wrongRollbackTarget.reasons.includes('CLIENTES_RELEASE_ROLLBACK_REQUIRED'))
  assert.ok(wrongRollbackTarget.reasons.includes('CLIENTES_RELEASE_ROLLBACK_TARGET_INVALID'))
})

test('initial staging deployment uses a tested disable rollback instead of inventing a predecessor', () => {
  const sourceSha = 'c'.repeat(40)
  const initialDeployment = assessClientesReadonlyStagingRelease(readyPlan({
    sourceSha,
    initialDeployment: true,
    predecessorReleaseSha: '',
    rollback: {
      mode: 'disable',
      artifactSha: sourceSha,
      tested: true,
      workflow: 'isolated-staging-release',
    },
  }))
  assert.equal(initialDeployment.ok, true)

  const inventedPredecessor = assessClientesReadonlyStagingRelease(readyPlan({
    initialDeployment: true,
  }))
  assert.equal(inventedPredecessor.ok, false)
  assert.ok(inventedPredecessor.reasons.includes('CLIENTES_RELEASE_INITIAL_PREDECESSOR_FORBIDDEN'))
  assert.ok(inventedPredecessor.reasons.includes('CLIENTES_RELEASE_INITIAL_ROLLBACK_REQUIRED'))

  const differentRollbackWorkflow = assessClientesReadonlyStagingRelease(readyPlan({
    sourceSha,
    initialDeployment: true,
    predecessorReleaseSha: '',
    rollback: {
      mode: 'disable',
      artifactSha: sourceSha,
      tested: true,
      workflow: 'unrelated-staging-release',
    },
  }))
  assert.equal(differentRollbackWorkflow.ok, false)
  assert.ok(differentRollbackWorkflow.reasons.includes('CLIENTES_RELEASE_INITIAL_ROLLBACK_REQUIRED'))
  assert.ok(differentRollbackWorkflow.reasons.includes('CLIENTES_RELEASE_ROLLBACK_PUBLISHER_MISMATCH'))
})

test('an eligible plan binds its evidence to the exact checked-out source SHA', () => {
  const matching = assessClientesReadonlyStagingRelease(readyPlan(), { expectedSourceSha: 'a'.repeat(40) })
  assert.equal(matching.ok, true)
  const stale = assessClientesReadonlyStagingRelease(readyPlan(), { expectedSourceSha: 'd'.repeat(40) })
  assert.equal(stale.ok, false)
  assert.ok(stale.reasons.includes('CLIENTES_RELEASE_SOURCE_SHA_MISMATCH'))
  const absent = assessClientesReadonlyStagingRelease(readyPlan(), { expectedSourceSha: '' })
  assert.equal(absent.ok, false)
  assert.ok(absent.reasons.includes('CLIENTES_RELEASE_EXPECTED_SOURCE_SHA_REQUIRED'))
})
