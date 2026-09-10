import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryRoot = resolve(packageRoot, '../..')
const contract = JSON.parse(readFileSync(resolve(packageRoot, 'deployment/ponto-pages-governed-publisher-contract.json'), 'utf8'))
const environmentTemplate = JSON.parse(readFileSync(resolve(packageRoot, 'deployment/github-environment.template.json'), 'utf8'))
const runtimeTemplate = readFileSync(resolve(packageRoot, 'deployment/wrangler.runtime.template.toml'), 'utf8')
const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/ponto-pages-governed-publisher.yml'), 'utf8')
const candidateWorkflow = readFileSync(resolve(repositoryRoot, '.github/workflows/ponto-pages-candidate-preflight.yml'), 'utf8')
const promotionGate = readFileSync(resolve(repositoryRoot, '.github/workflows/promotion-gate.yml'), 'utf8')

describe('Ponto Pages governed publisher', () => {
  it('reserves only the two dedicated Pages projects and separate GitHub environments', () => {
    expect(contract.status).toBe('guarded-manual-publisher')
    expect(contract.publication).toMatchObject({ manualOnly: true, defaultPublish: false, publisherImplemented: true })
    expect(contract.projectPolicy.forbiddenProjects).toEqual(['skincos', 'skincos-staging'])
    expect(contract.projectPolicy.targets).toMatchObject({
      staging: { project: 'skincos-ponto-staging', githubEnvironment: 'ponto-pages-staging', productionBranch: 'main', bindingServices: { PONTO_CORE: 'skincos-ponto-core-staging', PONTO_IDENTITY: 'skincos-insumos-staging' } },
      production: { project: 'skincos-ponto', githubEnvironment: 'ponto-pages-production', productionBranch: 'main', bindingServices: { PONTO_CORE: 'skincos-ponto-core', PONTO_IDENTITY: 'skincos-insumos' } },
    })
    expect(contract.projectPolicy.targets.staging.project).not.toBe(contract.projectPolicy.targets.production.project)
    expect(environmentTemplate.targets.staging.githubEnvironment).toBe('ponto-pages-staging')
    expect(environmentTemplate.targets.production.githubEnvironment).toBe('ponto-pages-production')
    expect(contract.stagingCoreCandidateReceipt).toMatchObject({
      workflowName: 'Ponto Core staging candidate',
      workflowPath: '.github/workflows/ponto-core-staging-candidate.yml',
      workflowInput: 'core_candidate_run_id',
      artifactName: 'ponto-core-staging-candidate-<source_sha>',
      receiptFile: 'ponto-core-staging-candidate.json',
      contractId: 'skincos/ponto-core-staging-candidate/v1',
    })
  })

  it('keeps only Ponto runtime roles and runner-only placeholders in the template', () => {
    expect(contract.runtimeContract.serviceBindings).toEqual(['PONTO_CORE', 'PONTO_IDENTITY'])
    expect(contract.runtimeContract.kvBindings).toEqual(['MODULE_CONTROL'])
    expect(contract.runtimeContract.runtimeSecrets).toEqual([
      'PONTO_API_TARGET',
      'AUTH_API_TARGET',
      'INSUMOS_API_TARGET',
      'PONTO_ACTOR_HMAC_KEY',
      'PONTO_NETWORK_CONTEXT_KEY',
      'PONTO_RELEASE_PROBE_HMAC_KEY',
    ])
    expect(runtimeTemplate).toContain('__PONTO_PAGES_PROJECT__')
    expect(runtimeTemplate).not.toMatch(/^\s*(account_id|route|routes|zone_id)\s*=/m)
    expect(runtimeTemplate).not.toMatch(/name\s*=\s*"(?:skincos|skincos-staging)"/)
    for (const unwanted of contract.runtimeContract.forbiddenLegacyBindings) expect(runtimeTemplate).not.toContain(unwanted)
  })

  it('is manual, literal-targeted, and defaults to a non-publishing state', () => {
    expect(workflow).toMatch(/^\s*workflow_dispatch:/m)
    expect(workflow).not.toMatch(/^\s{2}(push|pull_request|schedule|workflow_run|repository_dispatch):/m)
    expect(workflow).toContain('default: false')
    expect(workflow).toContain("EXPECTED_PROJECT='skincos-ponto-staging'")
    expect(workflow).toContain("EXPECTED_PROJECT='skincos-ponto'")
    expect(workflow).toContain('PROJECT_CONFIGURED" == "$EXPECTED_PROJECT')
    expect(workflow).toContain('PONTO_PAGES_PUBLISH_DISABLED')
    expect(workflow).toContain('PONTO_PAGES_LEGACY_PROJECT_FORBIDDEN')
    expect(workflow).toContain('PONTO_PAGES_STAGING_CORE_CANDIDATE_RUN_REQUIRED')
    expect(workflow).toContain('--json conclusion,headBranch,headSha,workflowName')
    expect(workflow).toContain('ponto-core-staging-candidate-$RELEASE_SHA')
    expect(workflow).toContain('verify-ponto-core-staging-candidate.mjs')
    expect(workflow).toContain('PONTO_PAGES_REMOTE_SECRET_')
    expect(workflow).toContain("envVars[name]?.type !== 'secret_text'")
    expect(workflow).toContain("promotion_environment: ${{ inputs.target == 'staging' && 'ponto-pages-staging' || 'ponto-pages-production' }}")
    expect(candidateWorkflow).toContain('promotion_environment: ponto-pages-staging')
    expect(promotionGate).toContain('promotion_environment: { required: false, type: string, default: "" }')
    expect(promotionGate).toContain('environment: ${{ inputs.promotion_environment || inputs.target }}')
    expect(workflow).toContain('if: ${{ inputs.publish }}')
    expect(workflow).toContain('global-coordination-acquire')
    expect((workflow.match(/global-coordination-check/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(workflow).toContain('wrangler@4.114.0 pages secret bulk')
    expect(workflow).toContain('wrangler@4.114.0 pages deploy')
  })

  it('emits a sanitised plan that cannot authorize publication locally', () => {
    const output = execFileSync(process.execPath, [
      'scripts/validate-governed-publisher.mjs',
      '--target', 'staging',
      '--release-sha', 'a'.repeat(40),
    ], { cwd: packageRoot, encoding: 'utf8' })
    expect(JSON.parse(output)).toMatchObject({
      target: 'staging',
      project: 'skincos-ponto-staging',
      publishAllowed: false,
      result: 'PONTO_PAGES_PUBLISH_REQUIRES_PROTECTED_ENVIRONMENT',
      valuesIncluded: false,
      credentialsIncluded: false,
    })
  })
})
