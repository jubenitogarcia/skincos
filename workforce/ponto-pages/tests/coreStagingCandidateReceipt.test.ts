import { describe, expect, it } from 'vitest'
import { verifyPontoCoreStagingCandidate } from '../scripts/verify-ponto-core-staging-candidate.mjs'

const sourceSha = 'a'.repeat(40)
const sourceTree = 'b'.repeat(40)
const expected = {
  sourceSha,
  sourceTree,
  sourceRepository: 'jubenitogarcia/skincos',
  runId: '123456789',
  coreService: 'skincos-ponto-core-staging',
  coreVersionId: '11111111-1111-4111-8111-111111111111',
  identityService: 'skincos-insumos-staging',
  identityVersionId: '22222222-2222-4222-8222-222222222222',
}

function receipt() {
  return {
    schemaVersion: 1,
    contractId: 'skincos/ponto-core-staging-candidate/v1',
    target: 'staging',
    sourceRepository: expected.sourceRepository,
    sourceSha,
    sourceTree,
    producer: {
      workflow: '.github/workflows/ponto-core-staging-candidate.yml',
      workflowName: 'Ponto Core staging candidate',
      runId: expected.runId,
    },
    core: {
      service: expected.coreService,
      versionId: expected.coreVersionId,
      candidateTag: `ponto:coreApi:${sourceSha}`,
    },
    identity: {
      service: expected.identityService,
      versionId: expected.identityVersionId,
      candidateTag: `ponto:identityWorkforce:${sourceSha}`,
    },
    readiness: { passed: true },
    rollback: { passed: true },
    privateExposure: {
      routeCount: 0,
      customDomainCount: 0,
      workersDevEnabled: false,
      previewUrlsEnabled: false,
    },
    valuesIncluded: false,
    credentialsIncluded: false,
    piiIncluded: false,
  }
}

describe('Ponto Core staging candidate receipt', () => {
  it('accepts only the exact safe staging candidate identity', () => {
    expect(verifyPontoCoreStagingCandidate(receipt(), expected)).toMatchObject({
      sourceSha,
      sourceTree,
      sourceRepository: expected.sourceRepository,
      coreService: expected.coreService,
      coreVersionId: expected.coreVersionId,
      identityService: expected.identityService,
      identityVersionId: expected.identityVersionId,
      valuesIncluded: false,
      credentialsIncluded: false,
    })
  })

  it('rejects a receipt from another run, version or public surface', () => {
    const wrongRun = receipt()
    wrongRun.producer.runId = '987654321'
    expect(() => verifyPontoCoreStagingCandidate(wrongRun, expected)).toThrow('PONTO_CORE_STAGING_CANDIDATE_INVALID:PRODUCER')

    const wrongVersion = receipt()
    wrongVersion.core.versionId = '33333333-3333-4333-8333-333333333333'
    expect(() => verifyPontoCoreStagingCandidate(wrongVersion, expected)).toThrow('PONTO_CORE_STAGING_CANDIDATE_INVALID:CORE_VERSION')

    const publicSurface = receipt()
    publicSurface.privateExposure.previewUrlsEnabled = true
    expect(() => verifyPontoCoreStagingCandidate(publicSurface, expected)).toThrow('PONTO_CORE_STAGING_CANDIDATE_INVALID:PRIVATE_EXPOSURE')
  })
})
