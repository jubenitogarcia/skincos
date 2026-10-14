import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { acquireGlobalLease, buildLeaseRequest, checkGlobalLease, proofForLease, releaseGlobalLease, renewGlobalLease } from '../../../scripts/codex-global-coordination-client.mjs'
import { dependencyClosureForSource } from '../../../scripts/codex-global-coordinator.mjs'
import { NATIVE_RESOURCES, snapshotNativeData, nativeDigest, nativeConfigDigest, validateNativeManifest } from './public-read-native-manifest.mjs'

const fail = () => { throw new Error('schedule_native_authority_unavailable') }
const sourceRoot = path.resolve(import.meta.dirname, '../../..')
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
}).trim()

export function assertNativeSource(sourceSha, root = sourceRoot) {
  if (process.platform !== 'linux' || !/^[a-f0-9]{40}$/.test(sourceSha ?? '')
    || !['https://github.com/jubenitogarcia/skincos.git', 'https://github.com/jubenitogarcia/skincos', 'git@github.com:jubenitogarcia/skincos.git'].includes(git(root, 'remote', 'get-url', 'origin'))
    || git(root, 'rev-parse', 'HEAD') !== sourceSha || git(root, 'rev-parse', 'refs/remotes/origin/main') !== sourceSha
    || !['main', ''].includes(git(root, 'branch', '--show-current'))
    || git(root, 'status', '--porcelain=v1', '--untracked-files=all')) fail()
  return Object.freeze({ sourceSha, sourceTree: git(root, 'rev-parse', `${sourceSha}^{tree}`) })
}

// Existing canonical custody only. No generation, global-key rotation, env
// fallback, staging endpoint, secret output or new credential store.
export function readNativeCoordinationCustody() {
  const file = '/etc/skincos/global-coordination/native-runtime.env'
  const info = fs.lstatSync(file), parent = fs.lstatSync(path.dirname(file))
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 || info.nlink !== 1
    || (info.mode & 0o777) !== 0o640 || info.size < 1 || info.size > 65536
    || !parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || (parent.mode & 0o777) !== 0o750
    || fs.realpathSync(file) !== file) fail()
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  let bytes
  try {
    const before = fs.fstatSync(fd)
    if (before.ino !== info.ino || before.dev !== info.dev || before.mode !== info.mode) fail()
    bytes = fs.readFileSync(fd)
    const after = fs.fstatSync(fd)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail()
    const values = Object.create(null)
    for (const line of bytes.toString('utf8').trimEnd().split('\n')) {
      const match = /^(SKINCOS_GLOBAL_COORDINATOR_URL|SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY|SKINCOS_GLOBAL_COORDINATION_KEY_ID|SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET)=([^\r\n\0]+)$/.exec(line)
      if (!match || Object.hasOwn(values, match[1])) fail()
      values[match[1]] = match[2]
    }
    const active = Object.hasOwn(values, 'SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY')
    if (values.SKINCOS_GLOBAL_COORDINATOR_URL !== NATIVE_RESOURCES.coordinatorOrigin
      || Object.keys(values).length !== (active ? 3 : 2)
      || active && (Object.hasOwn(values, 'SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET')
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(values.SKINCOS_GLOBAL_COORDINATION_KEY_ID ?? '')
        || values.SKINCOS_GLOBAL_COORDINATION_KEY_ID === 'legacy-v1')
      || !active && Object.hasOwn(values, 'SKINCOS_GLOBAL_COORDINATION_KEY_ID')) fail()
    const secret = active ? values.SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY : values.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET
    if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 4096) fail()
    return Object.freeze({ url: NATIVE_RESOURCES.coordinatorOrigin, secret, keyId: active ? values.SKINCOS_GLOBAL_COORDINATION_KEY_ID : 'legacy-v1' })
  } finally { bytes?.fill(0); fs.closeSync(fd) }
}

export function nativeResource(operation) {
  if (['core-enable', 'core-disable'].includes(operation)) return Object.freeze({ resource: 'global:escala-writer', module: 'escala-api' })
  if (['adapter-bootstrap-disabled', 'adapter-enable', 'adapter-disable', 'reconcile-probe'].includes(operation)) return Object.freeze({ resource: 'deploy:schedule-public-read-adapter:production', module: 'schedule-public-read-adapter' })
  fail()
}

const authorities = new WeakMap()
export function assertNativeAuthority(authority) { if (!authorities.has(authority)) fail(); return authorities.get(authority) }

export async function createNativeAuthority({ manifest, operation, owner, artifacts, root = sourceRoot }) {
  manifest = snapshotNativeData(manifest)
  const manifestRaw = JSON.stringify(manifest)
  validateNativeManifest(manifestRaw, { sourceSha: manifest.sourceSha, sourceTree: manifest.sourceTree,
    configDigest: nativeConfigDigest(root), expectedDigest: nativeDigest(manifestRaw), recovery: operation === 'reconcile-probe' })
  const artifactIdentity = snapshotNativeData(artifacts)
  if (!Array.isArray(artifactIdentity) || artifactIdentity.length !== 2
    || artifactIdentity.some((item, index) => item.name !== ['schedule-native-manifest', 'schedule-native-preflight'][index]
      || item.id !== manifest.releaseId || !/^[a-f0-9]{64}$/.test(item.digest ?? '') || Object.keys(item).length !== 3)) fail()
  const identity = snapshotNativeData(owner)
  if (!['codex', 'mini-pc'].includes(identity.provider) || Object.keys(identity).length !== 4
    || ['missionId', 'threadId', 'actor'].some(name => typeof identity[name] !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(identity[name]))) fail()
  assertNativeSource(manifest.sourceSha, root)
  const selected = nativeResource(operation)
  const closure = dependencyClosureForSource({ module: selected.module, sourceCommit: manifest.sourceSha, root })
  if (closure.sourceTree !== manifest.sourceTree) fail()
  const custody = readNativeCoordinationCustody()
  const request = buildLeaseRequest({ operation: 'promotion', resource: selected.resource, owner: identity,
    intent: { module: selected.module, workflow: 'schedule-native-production', event: 'native-release',
      sourceCommit: manifest.sourceSha, sourceTree: manifest.sourceTree, dependencyClosureDigest: closure.digest,
      dependencyClosurePaths: closure.dependencyClosurePaths || closure.inputs.map(item => item.path),
      dependencyClosurePatterns: [...new Set([...(closure.dependencyClosurePatterns || []), ...(closure.dependencyClosureSharedInputPaths || [])])].sort(),
      dependencyClosureSharedInputs: closure.dependencyClosureSharedInputs === true,
      releaseIdentity: { module: selected.module, sourceCommit: manifest.sourceSha, sourceTree: manifest.sourceTree,
        dependencyClosureDigest: closure.digest, artifacts: artifactIdentity },
      nativeReleaseId: manifest.releaseId, configDigest: manifest.configDigest },
    idempotencyKey: `schedule-native:${manifest.releaseId}:${operation}`, ttlMs: 900000 })
  const acquired = await acquireGlobalLease({ request, ...custody })
  if (acquired.passed !== true || !acquired.lease) fail()
  let proof = proofForLease(acquired.lease), lastRenew = Date.now(), released = false
  const check = async () => {
    if (released) fail()
    assertNativeSource(manifest.sourceSha, root)
    const observed = dependencyClosureForSource({ module: selected.module, sourceCommit: manifest.sourceSha, root })
    if (observed.digest !== closure.digest) fail()
    if (Date.now() - lastRenew >= 60000) {
      const renewed = await renewGlobalLease({ proof, ttlMs: 900000, ...custody })
      if (renewed.passed !== true || !renewed.lease) fail()
      proof = proofForLease(renewed.lease); lastRenew = Date.now()
    }
    const result = await checkGlobalLease({ proof, ...custody, authorization: {
      expectedResource: selected.resource, expectedIntentDigest: proof.intentDigest,
      observedDependencyClosureDigest: observed.digest, expectedArtifacts: artifactIdentity } })
    if (result.passed !== true) fail()
    return Object.freeze({ resource: selected.resource, module: selected.module, dependencyClosureDigest: observed.digest,
      leaseId: proof.leaseId, fencingToken: proof.fencingToken, authorityEpoch: proof.authorityEpoch ?? null })
  }
  const authority = Object.freeze({ check,
    async release() { if (released) fail(); const result = await releaseGlobalLease({ proof, ...custody }); if (result.passed !== true) fail(); released = true },
  })
  authorities.set(authority, Object.freeze({ operation, ...selected, manifest }))
  return authority
}
