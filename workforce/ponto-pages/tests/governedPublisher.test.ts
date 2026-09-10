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

function workflowStep(name: string) {
  const marker = `      - name: ${name}\n`
  const start = workflow.indexOf(marker)
  const end = workflow.indexOf('\n      - ', start + marker.length)
  return start < 0 ? '' : workflow.slice(start, end < 0 ? workflow.length : end)
}

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
    expect(contract.stagingPagesSmokeReceipt).toMatchObject({
      workflowName: 'Ponto Pages staging synthetic smoke',
      workflowPath: '.github/workflows/ponto-pages-staging-synthetic-smoke.yml',
      workflowInput: 'staging_smoke_run_id',
      stagingPublishRunInput: 'staging_run_id',
      artifactName: 'ponto-pages-staging-synthetic-smoke-<source_sha>-<project>',
      receiptFile: 'ponto-pages-staging-synthetic-smoke.json',
      contractId: 'skincos/ponto-pages-staging-synthetic-smoke/v1',
    })
    expect(contract.stagingPagesRollbackReceipt).toMatchObject({
      workflowName: 'Ponto Pages staging same-artifact rollback',
      workflowPath: '.github/workflows/ponto-pages-staging-same-artifact-rollback.yml',
      workflowInput: 'staging_rollback_run_id',
      stagingPublishRunInput: 'staging_run_id',
      artifactName: 'ponto-pages-staging-same-artifact-rollback-<source_sha>-<project>',
      receiptFile: 'ponto-pages-staging-same-artifact-rollback.json',
      contractId: 'skincos/ponto-pages-staging-same-artifact-rollback/v1',
    })
    for (const target of Object.values(environmentTemplate.targets) as Array<{ secrets: string[] }>) {
      expect(target.secrets).toContain('PONTO_PAGES_CLOUDFLARE_ACCOUNT_ID')
      expect(target.secrets).toContain('PONTO_PAGES_CLOUDFLARE_API_TOKEN')
      expect(target.secrets).not.toContain('CLOUDFLARE_ACCOUNT_ID')
      expect(target.secrets).not.toContain('CLOUDFLARE_API_TOKEN')
      expect(target.secrets).toEqual(contract.githubEnvironmentSecretInputs)
      for (const secretName of target.secrets) expect(secretName).toMatch(/^PONTO_PAGES_/)
    }
    expect(contract.githubEnvironmentSecretInputs).toEqual([
      'PONTO_PAGES_CLOUDFLARE_ACCOUNT_ID',
      'PONTO_PAGES_CLOUDFLARE_API_TOKEN',
      'PONTO_PAGES_PONTO_API_TARGET',
      'PONTO_PAGES_AUTH_API_TARGET',
      'PONTO_PAGES_INSUMOS_API_TARGET',
      'PONTO_PAGES_ACTOR_HMAC_KEY',
      'PONTO_PAGES_NETWORK_CONTEXT_KEY',
      'PONTO_PAGES_RELEASE_PROBE_HMAC_KEY',
      'PONTO_PAGES_GLOBAL_COORDINATION_SHARED_SECRET',
    ])
    expect(contract.runtimeSecretSourceNames).toEqual({
      PONTO_API_TARGET: 'PONTO_PAGES_PONTO_API_TARGET',
      AUTH_API_TARGET: 'PONTO_PAGES_AUTH_API_TARGET',
      INSUMOS_API_TARGET: 'PONTO_PAGES_INSUMOS_API_TARGET',
      PONTO_ACTOR_HMAC_KEY: 'PONTO_PAGES_ACTOR_HMAC_KEY',
      PONTO_NETWORK_CONTEXT_KEY: 'PONTO_PAGES_NETWORK_CONTEXT_KEY',
      PONTO_RELEASE_PROBE_HMAC_KEY: 'PONTO_PAGES_RELEASE_PROBE_HMAC_KEY',
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
    expect(runtimeTemplate).toContain('[[env.production.services]]')
    expect(runtimeTemplate).toContain('[[env.production.kv_namespaces]]')
    expect(runtimeTemplate).toContain('[env.production.vars]')
    expect(runtimeTemplate).not.toMatch(/^\s*\[\[services\]\]/m)
    expect(runtimeTemplate).not.toMatch(/^\s*\[\[kv_namespaces\]\]/m)
    expect(runtimeTemplate).not.toMatch(/^\s*\[vars\]/m)
    expect(runtimeTemplate).not.toContain('[env.preview')
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
    expect(workflow).toContain('PONTO_PAGES_STAGING_ROLLBACK_RECEIPT_FORBIDDEN')
    expect(workflow).toContain('actions/workflows/ponto-core-staging-candidate.yml')
    expect(workflow).toContain('actions/runs/$CORE_CANDIDATE_RUN_ID')
    expect(workflow).toContain("workflow?.path !== '.github/workflows/ponto-core-staging-candidate.yml'")
    expect(workflow).toContain('Number(run?.run_attempt) !== 1')
    expect(workflow).toContain('run?.head_repository?.full_name !== process.env.GITHUB_REPOSITORY')
    expect(workflow).toContain('ponto-core-staging-candidate-$RELEASE_SHA')
    expect(workflow).toContain('verify-ponto-core-staging-candidate.mjs')
    expect(workflow).toContain('staging_rollback_run_id')
    expect(workflow).toContain('staging_smoke_run_id')
    expect(workflow).toContain('PONTO_PAGES_STAGING_SMOKE_RECEIPT_REQUIRED')
    expect(workflow).toContain('ponto-pages-staging-synthetic-smoke-$RELEASE_SHA-$staging_project')
    expect(workflow).toContain('verify-ponto-pages-staging-smoke.mjs')
    expect(workflow).toContain('PONTO_PAGES_STAGING_SAME_ARTIFACT_ROLLBACK_RECEIPT_REQUIRED')
    expect(workflow).toContain('ponto-pages-staging-same-artifact-rollback-$RELEASE_SHA-$staging_project')
    expect(workflow).toContain('verify-ponto-pages-same-artifact-rollback.mjs')
    expect(workflow).toContain('PONTO_API_TARGET AUTH_API_TARGET INSUMOS_API_TARGET')
    expect(workflow).toContain("promotion_environment: ${{ inputs.target == 'staging' && 'ponto-pages-staging' || 'ponto-pages-production' }}")
    expect(candidateWorkflow).toContain('promotion_environment: ponto-pages-staging')
    expect(promotionGate).toContain('promotion_environment: { required: false, type: string, default: "" }')
    expect(promotionGate).toContain('environment: ${{ inputs.promotion_environment || inputs.target }}')
    expect(workflow).toContain('if: ${{ inputs.publish }}')
    expect(workflow).toContain('global-coordination-acquire')
    expect((workflow.match(/global-coordination-check/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(workflow).toContain('wrangler@4.114.0 pages secret bulk')
    expect(workflow).toContain('wrangler@4.114.0 pages deploy')
    expect(workflow).toContain('secrets.PONTO_PAGES_CLOUDFLARE_ACCOUNT_ID')
    expect(workflow).toContain('secrets.PONTO_PAGES_CLOUDFLARE_API_TOKEN')
    expect(workflow).not.toContain('secrets.CLOUDFLARE_ACCOUNT_ID')
    expect(workflow).not.toContain('secrets.CLOUDFLARE_API_TOKEN')
    for (const [runtimeName, sourceName] of Object.entries(contract.runtimeSecretSourceNames)) {
      expect(workflow).toContain('secrets.' + sourceName)
      expect(workflow).toContain(runtimeName + ': process.env.' + sourceName)
    }
    expect(workflow).toContain('secrets.PONTO_PAGES_GLOBAL_COORDINATION_SHARED_SECRET')
    for (const genericName of [
      'PONTO_API_TARGET',
      'AUTH_API_TARGET',
      'INSUMOS_API_TARGET',
      'PONTO_ACTOR_HMAC_KEY',
      'PONTO_NETWORK_CONTEXT_KEY',
      'PONTO_RELEASE_PROBE_HMAC_KEY',
      'SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET',
    ]) expect(workflow).not.toContain('secrets.' + genericName)
    expect((workflow.match(/curl --disable --fail --silent --show-error/g) || []).length).toBe(4)
    expect((workflow.match(/--header @-/g) || []).length).toBe(4)
    expect(workflow).toContain('"$project_file" "$EXPECTED_PROJECT" empty')
    expect(workflow).toContain('"$secret_readback_file" "$EXPECTED_PROJECT" secrets')
    expect(workflow).toContain('"$runtime_readback_file" "$EXPECTED_PROJECT" runtime')
    expect(workflow).toContain('PONTO_PAGES_EXPECTED_MODULE_CONTROL_KV_ID')
    expect(workflow).not.toMatch(/-H\s+"Authorization: Bearer \$PONTO_PAGES_CLOUDFLARE_API_TOKEN"/)

    for (const mutationStep of [
      workflowStep('Configure Ponto-only Pages secrets without printing values'),
      workflowStep('Deploy only the exact dedicated Ponto Pages project'),
    ]) {
      expect(mutationStep).toContain('CLOUDFLARE_API_TOKEN="$PONTO_PAGES_CLOUDFLARE_API_TOKEN"')
      expect(mutationStep).toContain('CLOUDFLARE_ACCOUNT_ID="$PONTO_PAGES_CLOUDFLARE_ACCOUNT_ID"')
    }

    const coreCandidate = workflowStep('Verify exact Ponto Core staging candidate receipt')
    for (const marker of [
      'actions/workflows/ponto-core-staging-candidate.yml',
      'actions/runs/$CORE_CANDIDATE_RUN_ID',
      "workflow?.path !== '.github/workflows/ponto-core-staging-candidate.yml'",
      "workflow?.name !== 'Ponto Core staging candidate'",
      'Number(run?.workflow_id) !== Number(workflow?.id)',
      "run?.event !== 'workflow_dispatch'",
      'Number(run?.run_attempt) !== 1',
      "run?.head_branch !== 'main'",
      'run?.head_repository?.full_name !== process.env.GITHUB_REPOSITORY',
      'Number(run?.repository?.id) !== Number(process.env.EXPECTED_REPOSITORY_ID)',
      'Number(run?.head_repository?.id) !== Number(process.env.EXPECTED_REPOSITORY_ID)',
    ]) expect(coreCandidate).toContain(marker)
    expect(coreCandidate).not.toContain('gh run view')
    expect(coreCandidate.indexOf("fail('PROVENANCE')")).toBeLessThan(coreCandidate.indexOf('gh run download'))

    const rollback = workflowStep('Verify exact Ponto Pages staging same-artifact rollback receipt')
    for (const marker of [
      "if: ${{ inputs.target == 'production' }}",
      'actions/workflows/ponto-pages-staging-same-artifact-rollback.yml',
      'actions/runs/$STAGING_ROLLBACK_RUN_ID',
      "workflow?.path !== '.github/workflows/ponto-pages-staging-same-artifact-rollback.yml'",
      "workflow?.name !== 'Ponto Pages staging same-artifact rollback'",
      'Number(run?.workflow_id) !== Number(workflow?.id)',
      "run?.event !== 'workflow_dispatch'",
      'Number(run?.run_attempt) !== 1',
      'run?.head_repository?.full_name !== process.env.GITHUB_REPOSITORY',
      'Number(run?.repository?.id) !== Number(process.env.EXPECTED_REPOSITORY_ID)',
      'Number(run?.head_repository?.id) !== Number(process.env.EXPECTED_REPOSITORY_ID)',
      'PONTO_EXPECTED_STAGING_PUBLISH_RUN_ID="$STAGING_PUBLISH_RUN_ID"',
      'verify-ponto-pages-same-artifact-rollback.mjs',
    ]) expect(rollback).toContain(marker)
    expect(rollback.indexOf("fail('PROVENANCE')")).toBeLessThan(rollback.indexOf('gh run download'))
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
