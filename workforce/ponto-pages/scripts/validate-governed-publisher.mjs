import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryRoot = resolve(packageRoot, '../..')
const contractPath = resolve(packageRoot, 'deployment/ponto-pages-governed-publisher-contract.json')
const environmentTemplatePath = resolve(packageRoot, 'deployment/github-environment.template.json')
const runtimeTemplatePath = resolve(packageRoot, 'deployment/wrangler.runtime.template.toml')
const phase1ConfigPath = resolve(packageRoot, 'wrangler.toml')
const workflowPath = resolve(repositoryRoot, '.github/workflows/ponto-pages-governed-publisher.yml')
const candidateWorkflowPath = resolve(repositoryRoot, '.github/workflows/ponto-pages-candidate-preflight.yml')
const singleWriterPolicyPath = resolve(repositoryRoot, '.github/governance/cloudflare-single-writer-policy.json')

const expected = {
  targets: {
    staging: {
      project: 'skincos-ponto-staging',
      projectSubdomain: 'skincos-ponto-staging.pages.dev',
      productionBranch: 'main',
      githubEnvironment: 'ponto-pages-staging',
      runtimeEnvironment: 'staging',
      bindingServices: {
        PONTO_CORE: 'skincos-ponto-core-staging',
        PONTO_IDENTITY: 'skincos-insumos-staging',
      },
      allowedRolloutStages: ['staging'],
    },
    production: {
      project: 'skincos-ponto',
      projectSubdomain: 'skincos-ponto.pages.dev',
      productionBranch: 'main',
      githubEnvironment: 'ponto-pages-production',
      runtimeEnvironment: 'production',
      bindingServices: {
        PONTO_CORE: 'skincos-ponto-core',
        PONTO_IDENTITY: 'skincos-insumos',
      },
      allowedRolloutStages: ['maintenance'],
    },
  },
  serviceBindings: ['PONTO_CORE', 'PONTO_IDENTITY'],
  kvBindings: ['MODULE_CONTROL'],
  runtimeVars: ['SKINCOS_DEPLOYMENT_ENV', 'PONTO_RELEASE_SHA', 'PONTO_ROLLOUT_STAGE'],
  runtimeSecrets: [
    'PONTO_API_TARGET',
    'AUTH_API_TARGET',
    'INSUMOS_API_TARGET',
    'PONTO_ACTOR_HMAC_KEY',
    'PONTO_NETWORK_CONTEXT_KEY',
    'PONTO_RELEASE_PROBE_HMAC_KEY',
  ],
  environmentVariables: [
    'PONTO_PAGES_PROJECT',
    'PONTO_PAGES_CORE_SERVICE',
    'PONTO_PAGES_IDENTITY_SERVICE',
    'PONTO_PAGES_MODULE_CONTROL_KV_ID',
    'PONTO_PAGES_CORE_VERSION_ID',
    'PONTO_PAGES_IDENTITY_VERSION_ID',
    'PONTO_PAGES_PUBLISH_ENABLED',
    'SKINCOS_GLOBAL_COORDINATION_REQUIRED',
    'SKINCOS_GLOBAL_COORDINATOR_URL',
    'SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL',
  ],
  environmentSecrets: [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'PONTO_API_TARGET',
    'AUTH_API_TARGET',
    'INSUMOS_API_TARGET',
    'PONTO_ACTOR_HMAC_KEY',
    'PONTO_NETWORK_CONTEXT_KEY',
    'PONTO_RELEASE_PROBE_HMAC_KEY',
    'SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET',
  ],
  stagingCoreCandidateReceipt: {
    workflowName: 'Ponto Core staging candidate',
    workflowPath: '.github/workflows/ponto-core-staging-candidate.yml',
    workflowInput: 'core_candidate_run_id',
    artifactName: 'ponto-core-staging-candidate-<source_sha>',
    receiptFile: 'ponto-core-staging-candidate.json',
    contractId: 'skincos/ponto-core-staging-candidate/v1',
    requiredEvidence: [
      'same-main-source-sha-and-tree',
      'exact-ponto-core-and-identity-service-version-identities',
      'staging-readiness-and-rollback',
      'private-no-domain-no-workers-dev-exposure',
      'sanitised-receipt-without-values-credentials-or-pii',
    ],
  },
}

function fail(code) {
  throw new Error(`PONTO_GOVERNED_PUBLISHER_INVALID:${code}`)
}

function sameList(actual, expectedList) {
  return Array.isArray(actual)
    && actual.length === expectedList.length
    && actual.every((value, index) => value === expectedList[index])
}

function readArgument(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) fail(`ARGUMENT_${name.slice(2).toUpperCase()}_MISSING`)
  return value
}

function assertNoLegacyProject(value, label) {
  if (value === 'skincos' || value === 'skincos-staging') fail(`${label}_LEGACY_PROJECT_FORBIDDEN`)
}

export async function validateGovernedPublisher({ target, releaseSha } = {}) {
  const [contractSource, environmentSource, runtimeTemplate, phase1Config, workflow, candidateWorkflow, policySource] = await Promise.all([
    readFile(contractPath, 'utf8'),
    readFile(environmentTemplatePath, 'utf8'),
    readFile(runtimeTemplatePath, 'utf8'),
    readFile(phase1ConfigPath, 'utf8'),
    readFile(workflowPath, 'utf8'),
    readFile(candidateWorkflowPath, 'utf8'),
    readFile(singleWriterPolicyPath, 'utf8'),
  ])
  const contract = JSON.parse(contractSource)
  const environmentTemplate = JSON.parse(environmentSource)
  const singleWriterPolicy = JSON.parse(policySource)

  if (contract.schemaVersion !== 1 || contract.contractId !== 'skincos/ponto-pages-governed-publisher/phase-2') {
    fail('CONTRACT_ID')
  }
  if (contract.status !== 'guarded-manual-publisher' || contract.publication?.manualOnly !== true
    || contract.publication?.defaultPublish !== false || contract.publication?.publisherImplemented !== true
    || contract.publication?.requiresExactSourceSha !== true || contract.publication?.requiresSourceReachableFromMain !== true) {
    fail('PUBLICATION_POSTURE')
  }
  if (!sameList(contract.projectPolicy?.forbiddenProjects, ['skincos', 'skincos-staging'])) fail('FORBIDDEN_PROJECTS')
  if (JSON.stringify(contract.stagingCoreCandidateReceipt) !== JSON.stringify(expected.stagingCoreCandidateReceipt)
    || !sameList(contract.futureGates, [
      'protected-target-github-environment',
      'exact-remote-project-identity-readback',
      'secret-injection-without-value-logging',
      'isolated-staging-synthetic-smoke',
      'same-artifact-rollback-receipt',
      'domain-cookie-and-terminal-repair-plan',
      'single-writer-policy-update',
      'exact-ponto-core-staging-candidate-receipt',
    ])) {
    fail('CORE_CANDIDATE_RECEIPT_CONTRACT')
  }

  for (const [targetName, targetExpectation] of Object.entries(expected.targets)) {
    const configured = contract.projectPolicy?.targets?.[targetName]
    if (!configured || Object.entries(targetExpectation).some(([key, value]) => {
      return Array.isArray(value)
        ? !sameList(configured[key], value)
        : typeof value === 'object'
          ? JSON.stringify(configured[key]) !== JSON.stringify(value)
          : configured[key] !== value
    })) fail(`TARGET_${targetName.toUpperCase()}_CONTRACT`)
    assertNoLegacyProject(configured.project, `TARGET_${targetName.toUpperCase()}`)
    if (configured.project === contract.projectPolicy.targets[targetName === 'staging' ? 'production' : 'staging'].project) {
      fail('TARGET_PROJECTS_NOT_ISOLATED')
    }
    const environment = environmentTemplate.targets?.[targetName]
    if (!environment || environment.githubEnvironment !== configured.githubEnvironment
      || !sameList(environment.variables, expected.environmentVariables)
      || !sameList(environment.secrets, expected.environmentSecrets)) {
      fail(`TARGET_${targetName.toUpperCase()}_ENVIRONMENT_TEMPLATE`)
    }
  }

  const runtimeContract = contract.runtimeContract
  if (!sameList(runtimeContract?.serviceBindings, expected.serviceBindings)
    || !sameList(runtimeContract?.kvBindings, expected.kvBindings)
    || !sameList(runtimeContract?.runtimeVars, expected.runtimeVars)
    || !sameList(runtimeContract?.runtimeSecrets, expected.runtimeSecrets)) {
    fail('RUNTIME_BINDING_CONTRACT')
  }
  for (const name of runtimeContract.forbiddenLegacyBindings || []) {
    if (runtimeTemplate.includes(name)) fail(`LEGACY_BINDING_${name}_IN_TEMPLATE`)
  }
  for (const name of runtimeContract.forbiddenLocalVars || []) {
    if (runtimeTemplate.includes(name)) fail(`LOCAL_VAR_${name}_IN_TEMPLATE`)
  }
  for (const token of [
    '__PONTO_PAGES_PROJECT__',
    '__PONTO_PAGES_CORE_SERVICE__',
    '__PONTO_PAGES_IDENTITY_SERVICE__',
    '__PONTO_PAGES_MODULE_CONTROL_KV_ID__',
    '__PONTO_PAGES_RUNTIME_ENV__',
    '__PONTO_RELEASE_SHA__',
    '__PONTO_ROLLOUT_STAGE__',
    '__PONTO_PAGES_CORE_VERSION_ID__',
    '__PONTO_PAGES_IDENTITY_VERSION_ID__',
  ]) {
    if (!runtimeTemplate.includes(token)) fail(`RUNTIME_TEMPLATE_TOKEN_${token}`)
  }
  if (/^\s*(account_id|route|routes|zone_id)\s*=/mi.test(runtimeTemplate)
    || /name\s*=\s*"(?:skincos|skincos-staging)"/i.test(runtimeTemplate)) {
    fail('RUNTIME_TEMPLATE_TARGET_LEAK')
  }
  if (!phase1Config.includes('name = "skincos-ponto-pages-phase1-unconfigured"')
    || contract.phase1SourceConfigSha256 !== '441175006adaaea277927a315008f533b02e847f5ba811340067864f613c0763'
    || createHash('sha256').update(phase1Config).digest('hex') !== contract.phase1SourceConfigSha256
    || /^\s*(account_id|route|routes|zone_id)\s*=/mi.test(phase1Config)) {
    fail('PHASE1_SOURCE_CONTRACT_CHANGED')
  }

  if (!/^\s*workflow_dispatch:/m.test(workflow)
    || /^\s{2}(push|pull_request|schedule|workflow_run|repository_dispatch):/m.test(workflow)
    || !workflow.includes('default: false')
    || !workflow.includes("EXPECTED_PROJECT='skincos-ponto-staging'")
    || !workflow.includes("EXPECTED_PROJECT='skincos-ponto'")
    || !workflow.includes('PROJECT_CONFIGURED" == "$EXPECTED_PROJECT')
    || !workflow.includes('PONTO_PAGES_PUBLISH_ENABLED')
    || !workflow.includes('global-coordination-acquire')
    || (workflow.match(/global-coordination-check/g) || []).length < 2
    || !workflow.includes('wrangler@4.114.0 pages secret bulk')
    || !workflow.includes('wrangler@4.114.0 pages deploy')
    || !workflow.includes('api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${EXPECTED_PROJECT}')
    || !workflow.includes('git rev-parse HEAD')
    || !workflow.includes('git merge-base --is-ancestor')
    || !workflow.includes('PONTO_PAGES_WORKFLOW_REF_NOT_MAIN')) {
    fail('WORKFLOW_GATES')
  }
  if (!workflow.includes('if: ${{ inputs.publish }}')
    || !workflow.includes('PONTO_PAGES_PUBLISH_DISABLED')
    || !workflow.includes('PONTO_PAGES_LEGACY_PROJECT_FORBIDDEN')
    || !workflow.includes('core_candidate_run_id')
    || !workflow.includes('PONTO_PAGES_STAGING_CORE_CANDIDATE_RUN_REQUIRED')
    || !workflow.includes('--json conclusion,headBranch,headSha,workflowName')
    || !workflow.includes("metadata?.workflowName !== 'Ponto Core staging candidate'")
    || !workflow.includes('ponto-core-staging-candidate-$RELEASE_SHA')
    || !workflow.includes('verify-ponto-core-staging-candidate.mjs')
    || !workflow.includes('PONTO_PAGES_REMOTE_SECRET_')
    || !workflow.includes("envVars[name]?.type !== 'secret_text'")
    || !workflow.includes("promotion_environment: ${{ inputs.target == 'staging' && 'ponto-pages-staging' || 'ponto-pages-production' }}")) {
    fail('WORKFLOW_DEFAULT_FAIL_CLOSED')
  }
  if (!/^\s*workflow_dispatch:/m.test(candidateWorkflow)
    || /^\s{2}(push|pull_request|schedule|workflow_run|repository_dispatch):/m.test(candidateWorkflow)
    || !candidateWorkflow.includes('promotion_environment: ponto-pages-staging')
    || !candidateWorkflow.includes('PONTO_PAGES_WORKFLOW_REF_NOT_MAIN')) {
    fail('CANDIDATE_PREFLIGHT_DEDICATED_ENVIRONMENT')
  }

  const dedicatedGroup = (singleWriterPolicy.coordinationGroups || []).find(
    (group) => group?.id === 'ponto-pages-dedicated-writer',
  )
  const dedicatedSurface = (singleWriterPolicy.surfaces || []).find(
    (surface) => surface?.id === 'ponto-pages-dedicated',
  )
  if (dedicatedGroup?.resource !== 'deploy:ponto-pages:<environment>'
    || dedicatedSurface?.platform !== 'cloudflare-pages'
    || dedicatedSurface?.canonicalDeployWorkflow !== '.github/workflows/ponto-pages-governed-publisher.yml'
    || dedicatedSurface?.coordinationGroup !== 'ponto-pages-dedicated-writer'
    || !sameList(dedicatedSurface?.projects, ['skincos-ponto', 'skincos-ponto-staging'])
    || !sameList(dedicatedSurface?.mutationWorkflows, ['.github/workflows/ponto-pages-governed-publisher.yml'])
    || dedicatedSurface?.automaticDeploymentsRequired !== false
    || !['skincos-ponto', 'skincos-ponto-staging'].every(
      (project) => singleWriterPolicy.pagesGitIntegration?.governedProjects?.includes(project)
        && singleWriterPolicy.pagesGitIntegration?.directUploadProjects?.includes(project),
    )) {
    fail('SINGLE_WRITER_POLICY')
  }

  if (target !== undefined && !Object.hasOwn(expected.targets, target)) fail('TARGET_UNSUPPORTED')
  if (releaseSha !== undefined && !/^[0-9a-f]{40}$/i.test(releaseSha)) fail('RELEASE_SHA_INVALID')
  const selected = target ? contract.projectPolicy.targets[target] : undefined
  return {
    schemaVersion: 1,
    contractId: contract.contractId,
    status: 'guarded-manual-publisher',
    target: target || null,
    project: selected?.project || null,
    githubEnvironment: selected?.githubEnvironment || null,
    sourceSha: releaseSha || null,
    publishAllowed: false,
    result: 'PONTO_PAGES_PUBLISH_REQUIRES_PROTECTED_ENVIRONMENT',
    requiredBindingNames: {
      services: runtimeContract.serviceBindings,
      kv: runtimeContract.kvBindings,
      vars: runtimeContract.runtimeVars,
      secrets: runtimeContract.runtimeSecrets,
    },
    stagingCoreCandidateReceipt: contract.stagingCoreCandidateReceipt,
    valuesIncluded: false,
    credentialsIncluded: false,
  }
}

async function main() {
  const target = readArgument('--target')
  const releaseSha = readArgument('--release-sha')
  const emitPlan = readArgument('--emit-plan')
  const result = await validateGovernedPublisher({ target, releaseSha })
  if (emitPlan) {
    await mkdir(dirname(resolve(emitPlan)), { recursive: true })
    await writeFile(resolve(emitPlan), `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`)
    process.exitCode = 1
  })
}
