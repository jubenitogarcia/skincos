import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CUSTODY_RELEASE_BASELINE,
  DIRECT_TRANSFER_CLOSURE,
  EXCLUDED_SOURCE_PATHS,
  SHARED_PLATFORM_INPUTS,
  validateWhatsappAdapterBoundary
} from '../validate-whatsapp-adapter-boundary.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const MANIFEST = path.join(ROOT, 'messaging/channels/whatsapp/adapter-boundary.json')

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
}

function withTemporaryManifest(mutator, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skincos-whatsapp-adapter-boundary-'))
  try {
    const manifest = readManifest()
    mutator(manifest)
    const file = path.join(dir, 'adapter-boundary.json')
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
    callback(file)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function copySource(fromRoot, toRoot, relative) {
  const source = path.join(fromRoot, relative)
  const destination = path.join(toRoot, relative)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}

function createFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'skincos-whatsapp-adapter-fixture-'))
  const paths = new Set([
    ...DIRECT_TRANSFER_CLOSURE,
    ...CUSTODY_RELEASE_BASELINE,
    ...SHARED_PLATFORM_INPUTS,
    'crm/api/services/waMessageMetaStore.js'
  ])
  for (const entry of paths) copySource(ROOT, fixture, entry)
  return fixture
}

test('validates the reviewed pre-cut WhatsApp adapter boundary', () => {
  const result = validateWhatsappAdapterBoundary({ root: ROOT })
  assert.deepEqual(result, {
    ok: true,
    candidateRepository: 'skincos-whatsapp-adapter',
    status: 'pre-cut',
    directTransferFiles: DIRECT_TRANSFER_CLOSURE.length,
    custodyBaselineFiles: CUSTODY_RELEASE_BASELINE.length,
    excludedEnginePath: EXCLUDED_SOURCE_PATHS[0],
    singleServiceUnit: 'messaging-whatsapp.service'
  })
})

test('rejects an Evolution source file in the direct adapter closure', () => {
  withTemporaryManifest((manifest) => {
    manifest.directTransferClosure.push('messaging/channels/whatsapp/engine/package.json')
  }, (manifestFile) => {
    assert.throws(
      () => validateWhatsappAdapterBoundary({ root: ROOT, manifestFile }),
      /directTransferClosure must match the reviewed source list exactly/
    )
  })
})

test('rejects CRM-owned message metadata from the adapter closure', () => {
  withTemporaryManifest((manifest) => {
    manifest.directTransferClosure.push('crm/api/services/waMessageMetaStore.js')
  }, (manifestFile) => {
    assert.throws(
      () => validateWhatsappAdapterBoundary({ root: ROOT, manifestFile }),
      /directTransferClosure must match the reviewed source list exactly/
    )
  })
})

test('rejects treating unreworked native custody scripts as portable adapter code', () => {
  withTemporaryManifest((manifest) => {
    manifest.directTransferClosure.push('scripts/runtime/prepare-messaging-whatsapp-release.sh')
  }, (manifestFile) => {
    assert.throws(
      () => validateWhatsappAdapterBoundary({ root: ROOT, manifestFile }),
      /directTransferClosure must match the reviewed source list exactly/
    )
  })
})

test('rejects a second process launcher in the portable CRM adapter', () => {
  const fixture = createFixture()
  try {
    const adapter = path.join(fixture, 'crm/api/services/whatsappOrchestrator.js')
    fs.appendFileSync(adapter, "\nimport { spawn } from 'node:child_process'\n")
    assert.throws(
      () => validateWhatsappAdapterBoundary({ root: fixture }),
      /CRM compatibility adapter must not contain "child_process"/
    )
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})

test('rejects a second ExecStart in the native service template', () => {
  const fixture = createFixture()
  try {
    const service = path.join(fixture, 'ops/runtime/units/messaging-whatsapp.service')
    fs.appendFileSync(service, '\nExecStart=/usr/bin/false\n')
    assert.throws(
      () => validateWhatsappAdapterBoundary({ root: fixture }),
      /messaging service template must define exactly one ExecStart/
    )
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})
