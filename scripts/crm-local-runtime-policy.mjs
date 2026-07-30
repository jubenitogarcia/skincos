import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const normalizeCommit = (value) => String(value || '').trim().toLowerCase()

export function commitsMatch(left, right) {
  const a = normalizeCommit(left)
  const b = normalizeCommit(right)
  if (!a || !b || a === 'unknown' || b === 'unknown') return false
  return a === b || (a.length >= 12 && b.startsWith(a)) || (b.length >= 12 && a.startsWith(b))
}

const normalizeFingerprint = (value) => String(value || '').trim().toLowerCase()

export function fingerprintsMatch(left, right) {
  const a = normalizeFingerprint(left)
  const b = normalizeFingerprint(right)
  return Boolean(a && b && a === b)
}

export function sourceOriginsMatch(left, right) {
  const normalizeOrigin = (value) => {
    const origin = String(value || '').trim().replace(/\\/g, '/')
    // Windows paths are case-insensitive. Keep module suffixes and non-Windows
    // origins exact so a Site, Meta Ads or Atendimento snapshot never crosses
    // the runtime boundary by accident.
    return /^[a-z]:\//i.test(origin) ? origin.toLowerCase() : origin
  }
  const a = normalizeOrigin(left)
  const b = normalizeOrigin(right)
  return Boolean(a && b && a === b)
}

function exactOptionalMatch(actual, expected) {
  const wanted = String(expected || '').trim()
  if (!wanted) return true
  return String(actual || '').trim() === wanted
}

function canReuseLegacyCanonicalFingerprint(builtFingerprint, expectedFingerprint, targetCommit) {
  // Older canonical runtimes recorded their exact built commit but not a source
  // fingerprint. That is equivalent to the current `commit:<sha>` contract
  // only when the caller requested a clean canonical commit. Snapshots always
  // have a `snapshot:<sha>:<digest>` fingerprint and must never use this path.
  return !normalizeFingerprint(builtFingerprint) &&
    normalizeFingerprint(expectedFingerprint) === `commit:${normalizeCommit(targetCommit)}`
}

export function decideRuntimeAction({
  manifest,
  buildState,
  targetCommit,
  sourceFingerprint,
  sourceOrigin,
  persona,
  runtimeId,
  module,
  configFingerprint,
  buildInputFingerprint,
  lockfileFingerprint,
  artifactFingerprint,
  pidAlive,
  healthy,
}) {
  if (!manifest || typeof manifest !== 'object') return { action: 'start', reason: 'manifest_missing' }
  if (String(manifest.persona || '').toUpperCase() !== String(persona || '').toUpperCase()) {
    return { action: 'restart', reason: 'persona_mismatch' }
  }
  if (!exactOptionalMatch(manifest.runtimeId, runtimeId)) return { action: 'restart', reason: 'runtime_id_mismatch' }
  if (!exactOptionalMatch(manifest.module, module)) return { action: 'restart', reason: 'module_mismatch' }
  if (!exactOptionalMatch(manifest.configFingerprint, configFingerprint)) {
    return { action: 'restart', reason: 'runtime_config_outdated' }
  }
  if (!pidAlive) return { action: 'restart', reason: 'launcher_dead' }

  const state = String(manifest.state || '').toLowerCase()
  const intendedCommit = manifest.targetCommit || manifest.buildCommit || buildState?.commit
  const intendedFingerprint = manifest.sourceFingerprint || buildState?.sourceFingerprint
  const intendedOrigin = manifest.sourceOrigin || buildState?.sourceOrigin
  if (state === 'starting' &&
      commitsMatch(intendedCommit, targetCommit) &&
      (!sourceFingerprint || fingerprintsMatch(intendedFingerprint, sourceFingerprint)) &&
      (!sourceOrigin || sourceOriginsMatch(intendedOrigin, sourceOrigin))) {
    return { action: 'wait', reason: 'current_start_in_progress' }
  }

  const builtCommit = manifest.buildCommit || buildState?.commit
  const builtFingerprint = manifest.sourceFingerprint || buildState?.sourceFingerprint
  const builtOrigin = manifest.sourceOrigin || buildState?.sourceOrigin
  const sourceMatches = fingerprintsMatch(builtFingerprint, sourceFingerprint) ||
    canReuseLegacyCanonicalFingerprint(builtFingerprint, sourceFingerprint, targetCommit)
  const originMatches = sourceOriginsMatch(builtOrigin, sourceOrigin)
  const buildInputMatches = exactOptionalMatch(
    manifest?.build?.inputFingerprint || buildState?.inputFingerprint,
    buildInputFingerprint,
  )
  const lockfileMatches = exactOptionalMatch(
    manifest?.build?.lockfileFingerprint || buildState?.lockfileFingerprint,
    lockfileFingerprint,
  )
  const artifactMatches = exactOptionalMatch(
    manifest?.build?.artifactFingerprint || buildState?.artifactFingerprint,
    artifactFingerprint,
  )
  if (state === 'ready' && commitsMatch(builtCommit, targetCommit) && sourceMatches && originMatches &&
      buildInputMatches && lockfileMatches && artifactMatches && healthy) {
    return { action: 'reuse', reason: 'current_runtime_ready' }
  }

  if (!commitsMatch(builtCommit, targetCommit)) return { action: 'restart', reason: 'commit_outdated' }
  if (!sourceMatches) return { action: 'restart', reason: 'source_outdated' }
  if (!originMatches) return { action: 'restart', reason: 'source_origin_outdated' }
  if (!buildInputMatches) return { action: 'restart', reason: 'build_inputs_outdated' }
  if (!lockfileMatches) return { action: 'restart', reason: 'dependencies_outdated' }
  if (!artifactMatches) return { action: 'restart', reason: 'artifact_outdated' }
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
    sourceFingerprint: args['source-fingerprint'],
    sourceOrigin: args['source-origin'],
    persona: args.persona,
    runtimeId: args['runtime-id'],
    module: args.module,
    configFingerprint: args['config-fingerprint'],
    buildInputFingerprint: args['build-input-fingerprint'],
    lockfileFingerprint: args['lockfile-fingerprint'],
    artifactFingerprint: args['artifact-fingerprint'],
    pidAlive: args['pid-alive'] === 'true',
    healthy: args.healthy === 'true',
  })
  process.stdout.write(`${JSON.stringify(decision)}\n`)
}
