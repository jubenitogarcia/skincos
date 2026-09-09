import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifySchedulePublicReadCoreOptInEvidence } from './public-read-core-opt-in-evidence.mjs'
import { lifecycleConfigDigest, verifySchedulePublicReadAdapterBootstrapEvidence } from './public-read-bootstrap-evidence.mjs'

export function verifyCanonicalRun(workflow, run, { workflowPath, runId, repository = 'jubenitogarcia/skincos' }) {
  if (workflow?.state !== 'active' || workflow.path !== workflowPath || run?.workflow_id !== workflow.id
    || ![workflowPath, `${workflowPath}@refs/heads/main`].includes(run.path)
    || String(run.id) !== runId || run.status !== 'completed' || run.conclusion !== 'success' || run.run_attempt !== 1
    || run.event !== 'workflow_dispatch' || run.head_branch !== 'main'
    || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository) {
    throw new Error('schedule_production_predecessor_invalid')
  }
}
export function verifyAdapterStagingEvidence(document, { sourceSha, runId }) {
  // The shared promotion gate additionally verifies the immutable release digest.
  // Here bind that artifact to the completed canonical dispatch checked above.
  if (document?.schemaVersion !== 3 || document.unit !== 'schedule-public-read-adapter' || document.target !== 'staging'
    || document.sourceSha !== sourceSha || String(document.runId) !== runId || document.repository !== 'jubenitogarcia/skincos') {
    throw new Error('schedule_production_predecessor_invalid')
  }
}

async function main() {
  const mode = process.argv[2]
  const modes = {
    'core-staging': ['deploy-escala-api.yml', process.env.STAGING_RUN_ID, 'staging'],
    'core-production': ['deploy-escala-api.yml', process.env.CORE_PRODUCTION_RUN_ID, 'production'],
    'adapter-staging': ['deploy-schedule-public-read-adapter.yml', process.env.STAGING_RUN_ID, 'staging'],
    'adapter-bootstrap': ['deploy-schedule-public-read-adapter.yml', process.env.BOOTSTRAP_RUN_ID, 'production'],
  }
  const [workflowName, runId, target] = modes[mode] || []
  const sourceSha = process.env.RELEASE_SHA
  if (!workflowName || !/^[1-9][0-9]*$/.test(runId || '') || !/^[0-9a-f]{40}$/.test(sourceSha || '')
    || process.env.GITHUB_REPOSITORY !== 'jubenitogarcia/skincos' || !process.env.RUNNER_TEMP) throw new Error('schedule_production_predecessor_input_invalid')
  const repository = process.env.GITHUB_REPOSITORY
  const root = join(process.env.RUNNER_TEMP, `schedule-production-${mode}-${runId}`)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  const workflowPath = `.github/workflows/${workflowName}`
  verifyCanonicalRun(JSON.parse(gh(['api', `repos/${repository}/actions/workflows/${workflowName}`])),
    JSON.parse(gh(['api', `repos/${repository}/actions/runs/${runId}`])), { workflowPath, runId })
  const artifact = mode === 'adapter-staging' ? 'promotion-evidence-schedule-public-read-adapter'
    : mode === 'adapter-bootstrap' ? 'schedule-public-read-adapter-bootstrap-evidence' : 'schedule-public-read-core-opt-in-evidence'
  gh(['run', 'download', runId, '--repo', repository, '--name', artifact, '--dir', root])
  const document = JSON.parse(readFileSync(join(root, mode === 'adapter-staging' ? 'promotion-evidence.json' : `${artifact}.json`), 'utf8'))
  if (mode === 'adapter-staging') {
    verifyAdapterStagingEvidence(document, { sourceSha, runId })
  } else if (mode === 'adapter-bootstrap') {
    verifySchedulePublicReadAdapterBootstrapEvidence(document, { sourceSha, workflowRunId: runId, target,
      lifecycleConfigDigest: lifecycleConfigDigest(readFileSync(new URL('../public-read.wrangler.toml', import.meta.url), 'utf8')) })
  } else {
    verifySchedulePublicReadCoreOptInEvidence(document, { sourceSha, workflowRunId: runId, target })
  }
  console.log(JSON.stringify({ ok: true, predecessorVerified: true, target }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main() } catch { console.error('schedule_production_predecessor_failed'); process.exitCode = 1 }
}
