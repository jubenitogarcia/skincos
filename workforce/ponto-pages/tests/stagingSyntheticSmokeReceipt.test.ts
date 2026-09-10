import { describe, expect, it } from 'vitest'
import { verifyPontoPagesStagingSmokeReceipt } from '../scripts/verify-ponto-pages-staging-smoke.mjs'

const sourceSha = 'a'.repeat(40)
const sourceTree = 'b'.repeat(40)
const expected = {
  sourceRepository: 'jubenitogarcia/skincos',
  sourceSha,
  sourceTree,
  project: 'skincos-ponto-staging',
  stagingPublishRunId: '123456789',
  stagingSmokeRunId: '987654321',
}

function publication() {
  return {
    schemaVersion: 1,
    contractId: 'skincos/ponto-pages-publication/v1',
    target: 'staging',
    project: expected.project,
    sourceRepository: expected.sourceRepository,
    sourceSha,
    sourceTree,
    producer: {
      workflow: '.github/workflows/ponto-pages-governed-publisher.yml',
      workflowName: 'Governed Ponto Pages publisher',
      runId: expected.stagingPublishRunId,
    },
    deploymentId: 'deployment-1',
    deploymentEnvironment: 'production',
    valuesIncluded: false,
    credentialsIncluded: false,
    piiIncluded: false,
  }
}

function smoke() {
  return {
    schemaVersion: 1,
    contractId: 'skincos/ponto-pages-staging-synthetic-smoke/v1',
    target: 'staging',
    project: expected.project,
    sourceRepository: expected.sourceRepository,
    sourceSha,
    sourceTree,
    producer: {
      workflow: '.github/workflows/ponto-pages-staging-synthetic-smoke.yml',
      workflowName: 'Ponto Pages staging synthetic smoke',
      runId: expected.stagingSmokeRunId,
    },
    stagingPublishRunId: expected.stagingPublishRunId,
    deployment: {
      id: 'deployment-1',
      environment: 'production',
      sourceSha,
      sourceTree,
    },
    smoke: {
      passed: true,
      checks: ['login', 'csrf', 'ponto-read', 'ponto-write', 'terminal', 'synthetic-cleanup'],
    },
    valuesIncluded: false,
    credentialsIncluded: false,
    piiIncluded: false,
  }
}

describe('Ponto Pages staging synthetic smoke receipt', () => {
  it('accepts only staging publication and smoke evidence with one exact deployment identity', () => {
    expect(verifyPontoPagesStagingSmokeReceipt(publication(), smoke(), expected)).toMatchObject({
      sourceSha,
      sourceTree,
      project: expected.project,
      stagingPublishRunId: expected.stagingPublishRunId,
      stagingSmokeRunId: expected.stagingSmokeRunId,
      deploymentId: 'deployment-1',
      valuesIncluded: false,
    })
  })

  it('rejects incomplete smoke, a mismatched publish run, or another deployment', () => {
    const incomplete = smoke()
    incomplete.smoke.checks = ['login', 'csrf']
    expect(() => verifyPontoPagesStagingSmokeReceipt(publication(), incomplete, expected))
      .toThrow('PONTO_PAGES_STAGING_SMOKE_INVALID:SMOKE_IDENTITY')

    const wrongPublish = smoke()
    wrongPublish.stagingPublishRunId = '444444444'
    expect(() => verifyPontoPagesStagingSmokeReceipt(publication(), wrongPublish, expected))
      .toThrow('PONTO_PAGES_STAGING_SMOKE_INVALID:SMOKE_IDENTITY')

    const wrongDeployment = smoke()
    wrongDeployment.deployment.id = 'deployment-2'
    expect(() => verifyPontoPagesStagingSmokeReceipt(publication(), wrongDeployment, expected))
      .toThrow('PONTO_PAGES_STAGING_SMOKE_INVALID:SMOKE_IDENTITY')
  })
})
