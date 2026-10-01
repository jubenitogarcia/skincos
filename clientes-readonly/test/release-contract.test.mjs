import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CLIENTES_READONLY_STAGING_RELEASE_CONTRACT_VERSION,
  CLIENTES_READONLY_STAGING_RELEASE_EVIDENCE_CONTRACT_VERSION,
  assessClientesReadonlyStagingRelease,
} from '../src/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceSha = 'a'.repeat(40)
const sourceTree = 'd'.repeat(40)
const predecessorReleaseSha = 'b'.repeat(40)

function readyPlan(overrides = {}) {
  return {
    contract: CLIENTES_READONLY_STAGING_RELEASE_CONTRACT_VERSION,
    target: 'staging',
    enabled: true,
    syntheticOnly: true,
    singlePublisher: true,
    publisher: { owner: 'skincos-clientes-readonly', workflow: 'isolated-staging-release' },
    publicRoute: false,
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

function readyEvidence(overrides = {}) {
  return {
    contract: CLIENTES_READONLY_STAGING_RELEASE_EVIDENCE_CONTRACT_VERSION,
    target: 'staging',
    sourceSha,
    sourceTree,
    operation: 'deploy',
    initialDeployment: false,
    predecessorReleaseSha,
    syntheticSmoke: { implemented: true, passed: true, sourceSha },
    rollback: {
      mode: 'restore-predecessor',
      artifactSha: predecessorReleaseSha,
      targetReleaseSha: predecessorReleaseSha,
      tested: true,
      workflow: 'isolated-staging-release',
    },
    ...overrides,
  }
}

function assessment(plan = readyPlan(), releaseEvidence = readyEvidence(), expectedSourceSha, expectedSourceTree) {
  return assessClientesReadonlyStagingRelease(plan, {
    releaseEvidence,
    expectedSourceSha,
    expectedSourceTree,
  })
}

test('the committed staging plan is fail-closed and cannot self-bind a release identity', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'release', 'staging-gate.json'), 'utf8'))
  const result = assessClientesReadonlyStagingRelease(plan)
  assert.equal(Object.hasOwn(plan, 'sourceSha'), false)
  assert.equal(result.ok, false)
  assert.ok(result.reasons.includes('CLIENTES_RELEASE_DISABLED'))
  assert.ok(result.reasons.includes('CLIENTES_RELEASE_EVIDENCE_REQUIRED'))
  assert.ok(result.reasons.includes('CLIENTES_RELEASE_READ_MODEL_REQUIRED'))
  assert.ok(result.reasons.includes('CLIENTES_RELEASE_ACTOR_ADAPTER_REQUIRED'))
})

test('a staging release requires one publisher and exact external release evidence', () => {
  assert.deepEqual(assessment(), {
    ok: true,
    contract: CLIENTES_READONLY_STAGING_RELEASE_CONTRACT_VERSION,
    target: 'staging',
    reasons: [],
  })
  const missingPredecessor = assessment(readyPlan(), readyEvidence({ predecessorReleaseSha: '' }))
  assert.equal(missingPredecessor.ok, false)
  assert.ok(missingPredecessor.reasons.includes('CLIENTES_RELEASE_PREDECESSOR_REQUIRED'))
  const competingPublisher = assessment(readyPlan({ singlePublisher: false }))
  assert.equal(competingPublisher.ok, false)
  assert.ok(competingPublisher.reasons.includes('CLIENTES_RELEASE_SINGLE_PUBLISHER_REQUIRED'))
  const untestedRollback = assessment(readyPlan(), readyEvidence({
    rollback: {
      mode: 'restore-predecessor',
      artifactSha: predecessorReleaseSha,
      targetReleaseSha: predecessorReleaseSha,
      tested: false,
      workflow: 'isolated-staging-release',
    },
  }))
  assert.equal(untestedRollback.ok, false)
  assert.ok(untestedRollback.reasons.includes('CLIENTES_RELEASE_ROLLBACK_REQUIRED'))

  const rollbackThroughAnotherWorkflow = assessment(readyPlan(), readyEvidence({
    rollback: {
      mode: 'restore-predecessor',
      artifactSha: predecessorReleaseSha,
      targetReleaseSha: predecessorReleaseSha,
      tested: true,
      workflow: 'unrelated-staging-release',
    },
  }))
  assert.equal(rollbackThroughAnotherWorkflow.ok, false)
  assert.ok(rollbackThroughAnotherWorkflow.reasons.includes('CLIENTES_RELEASE_ROLLBACK_REQUIRED'))
  assert.ok(rollbackThroughAnotherWorkflow.reasons.includes('CLIENTES_RELEASE_ROLLBACK_PUBLISHER_MISMATCH'))
})

test('a non-initial release cannot select itself as its rollback predecessor', () => {
  const selfRollback = assessment(readyPlan(), readyEvidence({
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

test('a rollback targets the recorded predecessor without replacing current release identity', () => {
  const validRollback = assessment(readyPlan(), readyEvidence({ operation: 'rollback' }))
  assert.equal(validRollback.ok, true)
  assert.equal(assessment(readyPlan(), readyEvidence({ operation: 'rollback' }), sourceSha).ok, true)
  const wrongRollbackTarget = assessment(readyPlan(), readyEvidence({
    operation: 'rollback',
    rollback: {
      mode: 'restore-predecessor',
      artifactSha: predecessorReleaseSha,
      targetReleaseSha: 'c'.repeat(40),
      tested: true,
      workflow: 'isolated-staging-release',
    },
  }))
  assert.equal(wrongRollbackTarget.ok, false)
  assert.ok(wrongRollbackTarget.reasons.includes('CLIENTES_RELEASE_ROLLBACK_REQUIRED'))
  assert.ok(wrongRollbackTarget.reasons.includes('CLIENTES_RELEASE_ROLLBACK_TARGET_INVALID'))
})

test('initial staging deployment uses external identity for a tested disable rollback', () => {
  const initialSourceSha = 'c'.repeat(40)
  const initialDeployment = assessment(readyPlan(), readyEvidence({
    sourceSha: initialSourceSha,
    initialDeployment: true,
    predecessorReleaseSha: '',
    syntheticSmoke: { implemented: true, passed: true, sourceSha: initialSourceSha },
    rollback: {
      mode: 'disable',
      artifactSha: initialSourceSha,
      tested: true,
      workflow: 'isolated-staging-release',
    },
  }))
  assert.equal(initialDeployment.ok, true)

  const inventedPredecessor = assessment(readyPlan(), readyEvidence({ initialDeployment: true }))
  assert.equal(inventedPredecessor.ok, false)
  assert.ok(inventedPredecessor.reasons.includes('CLIENTES_RELEASE_INITIAL_PREDECESSOR_FORBIDDEN'))
  assert.ok(inventedPredecessor.reasons.includes('CLIENTES_RELEASE_INITIAL_ROLLBACK_REQUIRED'))

  const differentRollbackWorkflow = assessment(readyPlan(), readyEvidence({
    sourceSha: initialSourceSha,
    initialDeployment: true,
    predecessorReleaseSha: '',
    syntheticSmoke: { implemented: true, passed: true, sourceSha: initialSourceSha },
    rollback: {
      mode: 'disable',
      artifactSha: initialSourceSha,
      tested: true,
      workflow: 'unrelated-staging-release',
    },
  }))
  assert.equal(differentRollbackWorkflow.ok, false)
  assert.ok(differentRollbackWorkflow.reasons.includes('CLIENTES_RELEASE_INITIAL_ROLLBACK_REQUIRED'))
  assert.ok(differentRollbackWorkflow.reasons.includes('CLIENTES_RELEASE_ROLLBACK_PUBLISHER_MISMATCH'))
})

test('an external evidence record binds the eligible plan to the exact checked-out SHA', () => {
  const matching = assessment(readyPlan(), readyEvidence(), sourceSha)
  assert.equal(matching.ok, true)
  const stale = assessment(readyPlan(), readyEvidence(), 'e'.repeat(40))
  assert.equal(stale.ok, false)
  assert.ok(stale.reasons.includes('CLIENTES_RELEASE_SOURCE_SHA_MISMATCH'))
  const absentExpected = assessment(readyPlan(), readyEvidence(), '')
  assert.equal(absentExpected.ok, false)
  assert.ok(absentExpected.reasons.includes('CLIENTES_RELEASE_EXPECTED_SOURCE_SHA_REQUIRED'))
  const staleTree = assessment(readyPlan(), readyEvidence(), sourceSha, 'e'.repeat(40))
  assert.equal(staleTree.ok, false)
  assert.ok(staleTree.reasons.includes('CLIENTES_RELEASE_SOURCE_TREE_MISMATCH'))
  const missingEvidence = assessClientesReadonlyStagingRelease(readyPlan(), { expectedSourceSha: sourceSha })
  assert.equal(missingEvidence.ok, false)
  assert.ok(missingEvidence.reasons.includes('CLIENTES_RELEASE_EVIDENCE_REQUIRED'))
})

test('the plan rejects a checked-in source identity and smoke must attest the external source', () => {
  const selfReferentialPlan = assessment(readyPlan({ sourceSha }), readyEvidence())
  assert.equal(selfReferentialPlan.ok, false)
  assert.ok(selfReferentialPlan.reasons.includes('CLIENTES_RELEASE_PLAN_SOURCE_IDENTITY_FORBIDDEN'))
  const staleSmoke = assessment(readyPlan(), readyEvidence({
    syntheticSmoke: { implemented: true, passed: true, sourceSha: 'e'.repeat(40) },
  }))
  assert.equal(staleSmoke.ok, false)
  assert.ok(staleSmoke.reasons.includes('CLIENTES_RELEASE_SYNTHETIC_SMOKE_REQUIRED'))
})
