import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const workflow = readFileSync(new URL('../../.github/workflows/deploy-schedule-public-read-adapter.yml', import.meta.url), 'utf8')
const coreWorkflow = readFileSync(new URL('../../.github/workflows/deploy-escala-api.yml', import.meta.url), 'utf8')
const adapterConfig = readFileSync(new URL('./public-read.wrangler.toml', import.meta.url), 'utf8')
const coreConfig = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8')
const smoke = readFileSync(new URL('./scripts/public-read-staging-smoke.mjs', import.meta.url), 'utf8')
const disabledHealth = readFileSync(new URL('./scripts/public-read-disabled-health.mjs', import.meta.url), 'utf8')
const readyHealth = readFileSync(new URL('./scripts/public-read-ready-health.mjs', import.meta.url), 'utf8')
const coreSmoke = readFileSync(new URL('./scripts/public-read-core-staging-smoke.mjs', import.meta.url), 'utf8')
const units = JSON.parse(readFileSync(new URL('../../platform/deploy/operational-units.json', import.meta.url), 'utf8'))
const singleWriter = JSON.parse(readFileSync(new URL('../../.github/governance/cloudflare-single-writer-policy.json', import.meta.url), 'utf8'))

function stepSection(document, name, nextName) {
  const start = document.indexOf(`- name: ${name}`)
  const end = nextName ? document.indexOf(`- name: ${nextName}`, start + 1) : document.length
  assert.ok(start >= 0, `workflow is missing step: ${name}`)
  assert.ok(end > start, `workflow has no complete step section: ${name}`)
  return document.slice(start, end)
}

function runBlock(step) {
  const match = step.match(/        run: \|\r?\n([\s\S]*)$/)
  assert.ok(match, 'workflow step is missing a literal run block')
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.startsWith('          ') ? line.slice(10) : line)
    .join('\n')
}

function runEscalaDeployGuard(overrides = {}) {
  const guard = stepSection(coreWorkflow, 'Guard Escala deploy settings', 'Checkout')
  const root = mkdtempSync(join(tmpdir(), 'skincos-escala-deploy-guard-'))
  const githubOutput = join(root, 'github-output')
  const env = {
    ...process.env,
    ENABLE: 'true',
    ENABLE_SCHEDULE_PUBLIC_READ: 'true',
    CLOUDFLARE_API_TOKEN: 'fake-cloudflare-token',
    CLOUDFLARE_ACCOUNT_ID: 'fake-cloudflare-account',
    ESCALA_ACTOR_HMAC_KEY: 'fake-actor-capability',
    SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: 'fake-core-capability',
    SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY: 'fake-active-coordination-key',
    SKINCOS_GLOBAL_COORDINATION_KEY_ID: 'active-v2',
    GITHUB_OUTPUT: githubOutput,
    ...overrides,
  }
  const script = runBlock(guard)

  try {
    return {
      script,
      syntax: spawnSync('bash', ['-n'], { input: script, encoding: 'utf8', env }),
      result: spawnSync('bash', ['-c', script], { encoding: 'utf8', env }),
      githubOutput: existsSync(githubOutput) ? readFileSync(githubOutput, 'utf8') : '',
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('Schedule public-read adapter is a manual preview/staging-only publisher', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /options: \[preview, staging\]/)
  assert.doesNotMatch(workflow, /options: \[[^\]]*production/i)
  assert.match(workflow, /uses: \.\/\.github\/workflows\/promotion-gate\.yml/)
  assert.match(workflow, /unit: schedule-public-read-adapter/)
  assert.match(workflow, /release_sha: \$\{\{ inputs\.release_sha \}\}/)
  assert.match(workflow, /preview_run_id: \$\{\{ inputs\.preview_run_id \}\}/)
  assert.match(workflow, /bootstrap_run_id:/)
  assert.match(workflow, /options: \[bootstrap-disabled, deploy, disable\]/)
  assert.match(workflow, /bootstrap-disabled creates its own proof and must not accept a prior bootstrap run id/)
  assert.match(workflow, /deploy and disable require the successful disabled bootstrap run id before any versions upload/)
  assert.match(workflow, /environment: preview/)
  assert.match(workflow, /environment: staging/)
  assert.match(workflow, /DISPATCH_REF.*refs\/heads\/main/)
  assert.match(workflow, /RUN_ATTEMPT.*== '1'/)
})

test('Schedule public-read adapter keeps core publication and Website outside its writer scope', () => {
  assert.match(workflow, /service = "skincos-escala-api-staging"/)
  assert.match(workflow, /secret list --format json --config workforce\/schedule\/wrangler\.toml --env staging/)
  assert.match(workflow, /schedule-public-read-core-opt-in-evidence/)
  assert.match(workflow, /public-read-core-opt-in-evidence\.mjs verify/)
  assert.doesNotMatch(workflow, /deploy --config workforce\/schedule\/wrangler\.toml/)
  assert.doesNotMatch(workflow, /website\//)
  assert.doesNotMatch(workflow, /--env production/)
  assert.match(workflow, /adapter must not gain a public route/)
  assert.match(workflow, /adapter must not gain a direct D1 binding/)
})

test('Schedule public-read adapter requires a disabled Durable Object bootstrap before versioned candidates or rollbacks', () => {
  assert.match(workflow, /ENABLE_SCHEDULE_PUBLIC_READ_STAGING/)
  assert.match(workflow, /SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY/)
  assert.match(workflow, /SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY/)
  assert.match(workflow, /ESCALA_ACTOR_HMAC_KEY/)
  assert.match(workflow, /edge and core Schedule public-read HMAC keys must differ/)
  assert.match(workflow, /edge capability must differ from ESCALA_ACTOR_HMAC_KEY/)
  assert.match(workflow, /uses: \.\/\.github\/actions\/global-coordination-acquire/)
  assert.match(workflow, /uses: \.\/\.github\/actions\/global-coordination-check/)
  assert.match(workflow, /uses: \.\/\.github\/actions\/global-coordination-release/)
  assert.match(workflow, /resource: deploy:schedule-public-read-adapter:staging/)
  assert.match(workflow, /Verify disabled bootstrap proof before versioned adapter mutation/)
  assert.match(workflow, /schedule-public-read-adapter-bootstrap-evidence/)
  assert.match(workflow, /public-read-bootstrap-evidence\.mjs verify/)
  assert.match(workflow, /SCHEDULE_PUBLIC_READ_EXPECTED_SOURCE_SHA="\$RELEASE_SHA"/)
  assert.match(workflow, /SCHEDULE_PUBLIC_READ_EXPECTED_LIFECYCLE_CONFIG_DIGEST/)
  assert.match(workflow, /deployments list --json/)
  assert.match(workflow, /Bootstrap disabled staging adapter and Durable Object lifecycle/)
  assert.match(workflow, /Prove disabled bootstrap/)
  assert.match(workflow, /versions upload/)
  assert.match(workflow, /--secrets-file \/dev\/stdin/)
  assert.match(workflow, /versions deploy/)
  assert.match(workflow, /--version-tag "\$\{CANDIDATE_TAG\}@100%"/)
  assert.doesNotMatch(workflow, /\bsecret put\b/)
  const deployLines = workflow.split('\n').filter((entry) => /\bwrangler@[^\s]+ deploy\b/.test(entry))
  const nonDryRunDeploys = deployLines.filter((entry) => !entry.includes('--dry-run'))
  assert.equal(nonDryRunDeploys.length, 1)
  const bootstrapStart = workflow.indexOf('Bootstrap disabled staging adapter and Durable Object lifecycle')
  const bootstrapEnd = workflow.indexOf('Verify core staging secret inventory before adapter mutation')
  const bootstrapSection = workflow.slice(bootstrapStart, bootstrapEnd)
  assert.match(bootstrapSection, /wrangler@4\.120\.0 deploy/)
  assert.match(nonDryRunDeploys[0], /SCHEDULE_PUBLIC_READ_ENABLED:false/)
  assert.doesNotMatch(nonDryRunDeploys[0], /SCHEDULE_PUBLIC_READ_ENABLED:true/)
  assert.doesNotMatch(nonDryRunDeploys[0], /--secrets-file/)
  assert.doesNotMatch(bootstrapSection, /versions upload/)
  assert.doesNotMatch(bootstrapSection, /SCHEDULE_PUBLIC_READ_(?:EDGE|CORE)_HMAC_KEY/)
  for (const line of deployLines.filter((entry) => entry.includes('--dry-run'))) {
    assert.match(line, /--dry-run/)
  }
  const bootstrapProofIndex = workflow.indexOf('Verify disabled bootstrap proof before versioned adapter mutation')
  assert.ok(bootstrapProofIndex >= 0)
  for (const index of [...workflow.matchAll(/wrangler@[^\s]+ versions upload/g)].map((match) => match.index)) {
    assert.ok(index > bootstrapProofIndex)
  }
  assert.match(workflow, /--var "SCHEDULE_PUBLIC_READ_ENABLED:true"/)
  assert.match(workflow, /--var "SCHEDULE_PUBLIC_READ_ENABLED:false"/)
  assert.match(workflow, /Check adapter lease before automatic disabled version creation/)
  assert.match(workflow, /Check adapter lease before automatic disabled deployment/)
  assert.match(workflow, /Prove automatic disabled fallback/)
  assert.match(workflow, /automatic-disabled-version-lease/)
  assert.match(workflow, /automatic-disabled-deployment-lease/)
  assert.match(workflow, /steps\.automatic-disabled-version-lease\.outcome == 'success'/)
  assert.match(workflow, /steps\.automatic-disabled-deployment-lease\.outcome == 'success'/)
  assert.ok((workflow.match(/global-coordination-check/g) || []).length >= 7)
  for (const [name, nextName] of [
    ['Deploy HMAC-gated adapter candidate to staging', 'Run synthetic authenticated staging smoke'],
    ['Deploy automatic disabled fallback', 'Prove automatic disabled fallback'],
    ['Deploy staging adapter disabled by explicit rollback dispatch', 'Prove explicit disabled rollback'],
  ]) {
    const section = stepSection(workflow, name, nextName)
    assert.match(section, /versions deploy/)
    assert.match(section, /CLOUDFLARE_API_TOKEN/)
    assert.match(section, /CLOUDFLARE_ACCOUNT_ID/)
  }
})

test('Schedule public-read defaults disabled and only the canonical core publisher can opt in for staging', () => {
  assert.match(adapterConfig, /\[env\.staging\.vars\][\s\S]*SCHEDULE_PUBLIC_READ_ENABLED = "false"/)
  assert.match(coreConfig, /\[env\.staging\.vars\][\s\S]*SCHEDULE_PUBLIC_READ_ENABLED = "false"/)
  assert.match(coreWorkflow, /enable_schedule_public_read:/)
  assert.match(coreWorkflow, /default: false/)
  assert.match(coreWorkflow, /type: boolean/)
  assert.match(coreWorkflow, /Reject Schedule public-read enablement outside staging/)
  assert.match(coreWorkflow, /DISPATCH_REF.*github\.ref/)
  assert.match(coreWorkflow, /RUN_ATTEMPT.*github\.run_attempt/)
  assert.match(coreWorkflow, /must dispatch from protected main/)
  assert.match(coreWorkflow, /refuses reruns after a potentially mutating attempt/)
  assert.match(coreWorkflow, /SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY/)
  assert.match(coreWorkflow, /must differ from ESCALA_ACTOR_HMAC_KEY/)
  assert.match(coreWorkflow, /Create unpublished Schedule public-read core candidate with both capabilities/)
  assert.match(coreWorkflow, /--secrets-file \/dev\/stdin/)
  assert.match(coreWorkflow, /Deploy explicit Schedule public-read core candidate \(staging\)/)
  assert.match(coreWorkflow, /schedule-public-read-core-candidate-deploy/)
  assert.match(coreWorkflow, /Run authenticated Schedule public-read core smoke \(staging\)/)
  assert.match(coreWorkflow, /--var "SCHEDULE_PUBLIC_READ_ENABLED:true"/)
  assert.match(coreWorkflow, /--var "SCHEDULE_PUBLIC_READ_ENABLED:false"/)
  assert.match(coreWorkflow, /schedule-public-read-core-opt-in-evidence/)
  assert.match(coreWorkflow, /Check Escala API deployment lease before automatic disabled Schedule public-read core fallback version/)
  assert.match(coreWorkflow, /Check Escala API deployment lease before automatic disabled Schedule public-read core fallback deployment/)
  assert.match(coreWorkflow, /Deploy automatic disabled Schedule public-read core fallback/)
  assert.match(coreWorkflow, /Prove automatic disabled Schedule public-read core fallback/)
  assert.match(coreWorkflow, /schedule-public-read-core-automatic-disabled-version-lease/)
  assert.match(coreWorkflow, /schedule-public-read-core-automatic-disabled-deployment-lease/)
  assert.match(coreWorkflow, /steps\.schedule-public-read-core-automatic-disabled-version-lease\.outcome == 'success'/)
  assert.match(coreWorkflow, /steps\.schedule-public-read-core-automatic-disabled-deployment-lease\.outcome == 'success'/)
  assert.doesNotMatch(coreWorkflow, /secret put SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY/)
  const candidateDeploySection = stepSection(coreWorkflow, 'Deploy explicit Schedule public-read core candidate (staging)', 'Smoke check Escala API (production)')
  assert.match(candidateDeploySection, /CLOUDFLARE_API_TOKEN/)
  assert.match(candidateDeploySection, /CLOUDFLARE_ACCOUNT_ID/)
  assert.match(candidateDeploySection, /mutated=true/)
  const fallbackSection = stepSection(coreWorkflow, 'Create automatic disabled Schedule public-read core fallback version', 'Check Escala API deployment lease before automatic disabled Schedule public-read core fallback deployment')
  assert.match(fallbackSection, /CLOUDFLARE_API_TOKEN/)
  assert.match(fallbackSection, /CLOUDFLARE_ACCOUNT_ID/)
  assert.match(fallbackSection, /versions upload/)
  const fallbackDeploySection = stepSection(coreWorkflow, 'Deploy automatic disabled Schedule public-read core fallback', 'Prove automatic disabled Schedule public-read core fallback')
  assert.match(fallbackDeploySection, /CLOUDFLARE_API_TOKEN/)
  assert.match(fallbackDeploySection, /CLOUDFLARE_ACCOUNT_ID/)
  assert.match(fallbackDeploySection, /versions deploy/)
  const fullFallbackSection = stepSection(coreWorkflow, 'Check Escala API deployment lease before automatic disabled Schedule public-read core fallback version', 'Release Escala API deployment lease')
  assert.match(fullFallbackSection, /versions upload/)
  assert.match(fullFallbackSection, /versions deploy/)
  assert.match(fullFallbackSection, /SCHEDULE_PUBLIC_READ_ENABLED:false/)
  const productionSection = coreWorkflow.slice(
    coreWorkflow.indexOf('Deploy Escala worker (production)'),
    coreWorkflow.indexOf('Sync Escala worker secret (staging)'),
  )
  assert.match(productionSection, /SCHEDULE_PUBLIC_READ_ENABLED:false/)
  assert.doesNotMatch(productionSection, /SCHEDULE_PUBLIC_READ_ENABLED:true/)
})

test('Escala core coordination custody pins every lease boundary to the active key with exact target URLs', () => {
  const activeSecret = "shared_secret: ${{ secrets.SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY || secrets.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET }}"
  const activeKeyId = "key_id: ${{ vars.SKINCOS_GLOBAL_COORDINATION_KEY_ID || 'legacy-v1' }}"
  const targetCoordinator = "coordinator_url: ${{ inputs.target == 'staging' && vars.SKINCOS_GLOBAL_COORDINATOR_URL || vars.SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL }}"
  const stagingCoordinator = 'coordinator_url: ${{ vars.SKINCOS_GLOBAL_COORDINATOR_URL }}'
  const productionCoordinator = 'coordinator_url: ${{ vars.SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL }}'
  const expected = [
    ['Acquire Escala API deployment lease', targetCoordinator],
    ['Check Escala API deployment lease before secret mutation', targetCoordinator],
    ['Check Escala API deployment lease before production migration', productionCoordinator],
    ['Check Escala API deployment lease before production deployment', productionCoordinator],
    ['Check Escala API deployment lease before staging migration', stagingCoordinator],
    ['Check Escala API deployment lease before unpublished Schedule public-read core candidate', stagingCoordinator],
    ['Check Escala API deployment lease before staging deployment', stagingCoordinator],
    ['Check Escala API deployment lease before automatic disabled Schedule public-read core fallback version', stagingCoordinator],
    ['Check Escala API deployment lease before automatic disabled Schedule public-read core fallback deployment', stagingCoordinator],
    ['Release Escala API deployment lease', targetCoordinator],
  ]

  const leaseSteps = coreWorkflow
    .split(/(?=^      - name: )/m)
    .filter((step) => /uses: \.\/\.github\/actions\/global-coordination-(?:acquire|check|release)/.test(step))

  assert.equal(leaseSteps.length, expected.length, 'every Escala core coordination action must be enumerated')
  assert.deepEqual(
    leaseSteps.map((step) => step.match(/- name: ([^\r\n]+)/)?.[1]),
    expected.map(([name]) => name),
  )
  for (const [index, [, coordinator]] of expected.entries()) {
    assert.match(leaseSteps[index], new RegExp(activeSecret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(leaseSteps[index], new RegExp(activeKeyId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(leaseSteps[index], new RegExp(coordinator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(coreWorkflow, /shared_secret: \$\{\{ secrets\.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET \}\}/)
})

test('Escala core opt-in guard is executable, accepts distinct capabilities, and never emits them', () => {
  const { script, syntax, result, githubOutput } = runEscalaDeployGuard()

  assert.doesNotMatch(script, /<<['"]?NODE/)
  assert.match(script, /\[\[ "\$ENABLE_SCHEDULE_PUBLIC_READ" == 'true' && "\$ESCALA_ACTOR_HMAC_KEY" == "\$SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY" \]\]/)
  assert.equal(syntax.status, 0, syntax.stderr)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(githubOutput, 'skip=false\n')
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /fake-actor-capability|fake-core-capability/)
})

test('Escala core opt-in guard rejects equal capabilities without disclosing them', () => {
  const capability = 'fake-equal-capability'
  const { syntax, result, githubOutput } = runEscalaDeployGuard({
    ESCALA_ACTOR_HMAC_KEY: capability,
    SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: capability,
  })

  assert.equal(syntax.status, 0, syntax.stderr)
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /must differ from ESCALA_ACTOR_HMAC_KEY/)
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(capability))
  assert.equal(githubOutput, '')
})

test('Escala core deploy guard rejects incomplete active coordination custody while preserving legacy fallback', () => {
  const legacy = runEscalaDeployGuard({
    SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY: '',
    SKINCOS_GLOBAL_COORDINATION_KEY_ID: '',
  })
  assert.equal(legacy.syntax.status, 0, legacy.syntax.stderr)
  assert.equal(legacy.result.status, 0, legacy.result.stderr)

  const missingActive = runEscalaDeployGuard({
    SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY: '',
    SKINCOS_GLOBAL_COORDINATION_KEY_ID: 'active-v2',
  })
  assert.equal(missingActive.syntax.status, 0, missingActive.syntax.stderr)
  assert.notEqual(missingActive.result.status, 0)
  assert.match(`${missingActive.result.stdout}${missingActive.result.stderr}`, /Pinned global coordination custody requires the active coordination key/)

  const missingKeyId = runEscalaDeployGuard({
    SKINCOS_GLOBAL_COORDINATION_KEY_ID: '',
  })
  assert.equal(missingKeyId.syntax.status, 0, missingKeyId.syntax.stderr)
  assert.notEqual(missingKeyId.result.status, 0)
  assert.match(`${missingKeyId.result.stdout}${missingKeyId.result.stderr}`, /Active global coordination custody requires a non-legacy key ID/)

  const legacyKeyId = runEscalaDeployGuard({
    SKINCOS_GLOBAL_COORDINATION_KEY_ID: 'legacy-v1',
  })
  assert.equal(legacyKeyId.syntax.status, 0, legacyKeyId.syntax.stderr)
  assert.notEqual(legacyKeyId.result.status, 0)
  assert.match(`${legacyKeyId.result.stdout}${legacyKeyId.result.stderr}`, /Active global coordination custody requires a non-legacy key ID/)
})

test('Schedule public-read staging smoke is synthetic, authenticated, and does not handle the core key', () => {
  assert.match(smoke, /allowedOrigin = 'https:\/\/skincos-schedule-public-read-staging\.skincos\.workers\.dev'/)
  assert.match(smoke, /waitForDisabledSchedulePublicReadHealth/)
  assert.match(smoke, /waitForReadySchedulePublicReadHealth/)
  assert.match(smoke, /SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY/)
  assert.doesNotMatch(smoke, /SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY/)
  assert.match(smoke, /SCHEDULE_PUBLIC_READ_REPLAYED/)
  assert.match(smoke, /SCHEDULE_PUBLIC_READ_UNAUTHORIZED/)
  assert.match(disabledHealth, /SCHEDULE_PUBLIC_READ_UNAVAILABLE/)
  assert.doesNotMatch(smoke, /console\.log\([^\n]*(?:EDGE_HMAC|CORE_HMAC|edgeKey)/)
  assert.match(disabledHealth, /DISABLED_STAGING_SMOKE_MAX_WAIT_MS = 30_000/)
  assert.match(disabledHealth, /response\?\.status !== 404/)
  assert.doesNotMatch(disabledHealth, /SCHEDULE_PUBLIC_READ_SMOKE_RETRY/)
  assert.match(readyHealth, /READY_STAGING_SMOKE_MAX_WAIT_MS = 30_000/)
  assert.match(readyHealth, /response\?\.status === 503/)
  assert.match(readyHealth, /assertDisabledSchedulePublicReadHealth\(response\)/)
})

test('Schedule public-read core staging smoke uses only the core capability and proves disabled rollback', () => {
  assert.match(coreSmoke, /allowedOrigin = 'https:\/\/escala-api-staging\.skincos\.com\.br'/)
  assert.match(coreSmoke, /SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY/)
  assert.match(coreSmoke, /SCHEDULE_PUBLIC_READ_CORE_SERVICE/)
  assert.doesNotMatch(coreSmoke, /SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY/)
  assert.doesNotMatch(coreSmoke, /ESCALA_ACTOR_HMAC_KEY/)
  assert.match(coreSmoke, /SCHEDULE_PUBLIC_READ_UNAVAILABLE/)
  assert.doesNotMatch(coreSmoke, /console\.log\([^\n]*(?:CORE_HMAC|coreKey)/)
})

test('deployment catalog and single-writer policy assign only the isolated adapter Worker', () => {
  const unit = units.units.find((entry) => entry.id === 'schedule-public-read-adapter')
  assert.ok(unit)
  assert.deepEqual(unit.environments, ['preview', 'staging'])
  assert.deepEqual(unit.publishes, ['Worker:skincos-schedule-public-read-staging'])
  assert.deepEqual(unit.migrationPaths, ['workforce/schedule/public-read.wrangler.toml'])
  assert.equal(unit.workflow, '.github/workflows/deploy-schedule-public-read-adapter.yml')

  const group = singleWriter.coordinationGroups.find((entry) => entry.id === 'schedule-public-read-adapter-writer')
  assert.ok(group)
  assert.equal(group.resource, 'deploy:schedule-public-read-adapter:staging')
  const surface = singleWriter.surfaces.find((entry) => entry.id === 'schedule-public-read-adapter')
  assert.ok(surface)
  assert.equal(surface.canonicalDeployWorkflow, '.github/workflows/deploy-schedule-public-read-adapter.yml')
  assert.deepEqual(surface.mutationWorkflows, ['.github/workflows/deploy-schedule-public-read-adapter.yml'])
})
