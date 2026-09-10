import { readFile } from 'node:fs/promises'

const SHA = /^[0-9a-f]{40}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RUN_ID = /^[1-9][0-9]*$/

function fail(code) {
  throw new Error('PONTO_CORE_STAGING_CANDIDATE_INVALID:' + code)
}

function requireValue(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) fail(name + '_MISSING')
  return value
}

function requireBoolean(value, code) {
  if (value !== true) fail(code)
}

export function verifyPontoCoreStagingCandidate(evidence, expected) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) fail('RECEIPT_SHAPE')
  if (evidence.schemaVersion !== 1 || evidence.contractId !== 'skincos/ponto-core-staging-candidate/v1') {
    fail('CONTRACT')
  }
  if (evidence.target !== 'staging') fail('TARGET')
  if (evidence.sourceRepository !== expected.sourceRepository) fail('SOURCE_REPOSITORY')
  if (!SHA.test(String(evidence.sourceSha || '')) || String(evidence.sourceSha).toLowerCase() !== expected.sourceSha) {
    fail('SOURCE_SHA')
  }
  if (!SHA.test(String(evidence.sourceTree || '')) || String(evidence.sourceTree).toLowerCase() !== expected.sourceTree) {
    fail('SOURCE_TREE')
  }
  if (evidence.producer?.workflow !== '.github/workflows/ponto-core-staging-candidate.yml'
    || evidence.producer?.workflowName !== 'Ponto Core staging candidate'
    || !RUN_ID.test(String(evidence.producer?.runId || ''))
    || String(evidence.producer.runId) !== expected.runId) {
    fail('PRODUCER')
  }
  if (!UUID.test(String(evidence.core?.versionId || '')) || evidence.core.versionId !== expected.coreVersionId) {
    fail('CORE_VERSION')
  }
  if (evidence.core?.service !== expected.coreService
    || evidence.core?.candidateTag !== 'ponto:coreApi:' + expected.sourceSha) {
    fail('CORE_IDENTITY')
  }
  if (!UUID.test(String(evidence.identity?.versionId || '')) || evidence.identity.versionId !== expected.identityVersionId) {
    fail('IDENTITY_VERSION')
  }
  if (evidence.identity?.service !== expected.identityService
    || evidence.identity?.candidateTag !== 'ponto:identityWorkforce:' + expected.sourceSha) {
    fail('IDENTITY_IDENTITY')
  }
  requireBoolean(evidence.readiness?.passed, 'READINESS')
  requireBoolean(evidence.rollback?.passed, 'ROLLBACK')
  if (evidence.privateExposure?.routeCount !== 0
    || evidence.privateExposure?.customDomainCount !== 0
    || evidence.privateExposure?.workersDevEnabled !== false
    || evidence.privateExposure?.previewUrlsEnabled !== false) {
    fail('PRIVATE_EXPOSURE')
  }
  if (evidence.valuesIncluded !== false || evidence.credentialsIncluded !== false || evidence.piiIncluded !== false) {
    fail('SAFE_RECEIPT')
  }
  return {
    schemaVersion: 1,
    contractId: evidence.contractId,
    target: evidence.target,
    sourceSha: expected.sourceSha,
    sourceTree: expected.sourceTree,
    sourceRepository: expected.sourceRepository,
    coreService: expected.coreService,
    coreVersionId: expected.coreVersionId,
    identityService: expected.identityService,
    identityVersionId: expected.identityVersionId,
    valuesIncluded: false,
    credentialsIncluded: false,
  }
}

async function main() {
  const file = process.argv[2]
  if (!file) fail('RECEIPT_PATH_MISSING')
  const expected = {
    sourceSha: requireValue('PONTO_EXPECTED_SOURCE_SHA').toLowerCase(),
    sourceTree: requireValue('PONTO_EXPECTED_SOURCE_TREE').toLowerCase(),
    sourceRepository: requireValue('PONTO_EXPECTED_SOURCE_REPOSITORY'),
    runId: requireValue('PONTO_EXPECTED_CORE_CANDIDATE_RUN_ID'),
    coreService: requireValue('PONTO_EXPECTED_CORE_SERVICE'),
    coreVersionId: requireValue('PONTO_EXPECTED_CORE_VERSION_ID'),
    identityService: requireValue('PONTO_EXPECTED_IDENTITY_SERVICE'),
    identityVersionId: requireValue('PONTO_EXPECTED_IDENTITY_VERSION_ID'),
  }
  if (!SHA.test(expected.sourceSha) || !SHA.test(expected.sourceTree) || !RUN_ID.test(expected.runId)
    || !UUID.test(expected.coreVersionId) || !UUID.test(expected.identityVersionId)) {
    fail('EXPECTED_IDENTITY')
  }
  const evidence = JSON.parse(await readFile(file, 'utf8'))
  process.stdout.write(JSON.stringify(verifyPontoCoreStagingCandidate(evidence, expected)) + '\n')
}

if (process.argv[1] && process.argv[1].endsWith('verify-ponto-core-staging-candidate.mjs')) {
  main().catch((error) => {
    process.stderr.write(String(error?.message || error) + '\n')
    process.exitCode = 1
  })
}
