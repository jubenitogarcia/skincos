#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_CONTRACT = 'skincos/crm-core-codex-staging-readback-receipt-custody/v1'
export const CRM_CORE_CODEX_STAGING_READBACK_RECEIPT_CONTRACT = 'skincos-crm/codex-staging-readback-receipt/v2'
export const CRM_CORE_CODEX_STAGING_READBACK_AUDIT_CONTRACT = 'skincos-crm/codex-staging-readback-private-audit/v1'

const coreRepository = 'jubenitogarcia/skincos-crm-core'
const coreRepositoryId = '1353934107'
const coreMainRef = 'refs/heads/main'
const coreOrigin = 'https://github.com/jubenitogarcia/skincos-crm-core.git'
const coreVerifierRelativePath = 'scripts/verify-codex-staging-readback-receipt.mjs'
const custodyContract = 'skincos-crm/codex-local-artifact-custody/v2'
const readbackOutputContract = 'skincos-crm/codex-staging-readback-output/v1'
const receiptSignatureContract = 'skincos-crm/codex-staging-readback-receipt-signature/v2'
const stagingOrigin = 'https://skincos-crm-core-staging.skincos.workers.dev'
const auditSigner = 'codex-local-custody'
const pagesEvidence = 'external-console-readback'
const maxExternalFileBytes = 64 * 1024
const maxExternalArtifactBundleBytes = 64 * 1024 * 1024
const maxExternalArtifactBundleFiles = 4096
const maxExternalArtifactBundleDepth = 48
const custodyBundleTopLevelEntries = Object.freeze([
  'console', 'execution-receipt.json', 'recheck', 'release-artifact.json', 'source-attestation.json', 'worker',
])
const custodyBundleRecheckEntries = Object.freeze(['console', 'worker'])
const custodyBundleDirectoryEntries = new Set(['console', 'recheck', 'worker'])
const shaPattern = /^[0-9a-f]{40}$/
const digestPattern = /^sha256:[0-9a-f]{64}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const platformIdPattern = /^[A-Za-z0-9._:-]{1,160}$/
const keyIdPattern = /^crm-core-staging-readback-[A-Za-z0-9._-]{1,120}$/
const base64urlSignaturePattern = /^[A-Za-z0-9_-]{86}$/
const base64urlEd25519XPattern = /^[A-Za-z0-9_-]{43}$/
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const forbiddenKeys = new Set([
  'authorization', 'cookie', 'credential', 'email', 'jws', 'mobile', 'password',
  'privatekey', 'private_key', 'rawbody', 'raw_body', 'secret', 'session', 'token',
])
const expectedChecks = Object.freeze([
  'artifact-identity',
  'health',
  'readiness',
  'public-health',
  'public-readiness',
  'modules-read-only',
  'projection-route-auth-required',
  'internal-route-rejected',
  'inventory-fallback-rejected',
  'unknown-route-rejected',
  'write-surface-blocked',
  'cors-origin-rejected',
  'backfill-ingestion-disabled',
  'session-requires-verified-identity',
])
const receiptBasename = 'codex-staging-readback-receipt.json'
const custodyReceiptBasename = 'execution-receipt.json'
const readbackOutputBasename = 'readback-output.json'
const auditBasename = 'private-readback-audit.json'
const validatedPolicy = Symbol('validated-crm-core-codex-staging-readback-custody-policy')

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..', '..')
export const DEFAULT_POLICY_FILE = path.resolve(scriptDirectory, '..', 'governance', 'crm-core-codex-staging-readback-receipt-custody.json')

function fail(code) {
  throw new Error(`CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_${code}`)
}

function plainRecord(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code)
  return value
}

function exactKeys(value, expected, code) {
  const actual = Object.keys(plainRecord(value, code)).sort()
  const normalizedExpected = [...expected].sort()
  if (actual.length !== normalizedExpected.length || actual.some((key, index) => key !== normalizedExpected[index])) fail(code)
  return value
}

function optionalKeys(value, allowed, required, code) {
  const actual = Object.keys(plainRecord(value, code))
  if (actual.some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) fail(code)
  return value
}

function normalized(value, pattern, code, { lowerCase = false } = {}) {
  const text = String(value || '').trim()
  const result = lowerCase ? text.toLowerCase() : text
  if (!pattern.test(result)) fail(code)
  return result
}

function normalizedSha(value, code) {
  return normalized(value, shaPattern, code, { lowerCase: true })
}

function normalizedDigest(value, code) {
  return normalized(value, digestPattern, code, { lowerCase: true })
}

function normalizedUuid(value, code) {
  return normalized(value, uuidPattern, code, { lowerCase: true })
}

function normalizedPlatformId(value, code) {
  return normalized(value, platformIdPattern, code)
}

function normalizedKeyId(value, code) {
  return normalized(value, keyIdPattern, code)
}

function normalizedUtcTimestamp(value, code) {
  const text = String(value || '').trim()
  if (!utcTimestampPattern.test(text)) fail(code)
  const instant = new Date(text)
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== text) fail(code)
  return text
}

function canonicalValue(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail('CANONICAL_VALUE_INVALID')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`
  const record = plainRecord(value, 'CANONICAL_VALUE_INVALID')
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`).join(',')}}`
}

export function canonicalCrmCoreCodexStagingReadbackJson(value) {
  return canonicalValue(value)
}

export function canonicalCrmCoreCodexStagingReadbackDigest(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalCrmCoreCodexStagingReadbackJson(value), 'utf8').digest('hex')}`
}

function assertNoSensitiveKeys(value, label = 'value') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveKeys(entry, `${label}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenKeys.has(key.toLowerCase())) fail(`SENSITIVE_KEY:${label}.${key}`)
    assertNoSensitiveKeys(entry, `${label}.${key}`)
  }
}

function exactStrings(value, expected, code) {
  if (!Array.isArray(value) || value.length !== expected.length
    || value.some((entry, index) => entry !== expected[index])) fail(code)
  return Object.freeze([...value])
}

function pathForComparison(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function samePath(left, right) {
  return pathForComparison(left) === pathForComparison(right)
}

function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function gitWorktreeRoot(filename) {
  const target = path.resolve(filename)
  let workingDirectory = path.dirname(target)
  try {
    if (fs.lstatSync(target).isDirectory()) workingDirectory = target
  } catch {
    // A non-existent path is checked from its existing parent directory.
  }
  try {
    const root = execFileSync('git', ['-C', workingDirectory, 'rev-parse', '--show-toplevel'], {
      cwd: os.tmpdir(),
      env: isolatedGitEnvironment(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    return root ? path.resolve(root) : null
  } catch {
    return null
  }
}

function isInsideGitWorktree(filename) {
  const root = gitWorktreeRoot(filename)
  return Boolean(root && isWithin(root, filename))
}

function readJsonFile(filename, code, { maxBytes = maxExternalFileBytes } = {}) {
  let contents
  try {
    contents = fs.readFileSync(path.resolve(filename))
  } catch {
    fail(code)
  }
  if (contents.length < 2 || contents.length > maxBytes) fail(code)
  try {
    return JSON.parse(contents.toString('utf8'))
  } catch {
    fail(code)
  }
}

function readExternalJson(filename, basename, code) {
  const requested = path.resolve(filename)
  if (path.basename(requested) !== basename || isWithin(repositoryRoot, requested) || isInsideGitWorktree(requested)) {
    fail(`${code}_PATH_INVALID`)
  }
  let stat
  let absolute
  let contents
  try {
    stat = fs.lstatSync(requested)
    absolute = fs.realpathSync.native ? fs.realpathSync.native(requested) : fs.realpathSync(requested)
    contents = fs.readFileSync(absolute)
  } catch {
    fail(code)
  }
  if (stat.isSymbolicLink() || !stat.isFile() || !samePath(requested, absolute)
    || isWithin(repositoryRoot, absolute) || isInsideGitWorktree(absolute)) {
    fail(`${code}_PATH_INVALID`)
  }
  if (contents.length < 2 || contents.length > maxExternalFileBytes) fail(code)
  try {
    return Object.freeze({ requested, absolute, contents, value: JSON.parse(contents.toString('utf8')) })
  } catch {
    fail(code)
  }
}

function readExternalDirectory(filename, code) {
  const requested = path.resolve(filename)
  if (isWithin(repositoryRoot, requested) || isInsideGitWorktree(requested)) fail(`${code}_PATH_INVALID`)
  let stat
  let absolute
  try {
    stat = fs.lstatSync(requested)
    absolute = fs.realpathSync.native ? fs.realpathSync.native(requested) : fs.realpathSync(requested)
  } catch {
    fail(code)
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || !samePath(requested, absolute)
    || isWithin(repositoryRoot, absolute) || isInsideGitWorktree(absolute)) {
    fail(`${code}_PATH_INVALID`)
  }
  return Object.freeze({ requested, absolute })
}

function exactEntryNames(entries, expected, code) {
  const actual = entries.map((entry) => entry.name).sort()
  const normalizedExpected = [...expected].sort()
  if (actual.length !== normalizedExpected.length || actual.some((name, index) => name !== normalizedExpected[index])) fail(code)
}

function bundleRelativePath(parent, name) {
  return parent ? `${parent}/${name}` : name
}

function bundleEntryPath(root, relative) {
  const resolved = path.resolve(root, ...relative.split('/'))
  if (!isWithin(root, resolved)) fail('EXTERNAL_SNAPSHOT_PATH_INVALID')
  return resolved
}

function readExternalCustodyArtifactBundle(custodyReceipt, code) {
  const directory = readExternalDirectory(path.dirname(custodyReceipt.absolute), code)
  const expectedReceiptPath = path.join(directory.absolute, custodyReceiptBasename)
  if (!samePath(expectedReceiptPath, custodyReceipt.absolute)) fail(`${code}_LAYOUT_INVALID`)
  const entries = []
  let totalBytes = 0
  let totalFiles = 0

  function visit(current, relative = '', depth = 0) {
    if (depth > maxExternalArtifactBundleDepth) fail(`${code}_LAYOUT_INVALID`)
    let children
    try {
      children = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      fail(code)
    }
    if (!relative) exactEntryNames(children, custodyBundleTopLevelEntries, `${code}_LAYOUT_INVALID`)
    if (relative === 'recheck') exactEntryNames(children, custodyBundleRecheckEntries, `${code}_LAYOUT_INVALID`)
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = bundleRelativePath(relative, child.name)
      const requested = path.join(current, child.name)
      let stat
      let absolute
      try {
        stat = fs.lstatSync(requested)
        absolute = fs.realpathSync.native ? fs.realpathSync.native(requested) : fs.realpathSync(requested)
      } catch {
        fail(code)
      }
      if (child.name === '.git' || stat.isSymbolicLink() || !samePath(requested, absolute)
        || !isWithin(directory.absolute, absolute) || isWithin(repositoryRoot, absolute) || isInsideGitWorktree(absolute)) {
        fail(`${code}_PATH_INVALID`)
      }
      const shouldBeDirectory = (!relative && custodyBundleDirectoryEntries.has(child.name))
        || (relative === 'recheck' && custodyBundleRecheckEntries.includes(child.name))
      if (shouldBeDirectory && !stat.isDirectory()) fail(`${code}_LAYOUT_INVALID`)
      if (stat.isDirectory()) {
        entries.push(Object.freeze({ kind: 'directory', relative: childRelative }))
        visit(absolute, childRelative, depth + 1)
        continue
      }
      if (!stat.isFile()) fail(`${code}_LAYOUT_INVALID`)
      let contents
      try {
        contents = fs.readFileSync(absolute)
      } catch {
        fail(code)
      }
      totalFiles += 1
      totalBytes += contents.length
      if (totalFiles > maxExternalArtifactBundleFiles || totalBytes > maxExternalArtifactBundleBytes) fail(`${code}_TOO_LARGE`)
      entries.push(Object.freeze({ kind: 'file', relative: childRelative, contents: Buffer.from(contents) }))
    }
  }

  visit(directory.absolute)
  const receipt = entries.find((entry) => entry.kind === 'file' && entry.relative === custodyReceiptBasename)
  if (!receipt || !receipt.contents.equals(custodyReceipt.contents)) fail(`${code}_CHANGED`)
  return Object.freeze({ directory, entries: Object.freeze(entries), receipt: Object.freeze({ ...custodyReceipt }) })
}

function sameCustodyBundle(left, right, { requireSameDirectory = false } = {}) {
  return (!requireSameDirectory || samePath(left.directory.absolute, right.directory.absolute))
    && left.entries.length === right.entries.length
    && left.entries.every((entry, index) => entry.kind === right.entries[index].kind
      && entry.relative === right.entries[index].relative
      && (entry.kind !== 'file' || entry.contents.equals(right.entries[index].contents)))
}

function assertExternalCustodyBundleUnchanged(bundle, code) {
  const currentReceipt = readExternalJson(bundle.receipt.requested, custodyReceiptBasename, code)
  const current = readExternalCustodyArtifactBundle(currentReceipt, code)
  if (!sameCustodyBundle(bundle, current, { requireSameDirectory: true })) fail(`${code}_CHANGED`)
}

function publicKeyEntry(value, code) {
  exactKeys(value, ['jwk', 'spkiFingerprint'], code)
  const jwk = exactKeys(value.jwk, ['crv', 'kty', 'x'], code)
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string' || !base64urlEd25519XPattern.test(jwk.x)) fail(code)
  let verifier
  try {
    verifier = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' })
  } catch {
    fail(code)
  }
  if (verifier.asymmetricKeyType !== 'ed25519') fail(code)
  const spkiFingerprint = `sha256:${crypto.createHash('sha256').update(verifier.export({ type: 'spki', format: 'der' })).digest('hex')}`
  if (spkiFingerprint !== normalizedDigest(value.spkiFingerprint, code)) fail(code)
  return Object.freeze({
    jwk: Object.freeze({ kty: 'OKP', crv: 'Ed25519', x: jwk.x }),
    verifier,
    spkiFingerprint,
  })
}

function assertAuthority(value, expected, code) {
  const keys = ['backfillAuthorized', 'deploymentAuthorized', 'domainChangeAuthorized', 'legacyRetirementAuthorized', 'productionAuthorized']
  exactKeys(value, keys, code)
  if (keys.some((key) => value[key] !== expected[key])) fail(code)
  return Object.freeze({
    deploymentAuthorized: false,
    productionAuthorized: false,
    domainChangeAuthorized: false,
    backfillAuthorized: false,
    legacyRetirementAuthorized: false,
  })
}

function assertPolicySource(value) {
  exactKeys(value, ['ref', 'repository', 'repositoryId'], 'POLICY_SOURCE_INVALID')
  if (value.repository !== coreRepository || value.repositoryId !== coreRepositoryId || value.ref !== coreMainRef) fail('POLICY_SOURCE_INVALID')
  return Object.freeze({ repository: coreRepository, repositoryId: coreRepositoryId, ref: coreMainRef })
}

function assertPolicyCore(value) {
  exactKeys(value, ['origin', 'verifier'], 'POLICY_CORE_INVALID')
  if (value.origin !== coreOrigin || value.verifier !== coreVerifierRelativePath) fail('POLICY_CORE_INVALID')
  return Object.freeze({ origin: coreOrigin, verifier: coreVerifierRelativePath })
}

function assertPolicyReceipt(value) {
  exactKeys(value, [
    'checks', 'contract', 'custodyContract', 'environment', 'origin', 'pagesEvidence',
    'readbackOutputContract', 'signatureContract', 'state',
  ], 'POLICY_RECEIPT_INVALID')
  if (value.contract !== CRM_CORE_CODEX_STAGING_READBACK_RECEIPT_CONTRACT
    || value.custodyContract !== custodyContract
    || value.readbackOutputContract !== readbackOutputContract
    || value.signatureContract !== receiptSignatureContract
    || value.state !== 'verified-external-readback'
    || value.environment !== 'staging'
    || value.origin !== stagingOrigin
    || value.pagesEvidence !== pagesEvidence) fail('POLICY_RECEIPT_INVALID')
  return Object.freeze({
    contract: CRM_CORE_CODEX_STAGING_READBACK_RECEIPT_CONTRACT,
    custodyContract,
    readbackOutputContract,
    signatureContract: receiptSignatureContract,
    state: 'verified-external-readback',
    environment: 'staging',
    origin: stagingOrigin,
    pagesEvidence,
    checks: exactStrings(value.checks, expectedChecks, 'POLICY_RECEIPT_INVALID'),
  })
}

function assertPolicyAudit(value) {
  exactKeys(value, ['contract', 'externalSigner', 'signatureAlgorithm'], 'POLICY_AUDIT_INVALID')
  if (value.contract !== CRM_CORE_CODEX_STAGING_READBACK_AUDIT_CONTRACT
    || value.externalSigner !== auditSigner || value.signatureAlgorithm !== 'Ed25519') fail('POLICY_AUDIT_INVALID')
  return Object.freeze({ contract: CRM_CORE_CODEX_STAGING_READBACK_AUDIT_CONTRACT, externalSigner: auditSigner, signatureAlgorithm: 'Ed25519' })
}

function assertPolicyKeyRing(value) {
  exactKeys(value, ['acceptedKeyIds', 'activeKeyId', 'publicKeys'], 'POLICY_KEY_RING_INVALID')
  const publicKeys = plainRecord(value.publicKeys, 'POLICY_KEY_RING_INVALID')
  const entries = Object.entries(publicKeys)
  if (!Array.isArray(value.acceptedKeyIds) || entries.length < 1 || entries.length > 4
    || new Set(value.acceptedKeyIds).size !== value.acceptedKeyIds.length) fail('POLICY_KEY_RING_INVALID')
  const activeKeyId = normalizedKeyId(value.activeKeyId, 'POLICY_KEY_RING_INVALID')
  const acceptedKeyIds = value.acceptedKeyIds.map((keyId) => normalizedKeyId(keyId, 'POLICY_KEY_RING_INVALID'))
  if (acceptedKeyIds[0] !== activeKeyId || acceptedKeyIds.length !== entries.length) fail('POLICY_KEY_RING_INVALID')
  const parsed = Object.freeze(Object.fromEntries(entries.map(([keyId, entry]) => [
    normalizedKeyId(keyId, 'POLICY_KEY_RING_INVALID'), publicKeyEntry(entry, 'POLICY_PUBLIC_KEY_INVALID'),
  ])))
  if (acceptedKeyIds.some((keyId) => !Object.hasOwn(parsed, keyId))) fail('POLICY_KEY_RING_INVALID')
  return Object.freeze({ activeKeyId, acceptedKeyIds: Object.freeze([...acceptedKeyIds]), publicKeys: parsed })
}

export function assertCrmCoreCodexStagingReadbackCustodyPolicy(value) {
  if (value && value[validatedPolicy] === true) return value
  exactKeys(value, ['audit', 'authority', 'contract', 'core', 'keyRing', 'prohibitions', 'receipt', 'source', 'state'], 'POLICY_INVALID')
  if (value.contract !== CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_CONTRACT || value.state !== 'active') fail('POLICY_INVALID')
  if (!Array.isArray(value.prohibitions) || value.prohibitions.length !== 5
    || value.prohibitions.some((entry) => typeof entry !== 'string' || !entry.trim())) fail('POLICY_PROHIBITIONS_INVALID')
  assertNoSensitiveKeys(value, 'policy')
  const authority = assertAuthority(value.authority, {
    deploymentAuthorized: false,
    productionAuthorized: false,
    domainChangeAuthorized: false,
    backfillAuthorized: false,
    legacyRetirementAuthorized: false,
  }, 'POLICY_AUTHORITY_INVALID')
  return Object.freeze({
    [validatedPolicy]: true,
    contract: CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_CONTRACT,
    state: 'active',
    source: assertPolicySource(value.source),
    core: assertPolicyCore(value.core),
    receipt: assertPolicyReceipt(value.receipt),
    audit: assertPolicyAudit(value.audit),
    authority,
    keyRing: assertPolicyKeyRing(value.keyRing),
  })
}

export function readCrmCoreCodexStagingReadbackCustodyPolicy(filename = DEFAULT_POLICY_FILE) {
  return assertCrmCoreCodexStagingReadbackCustodyPolicy(readJsonFile(filename, 'POLICY_READ_FAILED'))
}

function assertSource(value, policy, code) {
  exactKeys(value, ['ref', 'repositoryId', 'sha', 'tree'], code)
  if (value.repositoryId !== policy.source.repositoryId || value.ref !== policy.source.ref) fail(code)
  return Object.freeze({
    repositoryId: policy.source.repositoryId,
    ref: policy.source.ref,
    sha: normalizedSha(value.sha, code),
    tree: normalizedSha(value.tree, code),
  })
}

function assertCustody(value, source, policy, code) {
  exactKeys(value, [
    'consoleDigest', 'contract', 'executionId', 'manifestDigest', 'profile', 'receiptDigest',
    'receiptId', 'releaseSetDigest', 'workerDigest',
  ], code)
  if (value.contract !== policy.receipt.custodyContract || value.profile !== policy.receipt.environment) fail(code)
  const executionId = normalizedUuid(value.executionId, code)
  const receiptId = String(value.receiptId || '').trim()
  if (receiptId !== `crm-codex-artifact-${source.sha}-${executionId}`) fail(code)
  return Object.freeze({
    contract: policy.receipt.custodyContract,
    receiptId,
    receiptDigest: normalizedDigest(value.receiptDigest, code),
    executionId,
    profile: policy.receipt.environment,
    manifestDigest: normalizedDigest(value.manifestDigest, code),
    workerDigest: normalizedDigest(value.workerDigest, code),
    consoleDigest: normalizedDigest(value.consoleDigest, code),
    releaseSetDigest: normalizedDigest(value.releaseSetDigest, code),
  })
}

function assertWorkerDeployment(value, code) {
  exactKeys(value, ['deploymentId', 'observedWorkerDigest', 'versionId'], code)
  return Object.freeze({
    versionId: normalizedPlatformId(value.versionId, code),
    deploymentId: normalizedPlatformId(value.deploymentId, code),
    observedWorkerDigest: normalizedDigest(value.observedWorkerDigest, code),
  })
}

function assertPagesDeployment(value, policy, code) {
  optionalKeys(value, ['deploymentId', 'evidence', 'observedConsoleDigest'], ['evidence', 'observedConsoleDigest'], code)
  if (value.evidence !== policy.receipt.pagesEvidence) fail(code)
  const pages = {
    evidence: policy.receipt.pagesEvidence,
    observedConsoleDigest: normalizedDigest(value.observedConsoleDigest, code),
  }
  if (Object.hasOwn(value, 'deploymentId')) pages.deploymentId = normalizedPlatformId(value.deploymentId, code)
  return Object.freeze(pages)
}

function assertDeployment(value, policy, code) {
  exactKeys(value, ['environment', 'pages', 'worker'], code)
  if (value.environment !== policy.receipt.environment) fail(code)
  return Object.freeze({
    environment: policy.receipt.environment,
    worker: assertWorkerDeployment(value.worker, code),
    pages: assertPagesDeployment(value.pages, policy, code),
  })
}

function assertReadback(value, policy, code) {
  exactKeys(value, ['checks', 'executionId', 'origin', 'outputDigest'], code)
  if (value.origin !== policy.receipt.origin) fail(code)
  return Object.freeze({
    origin: policy.receipt.origin,
    executionId: normalizedUuid(value.executionId, code),
    checks: exactStrings(value.checks, policy.receipt.checks, code),
    outputDigest: normalizedDigest(value.outputDigest, code),
  })
}

function assertReceiptSignature(value, policy, code) {
  exactKeys(value, ['algorithm', 'contract', 'externalSigner', 'keyId', 'publicKeyFingerprint', 'signedStatementDigest', 'value'], code)
  if (value.contract !== policy.receipt.signatureContract || value.algorithm !== policy.audit.signatureAlgorithm
    || value.externalSigner !== policy.audit.externalSigner) fail(code)
  const keyId = normalizedKeyId(value.keyId, code)
  const key = policy.keyRing.publicKeys[keyId]
  if (!key || !policy.keyRing.acceptedKeyIds.includes(keyId)) fail(code)
  const publicKeyFingerprint = normalizedDigest(value.publicKeyFingerprint, code)
  if (publicKeyFingerprint !== key.spkiFingerprint) fail(code)
  const signatureValue = String(value.value || '').trim()
  if (!base64urlSignaturePattern.test(signatureValue)) fail(code)
  const signature = Buffer.from(signatureValue, 'base64url')
  if (signature.length !== 64 || signature.toString('base64url') !== signatureValue) fail(code)
  return Object.freeze({
    contract: policy.receipt.signatureContract,
    algorithm: policy.audit.signatureAlgorithm,
    externalSigner: policy.audit.externalSigner,
    keyId,
    publicKeyFingerprint,
    signedStatementDigest: normalizedDigest(value.signedStatementDigest, code),
    value: signatureValue,
  })
}

function statementForReceipt({ authority, contract, custody, deployment, readback, source, state }) {
  return Object.freeze({ authority, contract, custody, deployment, readback, source, state })
}

function statementForAudit(receipt, observedAt) {
  return Object.freeze({ ...receipt.statement, observedAt })
}

function assertReceiptMetadata(value, policy) {
  assertNoSensitiveKeys(value, 'receipt')
  exactKeys(value, ['authority', 'contract', 'custody', 'deployment', 'readback', 'signature', 'source', 'state'], 'RECEIPT_INVALID')
  if (value.contract !== policy.receipt.contract || value.state !== policy.receipt.state) fail('RECEIPT_INVALID')
  const source = assertSource(value.source, policy, 'RECEIPT_SOURCE_INVALID')
  const custody = assertCustody(value.custody, source, policy, 'RECEIPT_CUSTODY_INVALID')
  const deployment = assertDeployment(value.deployment, policy, 'RECEIPT_DEPLOYMENT_INVALID')
  const readback = assertReadback(value.readback, policy, 'RECEIPT_READBACK_INVALID')
  const authority = assertAuthority(value.authority, policy.authority, 'RECEIPT_AUTHORITY_INVALID')
  const signature = assertReceiptSignature(value.signature, policy, 'RECEIPT_SIGNATURE_INVALID')
  const statement = statementForReceipt({
    authority,
    contract: policy.receipt.contract,
    custody,
    deployment,
    readback,
    source,
    state: policy.receipt.state,
  })
  if (signature.signedStatementDigest !== canonicalCrmCoreCodexStagingReadbackDigest(statement)) fail('RECEIPT_SIGNATURE_STATEMENT_MISMATCH')
  const signatureValue = Buffer.from(signature.value, 'base64url')
  try {
    if (!crypto.verify(null, Buffer.from(canonicalCrmCoreCodexStagingReadbackJson(statement), 'utf8'), policy.keyRing.publicKeys[signature.keyId].verifier, signatureValue)) {
      fail('RECEIPT_SIGNATURE_MISMATCH')
    }
  } finally {
    signatureValue.fill(0)
  }
  if (deployment.worker.observedWorkerDigest !== custody.workerDigest
    || deployment.pages.observedConsoleDigest !== custody.consoleDigest) fail('RECEIPT_DEPLOYMENT_DIGEST_MISMATCH')
  return Object.freeze({ authority, contract: policy.receipt.contract, custody, deployment, readback, signature, source, state: policy.receipt.state, statement })
}

function assertAudit(value, receipt, policy) {
  assertNoSensitiveKeys(value, 'audit')
  exactKeys(value, ['contract', 'signature', 'statement', 'verified'], 'AUDIT_INVALID')
  if (value.contract !== policy.audit.contract || value.verified !== true) fail('AUDIT_INVALID')
  exactKeys(value.signature, ['algorithm', 'keyId', 'publicKeyFingerprint', 'value'], 'AUDIT_SIGNATURE_INVALID')
  if (value.signature.algorithm !== policy.audit.signatureAlgorithm) fail('AUDIT_SIGNATURE_INVALID')
  const keyId = normalizedKeyId(value.signature.keyId, 'AUDIT_SIGNATURE_INVALID')
  const key = policy.keyRing.publicKeys[keyId]
  const publicKeyFingerprint = normalizedDigest(value.signature.publicKeyFingerprint, 'AUDIT_SIGNATURE_INVALID')
  if (!key || !policy.keyRing.acceptedKeyIds.includes(keyId)
    || keyId !== receipt.signature.keyId || publicKeyFingerprint !== receipt.signature.publicKeyFingerprint
    || publicKeyFingerprint !== key.spkiFingerprint) fail('AUDIT_SIGNATURE_CUSTODY_MISMATCH')
  const observedAt = normalizedUtcTimestamp(value.statement?.observedAt, 'AUDIT_OBSERVED_AT_INVALID')
  const statement = statementForAudit(receipt, observedAt)
  if (canonicalCrmCoreCodexStagingReadbackJson(value.statement) !== canonicalCrmCoreCodexStagingReadbackJson(statement)) {
    fail('AUDIT_STATEMENT_MISMATCH')
  }
  if (typeof value.signature.value !== 'string' || !base64urlSignaturePattern.test(value.signature.value)) fail('AUDIT_SIGNATURE_INVALID')
  const signature = Buffer.from(value.signature.value, 'base64url')
  if (signature.length !== 64) fail('AUDIT_SIGNATURE_INVALID')
  try {
    if (!crypto.verify(null, Buffer.from(canonicalCrmCoreCodexStagingReadbackJson(statement), 'utf8'), key.verifier, signature)) {
      fail('AUDIT_SIGNATURE_MISMATCH')
    }
  } finally {
    signature.fill(0)
  }
  return Object.freeze({ keyId, publicKeyFingerprint, observedAt })
}

function normalizeCoreOrigin(value) {
  return String(value || '').trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

function isolatedGitEnvironment() {
  const environment = { ...process.env }
  for (const name of [
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_DIR',
    'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX', 'GIT_WORK_TREE',
    'GIT_ASKPASS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_SSH_COMMAND', 'GIT_TERMINAL_PROMPT',
  ]) delete environment[name]
  for (const name of Object.keys(environment)) {
    if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/i.test(name)) delete environment[name]
  }
  // Git for Windows rejects Node's `\\\\.\\nul` spelling of `os.devNull` as a
  // config path. `NUL` is the supported null-device spelling for Git there;
  // use it so the isolated verifier remains able to inspect an external Core
  // checkout without inheriting a user-level Git configuration.
  environment.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : os.devNull
  environment.GIT_CONFIG_NOSYSTEM = '1'
  environment.GIT_TERMINAL_PROMPT = '0'
  return environment
}

function gitAt(coreRoot, argumentsValue, code) {
  try {
    return execFileSync('git', ['-C', coreRoot, ...argumentsValue], {
      env: isolatedGitEnvironment(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    fail(code)
  }
}

function assertCoreRepository(coreRootInput, receipt, policy) {
  const requested = path.resolve(coreRootInput)
  if (isWithin(repositoryRoot, requested)) fail('CORE_ROOT_PATH_INVALID')
  let stat
  let coreRoot
  try {
    stat = fs.lstatSync(requested)
    coreRoot = fs.realpathSync.native ? fs.realpathSync.native(requested) : fs.realpathSync(requested)
  } catch {
    fail('CORE_ROOT_INVALID')
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || !samePath(requested, coreRoot) || isWithin(repositoryRoot, coreRoot)) {
    fail('CORE_ROOT_PATH_INVALID')
  }
  const topLevel = gitAt(coreRoot, ['rev-parse', '--show-toplevel'], 'CORE_ROOT_NOT_GIT')
  if (!samePath(topLevel, coreRoot)) fail('CORE_ROOT_NOT_TOP_LEVEL')
  if (gitAt(coreRoot, ['status', '--porcelain=v1', '--untracked-files=all'], 'CORE_ROOT_STATUS_FAILED')) fail('CORE_ROOT_DIRTY')
  if (normalizeCoreOrigin(gitAt(coreRoot, ['remote', 'get-url', 'origin'], 'CORE_ROOT_ORIGIN_FAILED')) !== normalizeCoreOrigin(policy.core.origin)) {
    fail('CORE_ROOT_ORIGIN_INVALID')
  }
  const head = normalizedSha(gitAt(coreRoot, ['rev-parse', 'HEAD'], 'CORE_ROOT_HEAD_FAILED'), 'CORE_ROOT_HEAD_INVALID')
  const tree = normalizedSha(gitAt(coreRoot, ['rev-parse', 'HEAD^{tree}'], 'CORE_ROOT_TREE_FAILED'), 'CORE_ROOT_TREE_INVALID')
  if (head !== receipt.source.sha || tree !== receipt.source.tree) fail('CORE_ROOT_SOURCE_MISMATCH')
  if (gitAt(coreRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], 'CORE_ROOT_HEAD_STATE_FAILED') !== 'HEAD') fail('CORE_ROOT_NOT_DETACHED')
  normalizedSha(gitAt(coreRoot, ['rev-parse', '--verify', 'refs/remotes/origin/main'], 'CORE_ROOT_CANONICAL_MAIN_UNAVAILABLE'), 'CORE_ROOT_CANONICAL_MAIN_UNAVAILABLE')
  gitAt(coreRoot, ['merge-base', '--is-ancestor', receipt.source.sha, 'refs/remotes/origin/main'], 'CORE_ROOT_CANONICAL_MAIN_NOT_DESCENDANT')
  if (gitAt(coreRoot, ['ls-files', '--error-unmatch', policy.core.verifier], 'CORE_VERIFIER_NOT_TRACKED') !== policy.core.verifier) {
    fail('CORE_VERIFIER_NOT_TRACKED')
  }
  const verifierPath = path.join(coreRoot, policy.core.verifier)
  let verifierStat
  try {
    verifierStat = fs.lstatSync(verifierPath)
  } catch {
    fail('CORE_VERIFIER_MISSING')
  }
  if (verifierStat.isSymbolicLink() || !verifierStat.isFile()) fail('CORE_VERIFIER_PATH_INVALID')
  return Object.freeze({ coreRoot, verifierPath })
}

function assertCustodyCanonicalMain(value, receipt) {
  const source = plainRecord(value.source, 'CUSTODY_RECEIPT_MAIN_REF_INVALID')
  exactKeys(source, ['mainShaAfter', 'mainShaBefore', 'ref', 'repository', 'repositoryId', 'sha', 'tree'], 'CUSTODY_RECEIPT_MAIN_REF_INVALID')
  if (source.repository !== coreRepository || source.repositoryId !== receipt.source.repositoryId || source.ref !== coreMainRef
    || normalizedSha(source.sha, 'CUSTODY_RECEIPT_MAIN_REF_INVALID') !== receipt.source.sha
    || normalizedSha(source.tree, 'CUSTODY_RECEIPT_MAIN_REF_INVALID') !== receipt.source.tree
    || normalizedSha(source.mainShaBefore, 'CUSTODY_RECEIPT_MAIN_REF_INVALID') !== receipt.source.sha
    || normalizedSha(source.mainShaAfter, 'CUSTODY_RECEIPT_MAIN_REF_INVALID') !== receipt.source.sha) {
    fail('CUSTODY_RECEIPT_MAIN_REF_INVALID')
  }
}

function assertCoreVerifierSummary(output, receipt, policy) {
  if (Buffer.byteLength(output, 'utf8') < 2 || Buffer.byteLength(output, 'utf8') > 8 * 1024) fail('CORE_VERIFIER_OUTPUT_INVALID')
  let value
  try {
    value = JSON.parse(output)
  } catch {
    fail('CORE_VERIFIER_OUTPUT_INVALID')
  }
  exactKeys(value, [
    'contract', 'custodyReceiptId', 'externalSigner', 'ok', 'pagesDeploymentId', 'publicKeyFingerprint',
    'readbackExecutionId', 'sourceSha', 'sourceTree', 'workerDeploymentId',
  ], 'CORE_VERIFIER_OUTPUT_INVALID')
  assertNoSensitiveKeys(value, 'core-verifier-output')
  if (value.ok !== true || value.contract !== policy.receipt.contract
    || normalizedSha(value.sourceSha, 'CORE_VERIFIER_OUTPUT_INVALID') !== receipt.source.sha
    || normalizedSha(value.sourceTree, 'CORE_VERIFIER_OUTPUT_INVALID') !== receipt.source.tree
    || value.custodyReceiptId !== receipt.custody.receiptId
    || normalizedPlatformId(value.workerDeploymentId, 'CORE_VERIFIER_OUTPUT_INVALID') !== receipt.deployment.worker.deploymentId
    || normalizedUuid(value.readbackExecutionId, 'CORE_VERIFIER_OUTPUT_INVALID') !== receipt.readback.executionId
    || value.externalSigner !== policy.audit.externalSigner
    || normalizedDigest(value.publicKeyFingerprint, 'CORE_VERIFIER_OUTPUT_INVALID') !== receipt.signature.publicKeyFingerprint) {
    fail('CORE_VERIFIER_OUTPUT_MISMATCH')
  }
  const expectedPagesDeploymentId = receipt.deployment.pages.deploymentId || null
  if (value.pagesDeploymentId !== expectedPagesDeploymentId
    && (value.pagesDeploymentId !== null || expectedPagesDeploymentId !== null)) fail('CORE_VERIFIER_OUTPUT_MISMATCH')
  return Object.freeze({
    workerDeploymentId: receipt.deployment.worker.deploymentId,
    pagesDeploymentId: expectedPagesDeploymentId,
    readbackExecutionId: receipt.readback.executionId,
  })
}

function runCoreVerifier(core, files, receipt, policy) {
  let output
  try {
    output = execFileSync(process.execPath, [
      core.verifierPath,
      '--receipt', files.receipt.absolute,
      '--custody-receipt', files.custodyReceipt.absolute,
      '--readback-output', files.readbackOutput.absolute,
      '--expected-sha', receipt.source.sha,
      '--expected-tree', receipt.source.tree,
    ], {
      cwd: core.coreRoot,
      env: isolatedGitEnvironment(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    fail('CORE_VERIFIER_FAILED')
  }
  return assertCoreVerifierSummary(output.trim(), receipt, policy)
}

function assertExternalFileUnchanged(file, code) {
  const current = readExternalJson(file.requested, path.basename(file.requested), code)
  if (!samePath(current.absolute, file.absolute) || !current.contents.equals(file.contents)) fail(`${code}_CHANGED`)
}

function writeExternalJsonSnapshot(directory, file, code) {
  const absolute = path.join(directory, path.basename(file.absolute))
  try {
    fs.writeFileSync(absolute, file.contents, { flag: 'wx', mode: 0o600 })
  } catch {
    fail('EXTERNAL_SNAPSHOT_INVALID')
  }
  return readExternalJson(absolute, path.basename(file.absolute), code)
}

function writeExternalCustodyBundleSnapshot(directory, bundle) {
  try {
    fs.mkdirSync(directory, { mode: 0o700 })
    const directories = bundle.entries
      .filter((entry) => entry.kind === 'directory')
      .sort((left, right) => left.relative.split('/').length - right.relative.split('/').length
        || left.relative.localeCompare(right.relative))
    for (const entry of directories) fs.mkdirSync(bundleEntryPath(directory, entry.relative), { mode: 0o700 })
    for (const entry of bundle.entries.filter((entry) => entry.kind === 'file')) {
      fs.writeFileSync(bundleEntryPath(directory, entry.relative), entry.contents, { flag: 'wx', mode: 0o600 })
    }
  } catch {
    fail('EXTERNAL_SNAPSHOT_INVALID')
  }
  const receipt = readExternalJson(path.join(directory, custodyReceiptBasename), custodyReceiptBasename, 'EXTERNAL_SNAPSHOT_INVALID')
  const snapshot = readExternalCustodyArtifactBundle(receipt, 'EXTERNAL_SNAPSHOT_INVALID')
  if (!sameCustodyBundle(bundle, snapshot)) fail('EXTERNAL_SNAPSHOT_INVALID')
  return snapshot
}

function createExternalSnapshots(files, custodyBundle) {
  let directory
  try {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skincos-crm-core-custody-'))
    fs.chmodSync(directory, 0o700)
    if (isInsideGitWorktree(directory)) fail('EXTERNAL_SNAPSHOT_PATH_INVALID')
    const snapshotBundle = writeExternalCustodyBundleSnapshot(path.join(directory, 'custody'), custodyBundle)
    const snapshots = Object.freeze({
      receipt: writeExternalJsonSnapshot(directory, files.receipt, 'EXTERNAL_SNAPSHOT_INVALID'),
      custodyReceipt: snapshotBundle.receipt,
      readbackOutput: writeExternalJsonSnapshot(directory, files.readbackOutput, 'EXTERNAL_SNAPSHOT_INVALID'),
      audit: writeExternalJsonSnapshot(directory, files.audit, 'EXTERNAL_SNAPSHOT_INVALID'),
    })
    return Object.freeze({ directory, files: snapshots, custodyBundle: snapshotBundle })
  } catch {
    if (directory) fs.rmSync(directory, { recursive: true, force: true })
    fail('EXTERNAL_SNAPSHOT_INVALID')
  }
}

function removeExternalSnapshots(snapshot) {
  fs.rmSync(snapshot.directory, { recursive: true, force: true })
}

function assertDistinctExternalFiles(files) {
  const paths = Object.values(files).map((file) => pathForComparison(file.absolute))
  if (new Set(paths).size !== paths.length) fail('EXTERNAL_PATH_COLLISION')
}

/**
 * Validates the local-Codex staging evidence lane without changing or accepting
 * the GitHub v1 receipt lane. This is an evidence-only check: all authority
 * flags are pinned false and callers still need independent release gates.
 */
export function verifyCrmCoreCodexStagingReadbackReceiptFiles(options = {}) {
  const policy = assertCrmCoreCodexStagingReadbackCustodyPolicy(options.policy)
  const files = Object.freeze({
    receipt: readExternalJson(options.receipt, receiptBasename, 'RECEIPT_FILE_INVALID'),
    custodyReceipt: readExternalJson(options.custodyReceipt, custodyReceiptBasename, 'CUSTODY_RECEIPT_FILE_INVALID'),
    readbackOutput: readExternalJson(options.readbackOutput, readbackOutputBasename, 'READBACK_OUTPUT_FILE_INVALID'),
    audit: readExternalJson(options.audit, auditBasename, 'AUDIT_FILE_INVALID'),
  })
  assertDistinctExternalFiles(files)
  const receipt = assertReceiptMetadata(files.receipt.value, policy)
  assertCustodyCanonicalMain(files.custodyReceipt.value, receipt)
  const custodyBundle = readExternalCustodyArtifactBundle(files.custodyReceipt, 'CUSTODY_BUNDLE_INVALID')
  const core = assertCoreRepository(options.coreRoot, receipt, policy)
  const snapshot = createExternalSnapshots(files, custodyBundle)
  try {
    const coreSummary = runCoreVerifier(core, snapshot.files, receipt, policy)
    assertExternalFileUnchanged(snapshot.files.receipt, 'EXTERNAL_SNAPSHOT_RECEIPT_FILE_INVALID')
    assertExternalCustodyBundleUnchanged(snapshot.custodyBundle, 'EXTERNAL_SNAPSHOT_CUSTODY_BUNDLE_INVALID')
    assertExternalFileUnchanged(snapshot.files.readbackOutput, 'EXTERNAL_SNAPSHOT_READBACK_OUTPUT_FILE_INVALID')
    assertExternalFileUnchanged(snapshot.files.audit, 'EXTERNAL_SNAPSHOT_AUDIT_FILE_INVALID')
    assertExternalFileUnchanged(files.receipt, 'RECEIPT_FILE_INVALID')
    assertExternalCustodyBundleUnchanged(custodyBundle, 'CUSTODY_BUNDLE_INVALID')
    assertExternalFileUnchanged(files.readbackOutput, 'READBACK_OUTPUT_FILE_INVALID')
    assertExternalFileUnchanged(files.audit, 'AUDIT_FILE_INVALID')
    const audit = assertAudit(files.audit.value, receipt, policy)
    return Object.freeze({
      ok: true,
      contract: policy.contract,
      coreReceiptContract: receipt.contract,
      coreSourceSha: receipt.source.sha,
      coreSourceTree: receipt.source.tree,
      custodyReceiptId: receipt.custody.receiptId,
      workerDeploymentId: coreSummary.workerDeploymentId,
      pagesDeploymentId: coreSummary.pagesDeploymentId,
      readbackExecutionId: coreSummary.readbackExecutionId,
      observationAt: audit.observedAt,
      externalSigner: policy.audit.externalSigner,
      keyId: audit.keyId,
      publicKeyFingerprint: audit.publicKeyFingerprint,
      authority: receipt.authority,
    })
  } finally {
    removeExternalSnapshots(snapshot)
  }
}

function parseArguments(argv) {
  const allowed = new Set(['--receipt', '--custody-receipt', '--readback-output', '--audit', '--core-root', '--policy'])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!allowed.has(name) || values.has(name) || !value || value.startsWith('--')) fail('ARGUMENTS_INVALID')
    values.set(name, value)
    index += 1
  }
  for (const required of ['--receipt', '--custody-receipt', '--readback-output', '--audit', '--core-root']) {
    if (!values.has(required)) fail('ARGUMENTS_INVALID')
  }
  return Object.freeze({
    receipt: values.get('--receipt'),
    custodyReceipt: values.get('--custody-receipt'),
    readbackOutput: values.get('--readback-output'),
    audit: values.get('--audit'),
    coreRoot: values.get('--core-root'),
    policy: values.get('--policy') || DEFAULT_POLICY_FILE,
  })
}

function main() {
  const argumentsValue = parseArguments(process.argv.slice(2))
  const result = verifyCrmCoreCodexStagingReadbackReceiptFiles({
    ...argumentsValue,
    policy: readCrmCoreCodexStagingReadbackCustodyPolicy(argumentsValue.policy),
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_INVALID'}\n`)
    process.exitCode = 2
  }
}
