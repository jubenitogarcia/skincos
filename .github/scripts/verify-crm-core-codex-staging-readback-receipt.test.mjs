import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CRM_CORE_CODEX_STAGING_READBACK_AUDIT_CONTRACT,
  CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_CONTRACT,
  CRM_CORE_CODEX_STAGING_READBACK_RECEIPT_CONTRACT,
  DEFAULT_POLICY_FILE,
  assertCrmCoreCodexStagingReadbackCustodyPolicy,
  canonicalCrmCoreCodexStagingReadbackDigest,
  canonicalCrmCoreCodexStagingReadbackJson,
  readCrmCoreCodexStagingReadbackCustodyPolicy,
} from './verify-crm-core-codex-staging-readback-receipt.mjs'

const script = fileURLToPath(new URL('./verify-crm-core-codex-staging-readback-receipt.mjs', import.meta.url))
const expectedChecks = [
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
]

function isolatedGitEnvironment() {
  const environment = { ...process.env }
  for (const name of [
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_DIR',
    'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX', 'GIT_WORK_TREE',
  ]) delete environment[name]
  return environment
}

function git(cwd, argumentsValue) {
  return execFileSync('git', argumentsValue, {
    cwd,
    env: isolatedGitEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function writeJson(filename, value) {
  fs.writeFileSync(filename, `${JSON.stringify(value)}\n`, 'utf8')
}

function fileDigest(filename) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')}`
}

function spkiFingerprint(publicKey) {
  return `sha256:${crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex')}`
}

function policyFor(keyPair, keyId) {
  const jwk = keyPair.publicKey.export({ format: 'jwk' })
  return {
    contract: CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_CONTRACT,
    state: 'active',
    source: {
      repository: 'jubenitogarcia/skincos-crm-core',
      repositoryId: '1353934107',
      ref: 'refs/heads/main',
    },
    core: {
      origin: 'https://github.com/jubenitogarcia/skincos-crm-core.git',
      verifier: 'scripts/verify-codex-staging-readback-receipt.mjs',
    },
    receipt: {
      contract: CRM_CORE_CODEX_STAGING_READBACK_RECEIPT_CONTRACT,
      custodyContract: 'skincos-crm/codex-local-artifact-custody/v2',
      readbackOutputContract: 'skincos-crm/codex-staging-readback-output/v1',
      signatureContract: 'skincos-crm/codex-staging-readback-receipt-signature-metadata/v1',
      state: 'verified-external-readback',
      environment: 'staging',
      origin: 'https://skincos-crm-core-staging.skincos.workers.dev',
      pagesEvidence: 'external-console-readback',
      checks: [...expectedChecks],
    },
    audit: {
      contract: CRM_CORE_CODEX_STAGING_READBACK_AUDIT_CONTRACT,
      externalSigner: 'codex-local-custody',
      signatureAlgorithm: 'Ed25519',
    },
    authority: {
      deploymentAuthorized: false,
      productionAuthorized: false,
      domainChangeAuthorized: false,
      backfillAuthorized: false,
      legacyRetirementAuthorized: false,
    },
    keyRing: {
      activeKeyId: keyId,
      acceptedKeyIds: [keyId],
      publicKeys: {
        [keyId]: {
          jwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
          spkiFingerprint: spkiFingerprint(keyPair.publicKey),
        },
      },
    },
    prohibitions: [
      'receipt-only',
      'runtime-only',
      'raw-signature-external',
      'core-verifier-required',
      'github-v1-separate',
    ],
  }
}

function createCoreRoot(root, { failVerifier = false } = {}) {
  const coreRoot = path.join(root, 'core')
  fs.mkdirSync(path.join(coreRoot, 'scripts'), { recursive: true })
  const verifier = `
import fs from 'node:fs'
import process from 'node:process'

const values = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  values.set(process.argv[index], process.argv[index + 1])
  index += 1
}
if (${failVerifier ? 'true' : 'false'}) process.exit(23)
for (const name of ['--receipt', '--custody-receipt', '--readback-output', '--expected-sha', '--expected-tree', '--expected-external-signer', '--expected-public-key-fingerprint']) {
  if (!values.get(name)) process.exit(24)
}
const receipt = JSON.parse(fs.readFileSync(values.get('--receipt'), 'utf8'))
if (values.get('--expected-sha') !== receipt.source.sha
  || values.get('--expected-tree') !== receipt.source.tree
  || values.get('--expected-external-signer') !== receipt.signature.externalSigner
  || values.get('--expected-public-key-fingerprint') !== receipt.signature.publicKeyFingerprint) process.exit(25)
process.stdout.write(JSON.stringify({
  ok: true,
  contract: receipt.contract,
  sourceSha: receipt.source.sha,
  sourceTree: receipt.source.tree,
  custodyReceiptId: receipt.custody.receiptId,
  workerDeploymentId: receipt.deployment.worker.deploymentId,
  pagesDeploymentId: receipt.deployment.pages.deploymentId || null,
  readbackExecutionId: receipt.readback.executionId,
  externalSigner: receipt.signature.externalSigner,
  publicKeyFingerprint: receipt.signature.publicKeyFingerprint,
}))
`
  fs.writeFileSync(path.join(coreRoot, 'scripts', 'verify-codex-staging-readback-receipt.mjs'), verifier.trimStart(), 'utf8')
  git(coreRoot, ['init', '--initial-branch=main'])
  git(coreRoot, ['config', 'user.email', 'codex-fixture@example.test'])
  git(coreRoot, ['config', 'user.name', 'Codex Fixture'])
  git(coreRoot, ['config', 'commit.gpgSign', 'false'])
  git(coreRoot, ['add', '.'])
  git(coreRoot, ['commit', '-m', 'fixture core verifier'])
  if (git(coreRoot, ['remote']).split(/\s+/).includes('origin')) {
    git(coreRoot, ['remote', 'set-url', 'origin', 'https://github.com/jubenitogarcia/skincos-crm-core.git'])
  } else {
    git(coreRoot, ['remote', 'add', 'origin', 'https://github.com/jubenitogarcia/skincos-crm-core.git'])
  }
  return coreRoot
}

function createFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-core-codex-readback-'))
  const externalRoot = path.join(root, 'runtime')
  fs.mkdirSync(externalRoot, { recursive: true })
  const coreRoot = createCoreRoot(root, options)
  const sourceSha = git(coreRoot, ['rev-parse', 'HEAD'])
  const sourceTree = git(coreRoot, ['rev-parse', 'HEAD^{tree}'])
  const signing = crypto.generateKeyPairSync('ed25519')
  const keyId = 'crm-core-staging-readback-fixture-v1'
  const policy = policyFor(signing, keyId)
  const policyFile = path.join(root, 'policy.json')
  writeJson(policyFile, policy)

  const executionId = '123e4567-e89b-12d3-a456-426614174000'
  const readbackExecutionId = '223e4567-e89b-12d3-a456-426614174000'
  const workerDigest = `sha256:${'1'.repeat(64)}`
  const consoleDigest = `sha256:${'2'.repeat(64)}`
  const custodyReceiptId = `crm-codex-artifact-${sourceSha}-${executionId}`
  const custodyReceiptFile = path.join(externalRoot, 'execution-receipt.json')
  writeJson(custodyReceiptFile, {
    contract: 'skincos-crm/codex-local-artifact-custody/v2',
    state: 'verified-build-only',
    receiptId: custodyReceiptId,
    source: { repository: 'jubenitogarcia/skincos-crm-core', repositoryId: '1353934107', ref: 'refs/heads/main', sha: sourceSha, tree: sourceTree },
    execution: { authority: 'codex-local', executionId, profile: 'staging', node: 'v22.12.0', npm: '10.9.0', fullHistory: true, cleanCheckout: true, reproducible: true },
    artifact: {
      manifest: 'release-artifact.json',
      manifestDigest: `sha256:${'3'.repeat(64)}`,
      sourceAttestationDigest: `sha256:${'4'.repeat(64)}`,
      workerDigest,
      consoleDigest,
      releaseSetDigest: `sha256:${'5'.repeat(64)}`,
    },
    recheck: { workerDigest, consoleDigest },
    authority: { deploymentAuthorized: false, productionAuthorized: false, domainChangeAuthorized: false, backfillAuthorized: false, legacyRetirementAuthorized: false },
    sensitiveValuesIncluded: false,
  })

  const source = { repositoryId: '1353934107', ref: 'refs/heads/main', sha: sourceSha, tree: sourceTree }
  const custody = {
    contract: 'skincos-crm/codex-local-artifact-custody/v2',
    receiptId: custodyReceiptId,
    receiptDigest: fileDigest(custodyReceiptFile),
    executionId,
    profile: 'staging',
    manifestDigest: `sha256:${'3'.repeat(64)}`,
    workerDigest,
    consoleDigest,
    releaseSetDigest: `sha256:${'5'.repeat(64)}`,
  }
  const deployment = {
    environment: 'staging',
    worker: {
      versionId: '323e4567-e89b-12d3-a456-426614174000',
      deploymentId: '423e4567-e89b-12d3-a456-426614174000',
      observedWorkerDigest: workerDigest,
    },
    pages: { evidence: 'external-console-readback', observedConsoleDigest: consoleDigest },
  }
  const readbackOutput = {
    contract: 'skincos-crm/codex-staging-readback-output/v1',
    source,
    deployment,
    readback: { origin: 'https://skincos-crm-core-staging.skincos.workers.dev', executionId: readbackExecutionId, checks: [...expectedChecks] },
  }
  const readbackOutputFile = path.join(externalRoot, 'readback-output.json')
  writeJson(readbackOutputFile, readbackOutput)
  const authority = { deploymentAuthorized: false, productionAuthorized: false, domainChangeAuthorized: false, backfillAuthorized: false, legacyRetirementAuthorized: false }
  const readback = {
    origin: 'https://skincos-crm-core-staging.skincos.workers.dev',
    executionId: readbackExecutionId,
    checks: [...expectedChecks],
    outputDigest: canonicalCrmCoreCodexStagingReadbackDigest(readbackOutput),
  }
  const statement = { authority, contract: CRM_CORE_CODEX_STAGING_READBACK_RECEIPT_CONTRACT, custody, deployment, readback, source, state: 'verified-external-readback' }
  const metadata = {
    ...statement,
    signature: {
      contract: 'skincos-crm/codex-staging-readback-receipt-signature-metadata/v1',
      algorithm: 'Ed25519',
      externalSigner: 'codex-local-custody',
      keyId,
      publicKeyFingerprint: policy.keyRing.publicKeys[keyId].spkiFingerprint,
      signedStatementDigest: canonicalCrmCoreCodexStagingReadbackDigest(statement),
    },
  }
  const receiptFile = path.join(externalRoot, 'codex-staging-readback-receipt.json')
  writeJson(receiptFile, metadata)
  const audit = {
    contract: CRM_CORE_CODEX_STAGING_READBACK_AUDIT_CONTRACT,
    statement: JSON.parse(JSON.stringify(statement)),
    signature: {
      algorithm: 'Ed25519',
      keyId,
      publicKeyFingerprint: policy.keyRing.publicKeys[keyId].spkiFingerprint,
      value: crypto.sign(null, Buffer.from(canonicalCrmCoreCodexStagingReadbackJson(statement), 'utf8'), signing.privateKey).toString('base64url'),
    },
    verified: true,
  }
  const auditFile = path.join(externalRoot, 'private-readback-audit.json')
  writeJson(auditFile, audit)
  return {
    root,
    coreRoot,
    policy,
    policyFile,
    receiptFile,
    custodyReceiptFile,
    readbackOutputFile,
    auditFile,
    metadata,
    audit,
  }
}

function removeFixture(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true })
}

function verifyFixture(fixture, overrides = {}) {
  const result = spawnSync(process.execPath, [
    script,
    '--receipt', overrides.receiptFile || fixture.receiptFile,
    '--custody-receipt', overrides.custodyReceiptFile || fixture.custodyReceiptFile,
    '--readback-output', overrides.readbackOutputFile || fixture.readbackOutputFile,
    '--audit', overrides.auditFile || fixture.auditFile,
    '--core-root', overrides.coreRoot || fixture.coreRoot,
    '--policy', overrides.policyFile || fixture.policyFile,
  ], { encoding: 'utf8' })
  return result
}

function failure(result) {
  assert.equal(result.status, 2, `stdout: ${result.stdout}\nstderr: ${result.stderr}`)
  return result.stderr.trim()
}

test('accepts the isolated Codex receipt only after the exact clean Core verifier and raw Ed25519 audit both pass', () => {
  const fixture = createFixture()
  try {
    const result = verifyFixture(fixture)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      contract: CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_CONTRACT,
      coreReceiptContract: CRM_CORE_CODEX_STAGING_READBACK_RECEIPT_CONTRACT,
      coreSourceSha: fixture.metadata.source.sha,
      coreSourceTree: fixture.metadata.source.tree,
      custodyReceiptId: fixture.metadata.custody.receiptId,
      workerDeploymentId: fixture.metadata.deployment.worker.deploymentId,
      pagesDeploymentId: null,
      readbackExecutionId: fixture.metadata.readback.executionId,
      externalSigner: 'codex-local-custody',
      keyId: fixture.metadata.signature.keyId,
      publicKeyFingerprint: fixture.metadata.signature.publicKeyFingerprint,
      authority: {
        deploymentAuthorized: false,
        productionAuthorized: false,
        domainChangeAuthorized: false,
        backfillAuthorized: false,
        legacyRetirementAuthorized: false,
      },
    })
  } finally {
    removeFixture(fixture)
  }
})

test('rejects authority, metadata, audit, public-key, and raw-signature tampering before any custody handoff', () => {
  const mutations = [
    {
      name: 'authority',
      apply: (fixture) => {
        fixture.metadata.authority.productionAuthorized = true
        writeJson(fixture.receiptFile, fixture.metadata)
      },
      code: 'RECEIPT_AUTHORITY_INVALID',
    },
    {
      name: 'metadata fingerprint',
      apply: (fixture) => {
        fixture.metadata.signature.publicKeyFingerprint = `sha256:${'f'.repeat(64)}`
        writeJson(fixture.receiptFile, fixture.metadata)
      },
      code: 'RECEIPT_SIGNATURE_INVALID',
    },
    {
      name: 'audit statement',
      apply: (fixture) => {
        fixture.audit.statement.source.tree = 'a'.repeat(40)
        writeJson(fixture.auditFile, fixture.audit)
      },
      code: 'AUDIT_STATEMENT_MISMATCH',
    },
    {
      name: 'raw signature',
      apply: (fixture) => {
        fixture.audit.signature.value = `${fixture.audit.signature.value.startsWith('A') ? 'B' : 'A'}${fixture.audit.signature.value.slice(1)}`
        writeJson(fixture.auditFile, fixture.audit)
      },
      code: 'AUDIT_SIGNATURE_MISMATCH',
    },
    {
      name: 'sensitive audit field',
      apply: (fixture) => {
        fixture.audit.secret = 'not-allowed'
        writeJson(fixture.auditFile, fixture.audit)
      },
      code: 'SENSITIVE_KEY:audit.secret',
    },
  ]
  const fixture = createFixture()
  try {
    const originalMetadata = JSON.stringify(fixture.metadata)
    const originalAudit = JSON.stringify(fixture.audit)
    for (const mutation of mutations) {
      fixture.metadata = JSON.parse(originalMetadata)
      fixture.audit = JSON.parse(originalAudit)
      writeJson(fixture.receiptFile, fixture.metadata)
      writeJson(fixture.auditFile, fixture.audit)
      mutation.apply(fixture)
      assert.match(failure(verifyFixture(fixture)), new RegExp(`CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_${mutation.code}`), mutation.name)
    }
  } finally {
    removeFixture(fixture)
  }
})

test('rejects an unclean or source-mismatched Core checkout and a failed independent Core verifier', () => {
  const mismatch = createFixture()
  try {
    git(mismatch.coreRoot, ['commit', '--allow-empty', '-m', 'advance fixture checkout'])
    assert.match(failure(verifyFixture(mismatch)), /CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_CORE_ROOT_SOURCE_MISMATCH/)
  } finally {
    removeFixture(mismatch)
  }

  const failedVerifier = createFixture({ failVerifier: true })
  try {
    assert.match(failure(verifyFixture(failedVerifier)), /CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_CORE_VERIFIER_FAILED/)
  } finally {
    removeFixture(failedVerifier)
  }
})

test('rejects in-repository or mislabeled receipt paths instead of accepting a Git artifact as local runtime evidence', () => {
  const fixture = createFixture()
  try {
    assert.match(
      failure(verifyFixture(fixture, { auditFile: fixture.receiptFile })),
      /CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_AUDIT_FILE_INVALID_PATH_INVALID/,
    )
    assert.match(
      failure(verifyFixture(fixture, { receiptFile: DEFAULT_POLICY_FILE })),
      /CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_RECEIPT_FILE_INVALID_PATH_INVALID/,
    )
  } finally {
    removeFixture(fixture)
  }
})

test('pins the reviewed local-Codex JWK/SPKI policy while keeping the separate GitHub v1 verifier contract present', () => {
  const policy = readCrmCoreCodexStagingReadbackCustodyPolicy()
  assert.equal(policy.contract, CRM_CORE_CODEX_STAGING_READBACK_CUSTODY_CONTRACT)
  assert.equal(policy.keyRing.activeKeyId, 'crm-core-staging-readback-20260914')
  assert.deepEqual(policy.keyRing.publicKeys[policy.keyRing.activeKeyId].jwk, {
    kty: 'OKP',
    crv: 'Ed25519',
    x: 'PUeFfAijyhaiQxjD1om5Ty7pv1k-HMiIgcjWRfh3Qi0',
  })
  assert.equal(policy.keyRing.publicKeys[policy.keyRing.activeKeyId].spkiFingerprint, 'sha256:9b66592a07770d91cc1078e83879a9ef6a0fbf6c8c4b8a80ba9301b6106e37e7')
  assert.deepEqual(policy.authority, {
    deploymentAuthorized: false,
    productionAuthorized: false,
    domainChangeAuthorized: false,
    backfillAuthorized: false,
    legacyRetirementAuthorized: false,
  })
  assert.doesNotThrow(() => assertCrmCoreCodexStagingReadbackCustodyPolicy(JSON.parse(fs.readFileSync(DEFAULT_POLICY_FILE, 'utf8'))))
  const legacyVerifier = fs.readFileSync(path.resolve(path.dirname(script), 'verify-crm-core-staging-readback-receipt.mjs'), 'utf8')
  assert.ok(legacyVerifier.includes('const RUN_ID = /^[1-9][0-9]{0,19}$/;'))
  assert.match(legacyVerifier, /skincos-crm\/staging-artifact-readback-receipt\/v1/)
})
