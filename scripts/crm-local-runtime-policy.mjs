import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const normalizeCommit = (value) => String(value || '').trim().toLowerCase()

export function commitsMatch(left, right) {
  const a = normalizeCommit(left)
  const b = normalizeCommit(right)
  if (!a || !b || a === 'unknown' || b === 'unknown') return false
  return a === b || (a.length >= 12 && b.startsWith(a)) || (b.length >= 12 && a.startsWith(b))
}

export function decideRuntimeAction({ manifest, buildState, targetCommit, persona, pidAlive, healthy }) {
  if (!manifest || typeof manifest !== 'object') return { action: 'start', reason: 'manifest_missing' }
  if (String(manifest.persona || '').toUpperCase() !== String(persona || '').toUpperCase()) {
    return { action: 'restart', reason: 'persona_mismatch' }
  }
  if (!pidAlive) return { action: 'restart', reason: 'launcher_dead' }

  const state = String(manifest.state || '').toLowerCase()
  const intendedCommit = manifest.targetCommit || manifest.buildCommit || buildState?.commit
  if (state === 'starting' && commitsMatch(intendedCommit, targetCommit)) {
    return { action: 'wait', reason: 'current_start_in_progress' }
  }

  const builtCommit = manifest.buildCommit || buildState?.commit
  if (state === 'ready' && commitsMatch(builtCommit, targetCommit) && healthy) {
    return { action: 'reuse', reason: 'current_runtime_ready' }
  }

  if (!commitsMatch(builtCommit, targetCommit)) return { action: 'restart', reason: 'commit_outdated' }
  if (state !== 'ready') return { action: 'restart', reason: `state_${state || 'missing'}` }
  return { action: 'restart', reason: 'health_failed' }
}

function readJson(path) {
  if (!path) return null
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '')
    if (key) result[key] = argv[index + 1]
  }
  return result
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = parseArgs(process.argv.slice(2))
  const decision = decideRuntimeAction({
    manifest: readJson(args.manifest),
    buildState: readJson(args['build-state']),
    targetCommit: args.target,
    persona: args.persona,
    pidAlive: args['pid-alive'] === 'true',
    healthy: args.healthy === 'true',
  })
  process.stdout.write(`${JSON.stringify(decision)}\n`)
}
