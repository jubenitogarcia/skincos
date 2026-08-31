import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  BASELINE_SOURCE_COMMIT,
  BASELINE_SOURCE_TREE,
  PORTABLE_LAYOUT,
  REQUIRED_EVIDENCE_KEYS,
  assertWhatsappAdapterCandidateEligible,
  inspectWhatsappAdapterCandidate,
  measureWhatsappAdapterCandidate
} from '../validate-whatsapp-adapter-candidate.mjs'
import {
  REVIEWED_PORTABLE_VALIDATOR_SHA256,
  inspectTrustedWhatsappAdapterCandidate
} from '../validate-whatsapp-adapter-baseline.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')

function copySource(fromRoot, toRoot, source, target) {
  const sourceFile = path.join(fromRoot, source)
  const targetFile = path.join(toRoot, target)
  fs.mkdirSync(path.dirname(targetFile), { recursive: true })
  fs.copyFileSync(sourceFile, targetFile)
}

function createPortableCandidate() {
  const candidate = fs.mkdtempSync(path.join(os.tmpdir(), 'skincos-whatsapp-adapter-candidate-'))
  for (const entry of PORTABLE_LAYOUT) copySource(ROOT, candidate, entry.source, entry.target)
  return candidate
}

function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true })
}

function unprovenEvidence(identity) {
  return {
    schemaVersion: 1,
    source: {
      commit: BASELINE_SOURCE_COMMIT,
      tree: BASELINE_SOURCE_TREE,
      candidateClosureSha256: identity.candidateClosureSha256,
      archiveSha256: identity.archiveSha256
    },
    gates: Object.fromEntries(REQUIRED_EVIDENCE_KEYS.map((key) => [
      key,
      { status: 'unproven', ref: null, sha256: null }
    ]))
  }
}

function writeEvidence(evidence) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skincos-whatsapp-adapter-evidence-'))
  const file = path.join(directory, 'candidate-evidence.json')
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n')
  return { directory, file }
}

function tarHeader(name, { size = 0, type = 48 } = {}) {
  const header = Buffer.alloc(512)
  header.write(name, 0, 'utf8')
  header.write('0000644\0', 100, 'ascii')
  header.write('0000000\0', 108, 'ascii')
  header.write('0000000\0', 116, 'ascii')
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii')
  header.write('00000000000\0', 136, 'ascii')
  header.fill(32, 148, 156)
  header[156] = type
  header.write('ustar\0', 257, 'ascii')
  header.write('00', 263, 'ascii')
  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
  return header
}

test('the declared portable closure runs in isolation and still refuses pre-cut creation', async () => {
  const candidate = createPortableCandidate()
  let evidenceOutput
  try {
    const identity = measureWhatsappAdapterCandidate({ candidate })
    const evidence = unprovenEvidence(identity)
    const inspected = inspectWhatsappAdapterCandidate({
      candidate,
      evidence,
      expectedValidatorSha256: REVIEWED_PORTABLE_VALIDATOR_SHA256
    })
    assert.equal(inspected.ok, true)
    assert.equal(inspected.eligible, false)
    assert.deepEqual(inspected.blockers, [
      'status is pre-cut',
      'missing evidence for exactPrivatePackageForCrm',
      'missing evidence for pinnedUpstreamArtifact',
      'missing evidence for signedPlatformOpsCustody',
      'missing evidence for singlePublisherServiceAndRollback'
    ])

    evidenceOutput = writeEvidence(evidence)
    const candidateScript = path.join(candidate, 'scripts/validate-whatsapp-adapter-candidate.mjs')
    const cli = spawnSync(process.execPath, [
      candidateScript,
      '--candidate', candidate,
      '--evidence', evidenceOutput.file,
      '--trusted-validator-sha256', REVIEWED_PORTABLE_VALIDATOR_SHA256
    ], {
      cwd: candidate,
      encoding: 'utf8'
    })
    assert.equal(cli.status, 78)
    assert.match(cli.stderr, /status is pre-cut/)

    const trustedCli = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts/validate-whatsapp-adapter-baseline.mjs'),
      '--candidate', candidate,
      '--evidence', evidenceOutput.file
    ], {
      cwd: ROOT,
      encoding: 'utf8'
    })
    assert.equal(trustedCli.status, 78)
    assert.match(trustedCli.stderr, /status is pre-cut/)

    const isolatedTests = spawnSync(process.execPath, [
      '--test',
      'crm/api/services/__tests__/whatsappOrchestrator.basic.test.js',
      'crm/api/services/__tests__/evolutionOrchestrator.test.js'
    ], {
      cwd: candidate,
      encoding: 'utf8'
    })
    assert.equal(isolatedTests.status, 0, isolatedTests.stderr)

    const portableModule = await import(pathToFileURL(candidateScript).href)
    const portableResult = portableModule.inspectWhatsappAdapterCandidate({
      candidate,
      evidence,
      expectedValidatorSha256: REVIEWED_PORTABLE_VALIDATOR_SHA256
    })
    assert.equal(portableResult.eligible, false)

    const rejectedInspect = spawnSync(process.execPath, [
      candidateScript,
      '--candidate', candidate,
      '--evidence', evidenceOutput.file,
      '--trusted-validator-sha256', REVIEWED_PORTABLE_VALIDATOR_SHA256,
      '--inspect'
    ], {
      cwd: candidate,
      encoding: 'utf8'
    })
    assert.equal(rejectedInspect.status, 78)
    assert.match(rejectedInspect.stderr, /unknown option/)
  } finally {
    if (evidenceOutput) cleanup(evidenceOutput.directory)
    cleanup(candidate)
  }
})

test('candidate gate rejects Evolution source and CRM state even when evidence is otherwise supplied', () => {
  const candidate = createPortableCandidate()
  try {
    const identity = measureWhatsappAdapterCandidate({ candidate })
    const evidence = unprovenEvidence(identity)
    const engine = path.join(candidate, 'messaging/channels/whatsapp/engine/package.json')
    fs.mkdirSync(path.dirname(engine), { recursive: true })
    fs.writeFileSync(engine, '{}\n')
    assert.throws(
      () => inspectWhatsappAdapterCandidate({
        candidate,
        evidence,
        expectedValidatorSha256: REVIEWED_PORTABLE_VALIDATOR_SHA256
      }),
      /candidate closure must not contain (unexpected directory|prohibited path)/
    )
  } finally {
    cleanup(candidate)
  }

  const stateCandidate = createPortableCandidate()
  try {
    const identity = measureWhatsappAdapterCandidate({ candidate: stateCandidate })
    const evidence = unprovenEvidence(identity)
    const state = path.join(stateCandidate, 'crm/api/services/waMessageMetaStore.js')
    fs.mkdirSync(path.dirname(state), { recursive: true })
    fs.writeFileSync(state, 'export const state = true\n')
    assert.throws(
      () => inspectWhatsappAdapterCandidate({
        candidate: stateCandidate,
        evidence,
        expectedValidatorSha256: REVIEWED_PORTABLE_VALIDATOR_SHA256
      }),
      /candidate closure must not contain (unexpected directory|unexpected file|prohibited path)/
    )
  } finally {
    cleanup(stateCandidate)
  }

  const extraDirectoryCandidate = createPortableCandidate()
  try {
    fs.mkdirSync(path.join(extraDirectoryCandidate, 'unexpected-empty-directory'))
    assert.throws(
      () => measureWhatsappAdapterCandidate({ candidate: extraDirectoryCandidate }),
      /candidate closure must not contain unexpected director(?:y|ies)/
    )
  } finally {
    cleanup(extraDirectoryCandidate)
  }
})

test('candidate directory rejects an unexpected subtree before traversing its payload', () => {
  const candidate = createPortableCandidate()
  try {
    const unexpectedPayload = path.join(candidate, 'unexpected', 'large.bin')
    fs.mkdirSync(path.dirname(unexpectedPayload), { recursive: true })
    fs.writeFileSync(unexpectedPayload, Buffer.alloc(3 * 1024 * 1024))
    assert.throws(
      () => measureWhatsappAdapterCandidate({ candidate }),
      /must not contain unexpected directory/
    )
  } finally {
    cleanup(candidate)
  }
})

test('candidate gate verifies closure digest, source commit, tree and adapter source digests', () => {
  const candidate = createPortableCandidate()
  try {
    const identity = measureWhatsappAdapterCandidate({ candidate })
    const digestMismatch = unprovenEvidence(identity)
    digestMismatch.source.candidateClosureSha256 = '0'.repeat(64)
    assert.throws(
      () => inspectWhatsappAdapterCandidate({
        candidate,
        evidence: digestMismatch,
        expectedValidatorSha256: REVIEWED_PORTABLE_VALIDATOR_SHA256
      }),
      /closure digest does not match/
    )

    const treeMismatch = unprovenEvidence(identity)
    treeMismatch.source.tree = '0'.repeat(40)
    assert.throws(
      () => inspectWhatsappAdapterCandidate({
        candidate,
        evidence: treeMismatch,
        expectedValidatorSha256: REVIEWED_PORTABLE_VALIDATOR_SHA256
      }),
      /source commit and tree must match/
    )

    fs.appendFileSync(path.join(candidate, 'crm/api/services/evolutionOrchestrator.js'), '\n// unauthorized candidate change\n')
    assert.throws(
      () => measureWhatsappAdapterCandidate({ candidate }),
      /source digest does not match the reviewed/
    )
  } finally {
    cleanup(candidate)
  }
})

test('candidate package cannot gain install, publisher or runtime scripts while pre-cut', () => {
  const candidate = createPortableCandidate()
  try {
    const packageFile = path.join(candidate, 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
    packageJson.scripts.postinstall = 'node scripts/start-another-engine.mjs'
    fs.writeFileSync(packageFile, JSON.stringify(packageJson, null, 2) + '\n')
    assert.throws(
      () => measureWhatsappAdapterCandidate({ candidate }),
      /candidate package scripts keys must match the reviewed list exactly/
    )
  } finally {
    cleanup(candidate)
  }
})

test('candidate TAR is inspected without extraction and binds its raw archive digest', () => {
  const candidate = createPortableCandidate()
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'skincos-whatsapp-adapter-tar-'))
  try {
    const archive = path.join(scratch, 'adapter.tar')
    execFileSync('tar', ['-cf', archive, '-C', candidate, '.'])
    const identity = measureWhatsappAdapterCandidate({ candidate: archive })
    assert.equal(identity.candidateType, 'archive')
    assert.match(identity.archiveSha256, /^[0-9a-f]{64}$/)
    const result = inspectWhatsappAdapterCandidate({
      candidate: archive,
      evidence: unprovenEvidence(identity),
      expectedValidatorSha256: REVIEWED_PORTABLE_VALIDATOR_SHA256
    })
    assert.equal(result.eligible, false)

    const badEvidence = unprovenEvidence(identity)
    badEvidence.source.archiveSha256 = '0'.repeat(64)
    assert.throws(
      () => inspectWhatsappAdapterCandidate({
        candidate: archive,
        evidence: badEvidence,
        expectedValidatorSha256: REVIEWED_PORTABLE_VALIDATOR_SHA256
      }),
      /archive digest does not match/
    )
  } finally {
    cleanup(candidate)
    cleanup(scratch)
  }
})

test('candidate TAR rejects prohibited payloads and corrupted header identity', () => {
  const candidate = createPortableCandidate()
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'skincos-whatsapp-adapter-tar-negative-'))
  try {
    const engine = path.join(candidate, 'messaging/channels/whatsapp/engine/package.json')
    fs.mkdirSync(path.dirname(engine), { recursive: true })
    fs.writeFileSync(engine, '{}\n')
    const prohibitedArchive = path.join(scratch, 'prohibited-adapter.tar')
    execFileSync('tar', ['-cf', prohibitedArchive, '-C', candidate, '.'])
    assert.throws(
      () => measureWhatsappAdapterCandidate({ candidate: prohibitedArchive }),
      /must not contain prohibited path/
    )

    fs.rmSync(path.join(candidate, 'messaging'), { recursive: true, force: true })
    const validArchive = path.join(scratch, 'valid-adapter.tar')
    execFileSync('tar', ['-cf', validArchive, '-C', candidate, '.'])
    const corrupt = fs.readFileSync(validArchive)
    corrupt[0] ^= 1
    const corruptArchive = path.join(scratch, 'corrupt-adapter.tar')
    fs.writeFileSync(corruptArchive, corrupt)
    assert.throws(
      () => measureWhatsappAdapterCandidate({ candidate: corruptArchive }),
      /header checksum does not match/
    )
  } finally {
    cleanup(candidate)
    cleanup(scratch)
  }
})

test('candidate TAR rejects traversal paths before any extraction is possible', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'skincos-whatsapp-adapter-tar-traversal-'))
  try {
    const archive = path.join(scratch, 'traversal.tar')
    fs.writeFileSync(archive, Buffer.concat([
      tarHeader('../outside'),
      Buffer.alloc(1024)
    ]))
    assert.throws(
      () => measureWhatsappAdapterCandidate({ candidate: archive }),
      /safe repository-relative path/
    )
  } finally {
    cleanup(scratch)
  }
})

test('the trusted source gate rejects a candidate that replaces its portable validator', () => {
  const candidate = createPortableCandidate()
  try {
    const candidateValidator = path.join(candidate, 'scripts/validate-whatsapp-adapter-candidate.mjs')
    fs.writeFileSync(candidateValidator, 'process.exit(0)\n')
    const identity = measureWhatsappAdapterCandidate({ candidate })
    const evidence = unprovenEvidence(identity)
    assert.throws(
      () => inspectTrustedWhatsappAdapterCandidate({ root: ROOT, candidate, evidence }),
      /portable validator SHA-256 does not match the trusted reviewed identity/
    )
  } finally {
    cleanup(candidate)
  }
})

test('pre-cut status remains a hard creation and publisher block even if evidence is forged as proven', () => {
  const candidate = createPortableCandidate()
  try {
    const identity = measureWhatsappAdapterCandidate({ candidate })
    const evidence = unprovenEvidence(identity)
    for (const key of REQUIRED_EVIDENCE_KEYS) {
      evidence.gates[key] = {
        status: 'proven',
        ref: 'evidence://future/' + key,
        sha256: 'a'.repeat(64)
      }
    }
    const inspected = inspectWhatsappAdapterCandidate({
      candidate,
      evidence,
      expectedValidatorSha256: REVIEWED_PORTABLE_VALIDATOR_SHA256
    })
    assert.deepEqual(inspected.blockers, ['status is pre-cut'])
    assert.throws(
      () => assertWhatsappAdapterCandidateEligible({
        candidate,
        evidence,
        expectedValidatorSha256: REVIEWED_PORTABLE_VALIDATOR_SHA256
      }),
      /not eligible for repository creation or publishing/
    )

    const manifestFile = path.join(candidate, 'adapter-boundary.json')
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    manifest.status = 'ready'
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
    assert.throws(
      () => measureWhatsappAdapterCandidate({ candidate }),
      /status must remain pre-cut/
    )
  } finally {
    cleanup(candidate)
  }
})
