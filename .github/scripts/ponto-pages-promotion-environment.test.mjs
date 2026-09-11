import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const workflowDirectory = path.join(repositoryRoot, '.github/workflows')
const readWorkflow = (name) => fs.readFileSync(path.join(workflowDirectory, name), 'utf8')
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(repositoryRoot, name), 'utf8'))
const workflowStep = (workflow, name) => {
  const normalized = workflow.replaceAll('\r\n', '\n')
  const marker = '      - name: ' + name + '\n'
  const start = normalized.indexOf(marker)
  const end = normalized.indexOf('\n      - ', start + marker.length)
  return start < 0 ? '' : normalized.slice(start, end < 0 ? normalized.length : end)
}
const runPontoStagingHarness = ({ pagesSurface, origin }) => spawnSync(
  process.execPath,
  [path.join(repositoryRoot, 'crm/console/scripts/ponto-staging-journey.cjs')],
  {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(pagesSurface ? { PONTO_STAGING_PAGES_SURFACE: pagesSurface } : {}),
      PONTO_STAGING_CRM_URL: origin,
      PONTO_STAGING_EXPECTED_RELEASE_SHA: 'a'.repeat(40),
      PONTO_STAGING_EXPECTED_TIMEKEEPING_VERSION_ID: '11111111-1111-4111-8111-111111111111',
      PONTO_STAGING_FIXTURES_FILE: path.join(repositoryRoot, '.git/ponto-staging-harness-fixture-missing.json'),
      PONTO_STAGING_REPORT_FILE: path.join(repositoryRoot, '.git/ponto-staging-harness-report-missing.json'),
    },
  },
)

test('only Ponto Pages overrides the reusable promotion environment', () => {
  const promotionGate = readWorkflow('promotion-gate.yml')
  assert.match(promotionGate, /promotion_environment: \{ required: false, type: string, default: "" \}/)
  assert.match(promotionGate, /environment: \$\{\{ inputs\.promotion_environment \|\| inputs\.target \}\}/)

  const consumers = fs.readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .filter((name) => readWorkflow(name).includes('uses: ./.github/workflows/promotion-gate.yml'))
  const overrides = consumers.filter((name) => /^\s+promotion_environment:/m.test(readWorkflow(name)))

  assert.deepEqual(overrides.sort(), [
    'ponto-pages-candidate-preflight.yml',
    'ponto-pages-governed-publisher.yml',
  ])
  for (const consumer of consumers.filter((name) => !overrides.includes(name))) {
    assert.doesNotMatch(readWorkflow(consumer), /^\s+promotion_environment:/m, `${consumer} must keep the default target environment`)
  }
})

test('Ponto Pages selects the two protected dedicated environments literally', () => {
  const candidate = readWorkflow('ponto-pages-candidate-preflight.yml')
  const publisher = readWorkflow('ponto-pages-governed-publisher.yml')

  assert.match(candidate, /promotion_environment: ponto-pages-staging/)
  assert.match(publisher, /promotion_environment: \$\{\{ inputs\.target == 'staging' && 'ponto-pages-staging' \|\| 'ponto-pages-production' \}\}/)
  assert.match(publisher, /name: \$\{\{ inputs\.target == 'staging' && 'ponto-pages-staging' \|\| 'ponto-pages-production' \}\}/)
  assert.doesNotMatch(candidate, /promotion_environment: (?:preview|staging|production)$/m)
})

test('Ponto Pages declares a dedicated release closure that contains its governed inputs', () => {
  const catalog = readJson('platform/deploy/operational-units.json')
  const unit = catalog.units.find((entry) => entry.id === 'ponto-pages')
  const policy = readJson('ops/governance/global-concurrency-policy.json')

  assert.equal(unit?.releaseClosure, 'ponto-pages')
  assert.deepEqual(policy.releaseClosures[unit.releaseClosure].patterns, [
    'workforce/ponto-pages/**',
    'platform/deploy/operational-units.json',
    '.github/governance/cloudflare-single-writer-policy.json',
    '.github/workflows/ponto-pages-candidate-preflight.yml',
    '.github/workflows/ponto-pages-governed-publisher.yml',
    '.github/workflows/ponto-pages-staging-synthetic-smoke.yml',
    '.github/workflows/ponto-pages-secret-bridge.yml',
    '.github/workflows/cloudflare-workers-sync-ponto-secrets.yml',
    '.github/actions/global-coordination-acquire/**',
    '.github/actions/global-coordination-check/**',
    '.github/actions/global-coordination-release/**',
    '.github/scripts/ponto-pages-secret-bridge.mjs',
    '.github/scripts/ponto-cloudflare-resource-identity.mjs',
    '.github/scripts/ponto-environment-protection.mjs',
    '.github/scripts/ponto-orchestrator-lease.mjs',
    '.github/scripts/ponto-release-evidence.mjs',
    '.github/scripts/ponto-source-closure.mjs',
    '.github/scripts/ponto-root-custody.mjs',
    '.github/workflows/ponto-orchestrator-gate.yml',
    'crm/console/scripts/ponto-staging-journey.cjs',
    'inventory/wrangler.toml',
    'workforce/timekeeping/scripts/ponto-staging-journey-fixtures.mjs',
    'workforce/timekeeping/security.js',
    'workforce/timekeeping/wrangler.toml',
    '.github/scripts/ponto-json-output.mjs',
    '.github/scripts/promotion-*.mjs',
  ])
  assert.equal(policy.releaseClosures[unit.releaseClosure].sharedInputs, true)
  assert.ok(policy.releaseClosures.ponto.patterns.includes('workforce/ponto-pages/scripts/verify-ponto-core-staging-candidate.mjs'))
  assert.ok(policy.releaseClosures.ponto.patterns.includes('workforce/ponto-pages/scripts/verify-ponto-pages-staging-smoke.mjs'))
  assert.ok(policy.releaseClosures.ponto.patterns.includes('workforce/ponto-pages/scripts/verify-ponto-pages-same-artifact-rollback.mjs'))
  assert.ok(policy.releaseClosures.ponto.patterns.includes('workforce/ponto-pages/scripts/verify-ponto-pages-remote-project.mjs'))
})

test('Ponto Pages staging guard accepts only five-group UUID version IDs', () => {
  const publisher = readWorkflow('ponto-pages-governed-publisher.yml')
  const uuidGuard = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  const uuid = new RegExp(uuidGuard, 'i')

  assert.ok(publisher.includes(`[[ "$CORE_VERSION_ID" =~ ${uuidGuard} ]]`))
  assert.ok(publisher.includes(`[[ "$IDENTITY_VERSION_ID" =~ ${uuidGuard} ]]`))
  assert.match('11111111-1111-4111-8111-111111111111', uuid)
  assert.doesNotMatch('11111111-1111-4111-111111111111', uuid)
})

test('Ponto Pages accepts only dedicated secret custody, account-scoped mutations, and stdin curl headers', () => {
  const publisher = readWorkflow('ponto-pages-governed-publisher.yml')

  assert.match(publisher, /secrets\.PONTO_PAGES_CLOUDFLARE_ACCOUNT_ID/)
  assert.match(publisher, /secrets\.PONTO_PAGES_CLOUDFLARE_API_TOKEN/)
  assert.doesNotMatch(publisher, /secrets\.CLOUDFLARE_(?:ACCOUNT_ID|API_TOKEN)/)
  const runtimeSecretSources = {
    PONTO_API_TARGET: 'PONTO_PAGES_PONTO_API_TARGET',
    AUTH_API_TARGET: 'PONTO_PAGES_AUTH_API_TARGET',
    INSUMOS_API_TARGET: 'PONTO_PAGES_INSUMOS_API_TARGET',
    PONTO_ACTOR_HMAC_KEY: 'PONTO_PAGES_ACTOR_HMAC_KEY',
    PONTO_NETWORK_CONTEXT_KEY: 'PONTO_PAGES_NETWORK_CONTEXT_KEY',
    PONTO_RELEASE_PROBE_HMAC_KEY: 'PONTO_PAGES_RELEASE_PROBE_HMAC_KEY',
  }
  for (const [runtimeName, sourceName] of Object.entries(runtimeSecretSources)) {
    assert.match(publisher, new RegExp('secrets\\.' + sourceName))
    assert.match(publisher, new RegExp(runtimeName + ': process\\.env\\.' + sourceName))
  }
  assert.match(publisher, /secrets\.PONTO_PAGES_GLOBAL_COORDINATION_SHARED_SECRET/)
  for (const genericName of [
    'PONTO_API_TARGET',
    'AUTH_API_TARGET',
    'INSUMOS_API_TARGET',
    'PONTO_ACTOR_HMAC_KEY',
    'PONTO_NETWORK_CONTEXT_KEY',
    'PONTO_RELEASE_PROBE_HMAC_KEY',
    'SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET',
  ]) {
    assert.doesNotMatch(publisher, new RegExp('secrets\\.' + genericName), 'generic secret expression must be rejected: ' + genericName)
  }
  for (const mutationStep of [
    workflowStep(publisher, 'Configure Ponto-only Pages secrets without printing values'),
    workflowStep(publisher, 'Deploy only the exact dedicated Ponto Pages project'),
  ]) {
    assert.match(mutationStep, /CLOUDFLARE_API_TOKEN="\$PONTO_PAGES_CLOUDFLARE_API_TOKEN"/)
    assert.match(mutationStep, /CLOUDFLARE_ACCOUNT_ID="\$PONTO_PAGES_CLOUDFLARE_ACCOUNT_ID"/)
  }
  assert.match(publisher, /PONTO_PAGES_STAGING_SAME_ARTIFACT_ROLLBACK_RECEIPT_REQUIRED/)
  assert.match(publisher, /actions\/workflows\/ponto-core-staging-candidate\.yml/)
  assert.match(publisher, /Number\(run\?\.run_attempt\) !== 1/)
  assert.match(publisher, /run\?\.head_repository\?\.full_name !== process\.env\.GITHUB_REPOSITORY/)
  assert.match(publisher, /Number\(run\?\.repository\?\.id\) !== Number\(process\.env\.EXPECTED_REPOSITORY_ID\)/)
  assert.match(publisher, /Number\(run\?\.head_repository\?\.id\) !== Number\(process\.env\.EXPECTED_REPOSITORY_ID\)/)
  assert.equal((publisher.match(/curl --disable --fail --silent --show-error/g) || []).length, 4)
  assert.equal((publisher.match(/--header @-/g) || []).length, 4)
  assert.doesNotMatch(publisher, /-H\s+"Authorization: Bearer \$PONTO_PAGES_CLOUDFLARE_API_TOKEN"/)
})

test('Ponto Pages staging smoke is an executable dedicated-only synthetic producer', () => {
  const smoke = readWorkflow('ponto-pages-staging-synthetic-smoke.yml')

  assert.match(smoke, /^name: Ponto Pages staging synthetic smoke$/m)
  assert.match(smoke, /^\s+workflow_dispatch:$/m)
  assert.doesNotMatch(smoke, /^\s+(?:push|pull_request|schedule):$/m)
  assert.match(smoke, /pages_surface:[\s\S]*?default: legacy[\s\S]*?options: \[legacy, dedicated-ponto-pages\]/)
  assert.match(smoke, /execute:[\s\S]*?default: false[\s\S]*?type: boolean/)
  assert.match(smoke, /PONTO_PAGES_STAGING_SMOKE_EXECUTION_NOT_AUTHORIZED/)
  assert.match(smoke, /PONTO_PAGES_STAGING_SMOKE_SURFACE_NOT_DEDICATED/)
  assert.match(smoke, /PONTO_PAGES_STAGING_SMOKE_PUBLISH_DISABLED/)
  assert.match(smoke, /PONTO_PAGES_PROJECT" == 'skincos-ponto-staging'/)
  assert.match(smoke, /PONTO_STAGING_CRM_URL: https:\/\/skincos-ponto-staging\.pages\.dev\//)
  assert.match(smoke, /PONTO_STAGING_PAGES_SURFACE: dedicated-ponto-pages/)
  assert.match(smoke, /PONTO_STAGING_EXPECTED_TIMEKEEPING_VERSION_ID/)
  assert.match(smoke, /ponto-pages-publish-receipt-staging-\$RELEASE_SHA/)
  assert.match(smoke, /verify-ponto-core-staging-candidate\.mjs/)
  assert.match(smoke, /verify-ponto-pages-remote-project\.mjs/)
  assert.match(smoke, /global:staging-d1/)
  assert.match(smoke, /global-coordination-acquire/)
  assert.match(smoke, /global-coordination-check/)
  assert.match(smoke, /if: \$\{\{ always\(\) && steps\.generate_fixture\.outcome == 'success' \}\}/)
  assert.match(smoke, /ponto-pages-staging-synthetic-smoke-\$\{\{ needs\.preflight\.outputs\.source_sha \}\}-skincos-ponto-staging/)
  assert.match(smoke, /contractId: 'skincos\/ponto-pages-staging-synthetic-smoke\/v1'/)
  assert.match(smoke, /checks: \['login', 'csrf', 'ponto-read', 'ponto-write', 'terminal', 'synthetic-cleanup'\]/)
  assert.match(smoke, /Tear down only this run's synthetic staging records/)
  assert.doesNotMatch(smoke, /secrets\.CLOUDFLARE_(?:ACCOUNT_ID|API_TOKEN)/)
  assert.doesNotMatch(smoke, /\bpages\s+(?:deploy|secret)\b/i)
  assert.doesNotMatch(smoke, /ponto-pages-production/)
  assert.doesNotMatch(smoke, /https:\/\/api\.skincos\.com\.br/)
})

test('canonical journey accepts only the exact dedicated Pages origin when selected', () => {
  const dedicated = runPontoStagingHarness({
    pagesSurface: 'dedicated-ponto-pages',
    origin: 'https://skincos-ponto-staging.pages.dev/',
  })
  assert.notEqual(dedicated.status, 0)
  assert.match(dedicated.stderr, /ponto-staging-harness-fixture-missing\.json/)

  const legacy = runPontoStagingHarness({
    origin: 'https://skincos-ponto-staging.pages.dev/',
  })
  assert.notEqual(legacy.status, 0)
  assert.match(legacy.stderr, /skincos-staging\.pages\.dev HTTPS origin/)

  const nonCanonicalDedicated = runPontoStagingHarness({
    pagesSurface: 'dedicated-ponto-pages',
    origin: 'https://not-skincos-ponto-staging.pages.dev/',
  })
  assert.notEqual(nonCanonicalDedicated.status, 0)
  assert.match(nonCanonicalDedicated.stderr, /exact dedicated Ponto Pages staging origin/)
})
