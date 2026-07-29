import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const artifactDir = path.join(repositoryRoot, 'artifacts', 'ui-audit')
const sharedEnvironment = {
  ...process.env,
  E2E_START_SERVER: '1',
  PLAYWRIGHT_KEEP_ARTIFACTS: '1',
  A11Y_ENFORCE: process.env.A11Y_ENFORCE || '0',
}

function run(label, command, args, env = sharedEnvironment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve({ label, status: 'passed' }) : reject(new Error(`${label} exited with ${code}`)))
  })
}

async function main() {
  await mkdir(artifactDir, { recursive: true })
  const startedAt = new Date().toISOString()
  const checks = []
  try {
    checks.push(await run('components', 'npm', ['--prefix', 'crm/console', 'run', 'test:components']))
    checks.push(await run('pilot', 'npm', ['--prefix', 'crm/console', 'run', 'test:e2e', '--', 'e2e/pilot']))
    checks.push(await run('accessibility', 'npm', ['--prefix', 'crm/console', 'run', 'test:e2e', '--', 'e2e/accessibility']))
    checks.push(await run('visual', 'npm', ['--prefix', 'crm/console', 'run', 'test:e2e', '--', 'e2e/visual']))
    checks.push(await run('lighthouse', 'node', ['./scripts/ux-ui/run-lighthouse.mjs'], { ...sharedEnvironment, LIGHTHOUSE_URL: '' }))
  } finally {
    await writeFile(path.join(artifactDir, 'summary.json'), `${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), checks }, null, 2)}\n`)
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
