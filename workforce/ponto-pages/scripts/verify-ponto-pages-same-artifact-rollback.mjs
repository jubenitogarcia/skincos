import { readFile } from 'node:fs/promises'

const SHA = /^[0-9a-f]{40}$/i
const RUN_ID = /^[1-9][0-9]*$/
const TARGETS = new Set(['staging', 'production'])

function fail(code) {
  throw new Error('PONTO_PAGES_STAGING_SAME_ARTIFACT_ROLLBACK_INVALID:' + code)
}

function requireValue(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) fail(name + '_MISSING')
  return value
}

function sameSha(actual, expected) {
  return SHA.test(String(actual || '')) && String(actual).toLowerCase() === expected
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function verifyPontoPagesSameArtifactRollbackReceipt(evidence, expected) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) fail('RECEIPT_SHAPE')
  if (evidence.schemaVersion !== 1 || evidence.contractId !== 'skincos/ponto-pages-staging-same-artifact-rollback/v1') {
    fail('CONTRACT')
  }
  if (!TARGETS.has(expected.target) || evidence.target !== expected.target) fail('TARGET')
  if (evidence.sourceRepository !== expected.sourceRepository) fail('SOURCE_REPOSITORY')
  if (!sameSha(evidence.sourceSha, expected.sourceSha) || !sameSha(evidence.sourceTree, expected.sourceTree)) {
    fail('SOURCE_IDENTITY')
  }
  if (evidence.producer?.workflow !== '.github/workflows/ponto-pages-staging-same-artifact-rollback.yml'
    || evidence.producer?.workflowName !== 'Ponto Pages staging same-artifact rollback'
    || !RUN_ID.test(String(evidence.producer?.runId || ''))
    || String(evidence.producer.runId) !== expected.stagingRollbackRunId) {
    fail('PRODUCER')
  }
  if (evidence.project !== expected.project
    || !RUN_ID.test(String(evidence.stagingPublishRunId || ''))
    || String(evidence.stagingPublishRunId) !== expected.stagingPublishRunId
    || evidence.deployment?.project !== expected.project
    || !nonEmpty(evidence.deployment?.id)
    || evidence.deployment?.environment !== 'production'
    || evidence.deployment?.status !== 'success'
    || !sameSha(evidence.deployment?.sourceSha, expected.sourceSha)
    || !sameSha(evidence.deployment?.sourceTree, expected.sourceTree)) {
    fail('DEPLOYMENT_IDENTITY')
  }
  if (evidence.rollback?.passed !== true
    || evidence.rollback?.project !== expected.project
    || evidence.rollback?.targetDeploymentId !== evidence.deployment.id
    || !sameSha(evidence.rollback?.restoredSourceSha, expected.sourceSha)
    || !nonEmpty(evidence.rollback?.revertedDeploymentId)
    || !nonEmpty(evidence.rollback?.restoredDeploymentId)
    || evidence.rollback?.restoredEnvironment !== 'production'
    || evidence.rollback?.restoredStatus !== 'success'
    || evidence.rollback.revertedDeploymentId === evidence.rollback.restoredDeploymentId) {
    fail('ROLLBACK_IDENTITY')
  }
  if (evidence.valuesIncluded !== false || evidence.credentialsIncluded !== false || evidence.piiIncluded !== false) {
    fail('SAFE_RECEIPT')
  }
  return {
    schemaVersion: 1,
    contractId: evidence.contractId,
    target: expected.target,
    sourceRepository: expected.sourceRepository,
    sourceSha: expected.sourceSha,
    sourceTree: expected.sourceTree,
    project: expected.project,
    stagingPublishRunId: expected.stagingPublishRunId,
    stagingRollbackRunId: expected.stagingRollbackRunId,
    valuesIncluded: false,
    credentialsIncluded: false,
    piiIncluded: false,
  }
}

async function main() {
  const file = process.argv[2]
  if (!file) fail('RECEIPT_PATH_MISSING')
  const expected = {
    sourceRepository: requireValue('PONTO_EXPECTED_SOURCE_REPOSITORY'),
    sourceSha: requireValue('PONTO_EXPECTED_SOURCE_SHA').toLowerCase(),
    sourceTree: requireValue('PONTO_EXPECTED_SOURCE_TREE').toLowerCase(),
    target: requireValue('PONTO_EXPECTED_TARGET'),
    project: requireValue('PONTO_EXPECTED_PROJECT'),
    stagingPublishRunId: requireValue('PONTO_EXPECTED_STAGING_PUBLISH_RUN_ID'),
    stagingRollbackRunId: requireValue('PONTO_EXPECTED_STAGING_ROLLBACK_RUN_ID'),
  }
  if (!SHA.test(expected.sourceSha) || !SHA.test(expected.sourceTree)
    || !TARGETS.has(expected.target) || !RUN_ID.test(expected.stagingPublishRunId)
    || !RUN_ID.test(expected.stagingRollbackRunId)) {
    fail('EXPECTED_IDENTITY')
  }
  const evidence = JSON.parse(await readFile(file, 'utf8'))
  process.stdout.write(JSON.stringify(verifyPontoPagesSameArtifactRollbackReceipt(evidence, expected)) + '\n')
}

if (process.argv[1] && process.argv[1].endsWith('verify-ponto-pages-same-artifact-rollback.mjs')) {
  main().catch((error) => {
    process.stderr.write(String(error?.message || error) + '\n')
    process.exitCode = 1
  })
}
