import { readFile } from 'node:fs/promises'

const SHA = /^[0-9a-f]{40}$/i
const RUN_ID = /^[1-9][0-9]*$/
const REQUIRED_CHECKS = [
  'login',
  'csrf',
  'ponto-read',
  'ponto-write',
  'terminal',
  'synthetic-cleanup',
]

function fail(code) {
  throw new Error('PONTO_PAGES_STAGING_SMOKE_INVALID:' + code)
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

function sameList(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index])
}

export function verifyPontoPagesStagingSmokeReceipt(publication, smoke, expected) {
  if (!publication || typeof publication !== 'object' || Array.isArray(publication)) fail('PUBLICATION_SHAPE')
  if (publication.schemaVersion !== 1 || publication.contractId !== 'skincos/ponto-pages-publication/v1') fail('PUBLICATION_CONTRACT')
  if (publication.target !== 'staging' || publication.project !== expected.project
    || publication.sourceRepository !== expected.sourceRepository
    || !sameSha(publication.sourceSha, expected.sourceSha)
    || !sameSha(publication.sourceTree, expected.sourceTree)
    || publication.producer?.workflow !== '.github/workflows/ponto-pages-governed-publisher.yml'
    || publication.producer?.workflowName !== 'Governed Ponto Pages publisher'
    || String(publication.producer?.runId || '') !== expected.stagingPublishRunId
    || !nonEmpty(publication.deploymentId)
    || publication.deploymentEnvironment !== 'production'
    || publication.valuesIncluded !== false
    || publication.credentialsIncluded !== false
    || publication.piiIncluded !== false) {
    fail('PUBLICATION_IDENTITY')
  }

  if (!smoke || typeof smoke !== 'object' || Array.isArray(smoke)) fail('SMOKE_SHAPE')
  if (smoke.schemaVersion !== 1 || smoke.contractId !== 'skincos/ponto-pages-staging-synthetic-smoke/v1') fail('SMOKE_CONTRACT')
  if (smoke.target !== 'staging' || smoke.project !== expected.project
    || smoke.sourceRepository !== expected.sourceRepository
    || !sameSha(smoke.sourceSha, expected.sourceSha)
    || !sameSha(smoke.sourceTree, expected.sourceTree)
    || smoke.producer?.workflow !== '.github/workflows/ponto-pages-staging-synthetic-smoke.yml'
    || smoke.producer?.workflowName !== 'Ponto Pages staging synthetic smoke'
    || String(smoke.producer?.runId || '') !== expected.stagingSmokeRunId
    || String(smoke.stagingPublishRunId || '') !== expected.stagingPublishRunId
    || smoke.deployment?.id !== publication.deploymentId
    || smoke.deployment?.environment !== 'production'
    || !sameSha(smoke.deployment?.sourceSha, expected.sourceSha)
    || !sameSha(smoke.deployment?.sourceTree, expected.sourceTree)
    || smoke.smoke?.passed !== true
    || !sameList(smoke.smoke?.checks, REQUIRED_CHECKS)
    || smoke.valuesIncluded !== false
    || smoke.credentialsIncluded !== false
    || smoke.piiIncluded !== false) {
    fail('SMOKE_IDENTITY')
  }

  return {
    schemaVersion: 1,
    contractId: smoke.contractId,
    target: 'staging',
    sourceRepository: expected.sourceRepository,
    sourceSha: expected.sourceSha,
    sourceTree: expected.sourceTree,
    project: expected.project,
    stagingPublishRunId: expected.stagingPublishRunId,
    stagingSmokeRunId: expected.stagingSmokeRunId,
    deploymentId: publication.deploymentId,
    valuesIncluded: false,
    credentialsIncluded: false,
    piiIncluded: false,
  }
}

async function main() {
  const [publicationPath, smokePath] = process.argv.slice(2)
  if (!publicationPath || !smokePath) fail('RECEIPT_PATH_MISSING')
  const expected = {
    sourceRepository: requireValue('PONTO_EXPECTED_SOURCE_REPOSITORY'),
    sourceSha: requireValue('PONTO_EXPECTED_SOURCE_SHA').toLowerCase(),
    sourceTree: requireValue('PONTO_EXPECTED_SOURCE_TREE').toLowerCase(),
    project: requireValue('PONTO_EXPECTED_STAGING_PROJECT'),
    stagingPublishRunId: requireValue('PONTO_EXPECTED_STAGING_PUBLISH_RUN_ID'),
    stagingSmokeRunId: requireValue('PONTO_EXPECTED_STAGING_SMOKE_RUN_ID'),
  }
  if (!SHA.test(expected.sourceSha) || !SHA.test(expected.sourceTree)
    || !RUN_ID.test(expected.stagingPublishRunId) || !RUN_ID.test(expected.stagingSmokeRunId)) {
    fail('EXPECTED_IDENTITY')
  }
  const [publication, smoke] = await Promise.all([
    readFile(publicationPath, 'utf8').then(JSON.parse),
    readFile(smokePath, 'utf8').then(JSON.parse),
  ])
  process.stdout.write(JSON.stringify(verifyPontoPagesStagingSmokeReceipt(publication, smoke, expected)) + '\n')
}

if (process.argv[1] && process.argv[1].endsWith('verify-ponto-pages-staging-smoke.mjs')) {
  main().catch((error) => {
    process.stderr.write(String(error?.message || error) + '\n')
    process.exitCode = 1
  })
}
