import { describe, expect, it } from 'vitest'
import { verifyPontoPagesSameArtifactRollbackReceipt } from '../scripts/verify-ponto-pages-same-artifact-rollback.mjs'

const sourceSha = 'a'.repeat(40)
const sourceTree = 'b'.repeat(40)
const expected = {
  sourceRepository: 'jubenitogarcia/skincos',
  sourceSha,
  sourceTree,
  target: 'staging',
  project: 'skincos-ponto-staging',
  stagingPublishRunId: '123456789',
  stagingRollbackRunId: '987654321',
}

function receipt() {
  return {
    schemaVersion: 1,
    contractId: 'skincos/ponto-pages-staging-same-artifact-rollback/v1',
    target: expected.target,
    sourceRepository: expected.sourceRepository,
    sourceSha,
    sourceTree,
    producer: {
      workflow: '.github/workflows/ponto-pages-staging-same-artifact-rollback.yml',
      workflowName: 'Ponto Pages staging same-artifact rollback',
      runId: expected.stagingRollbackRunId,
    },
    project: expected.project,
    stagingPublishRunId: expected.stagingPublishRunId,
    deployment: {
      project: expected.project,
      id: 'staging-publish-deployment',
      environment: 'production',
      status: 'success',
      sourceSha,
      sourceTree,
    },
    rollback: {
      passed: true,
      project: expected.project,
      targetDeploymentId: 'staging-publish-deployment',
      revertedDeploymentId: 'previous-deployment',
      restoredDeploymentId: 'restored-deployment',
      restoredSourceSha: sourceSha,
      restoredEnvironment: 'production',
      restoredStatus: 'success',
    },
    valuesIncluded: false,
    credentialsIncluded: false,
    piiIncluded: false,
  }
}

describe('Ponto Pages same-artifact rollback receipt', () => {
  it('accepts the exact safe rollback evidence for the selected Pages artifact', () => {
    expect(verifyPontoPagesSameArtifactRollbackReceipt(receipt(), expected)).toMatchObject({
      target: expected.target,
      project: expected.project,
      sourceSha,
      sourceTree,
      stagingPublishRunId: expected.stagingPublishRunId,
      stagingRollbackRunId: expected.stagingRollbackRunId,
      valuesIncluded: false,
    })
  })

  it('rejects mismatched project, restored source or unsafe receipt data', () => {
    const wrongProject = receipt()
    wrongProject.project = 'skincos-ponto'
    expect(() => verifyPontoPagesSameArtifactRollbackReceipt(wrongProject, expected)).toThrow('PONTO_PAGES_STAGING_SAME_ARTIFACT_ROLLBACK_INVALID:DEPLOYMENT_IDENTITY')

    const wrongRestore = receipt()
    wrongRestore.rollback.restoredSourceSha = 'c'.repeat(40)
    expect(() => verifyPontoPagesSameArtifactRollbackReceipt(wrongRestore, expected)).toThrow('PONTO_PAGES_STAGING_SAME_ARTIFACT_ROLLBACK_INVALID:ROLLBACK_IDENTITY')

    const unsafe = receipt()
    unsafe.credentialsIncluded = true
    expect(() => verifyPontoPagesSameArtifactRollbackReceipt(unsafe, expected)).toThrow('PONTO_PAGES_STAGING_SAME_ARTIFACT_ROLLBACK_INVALID:SAFE_RECEIPT')
  })

  it('binds the receipt to the staging publisher run and original deployment', () => {
    const wrongPublisherRun = receipt()
    wrongPublisherRun.stagingPublishRunId = '246810121'
    expect(() => verifyPontoPagesSameArtifactRollbackReceipt(wrongPublisherRun, expected))
      .toThrow('PONTO_PAGES_STAGING_SAME_ARTIFACT_ROLLBACK_INVALID:DEPLOYMENT_IDENTITY')

    const wrongOriginalDeployment = receipt()
    wrongOriginalDeployment.rollback.targetDeploymentId = 'different-deployment'
    expect(() => verifyPontoPagesSameArtifactRollbackReceipt(wrongOriginalDeployment, expected))
      .toThrow('PONTO_PAGES_STAGING_SAME_ARTIFACT_ROLLBACK_INVALID:ROLLBACK_IDENTITY')
  })
})
