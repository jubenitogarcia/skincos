import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CUSTODY_RELEASE_BASELINE,
  validateWhatsappAdapterBaseline
} from '../validate-whatsapp-adapter-baseline.mjs'
import { BASELINE_SOURCE_COMMIT, PORTABLE_LAYOUT } from '../validate-whatsapp-adapter-candidate.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const MANIFEST = path.join(ROOT, 'messaging/channels/whatsapp/adapter-boundary.json')

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
}

function withTemporaryManifest(mutator, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skincos-whatsapp-adapter-baseline-'))
  try {
    const manifest = readManifest()
    mutator(manifest)
    const file = path.join(directory, 'adapter-boundary.json')
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
    callback(file)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('validates the reviewed monorepo WhatsApp adapter baseline', () => {
  const result = validateWhatsappAdapterBaseline({ root: ROOT })
  assert.deepEqual(result, {
    ok: true,
    status: 'pre-cut',
    baselineSourceCommit: BASELINE_SOURCE_COMMIT,
    portableSourceFiles: PORTABLE_LAYOUT.length,
    custodyBaselineFiles: CUSTODY_RELEASE_BASELINE.length,
    singleServiceUnit: 'messaging-whatsapp.service'
  })
})

test('pins the baseline Git commit and tree instead of accepting merely well-formed values', () => {
  withTemporaryManifest((manifest) => {
    manifest.baseline.sourceTree = '0'.repeat(40)
  }, (manifestFile) => {
    assert.throws(
      () => validateWhatsappAdapterBaseline({ root: ROOT, manifestFile }),
      /baseline source commit and tree must match the reviewed values exactly/
    )
  })
})

test('rejects Evolution source from the portable source layout', () => {
  withTemporaryManifest((manifest) => {
    manifest.portableClosure.layout[0].source = 'messaging/channels/whatsapp/engine/package.json'
  }, (manifestFile) => {
    assert.throws(
      () => validateWhatsappAdapterBaseline({ root: ROOT, manifestFile }),
      /portableClosure\.layout must match the reviewed layout exactly/
    )
  })
})

test('rejects CRM message metadata from the portable source layout', () => {
  withTemporaryManifest((manifest) => {
    manifest.portableClosure.layout.push({
      source: 'crm/api/services/waMessageMetaStore.js',
      target: 'crm/api/services/waMessageMetaStore.js'
    })
  }, (manifestFile) => {
    assert.throws(
      () => validateWhatsappAdapterBaseline({ root: ROOT, manifestFile }),
      /portableClosure\.layout must match the reviewed layout exactly/
    )
  })
})

test('rejects unreworked native custody from the portable source layout', () => {
  withTemporaryManifest((manifest) => {
    manifest.portableClosure.layout.push({
      source: 'scripts/runtime/prepare-messaging-whatsapp-release.sh',
      target: 'scripts/runtime/prepare-messaging-whatsapp-release.sh'
    })
  }, (manifestFile) => {
    assert.throws(
      () => validateWhatsappAdapterBaseline({ root: ROOT, manifestFile }),
      /portableClosure\.layout must match the reviewed layout exactly/
    )
  })
})

test('rejects a baseline that renames the single native service', () => {
  withTemporaryManifest((manifest) => {
    manifest.runtimeAndObservability.singleServiceUnit = 'messaging-whatsapp-adapter.service'
  }, (manifestFile) => {
    assert.throws(
      () => validateWhatsappAdapterBaseline({ root: ROOT, manifestFile }),
      /singleServiceUnit must remain messaging-whatsapp\.service/
    )
  })
})

test('preserves CRM proxy ownership and CRM-only message metadata', () => {
  withTemporaryManifest((manifest) => {
    manifest.crmCompatibility.legacyRouteNamespace = '/api/other/*'
  }, (manifestFile) => {
    assert.throws(
      () => validateWhatsappAdapterBaseline({ root: ROOT, manifestFile }),
      /legacyRouteNamespace must preserve the CRM proxy namespace/
    )
  })
})

test('rejects a baseline that stops prohibiting a second Evolution runtime', () => {
  withTemporaryManifest((manifest) => {
    manifest.runtimeAndObservability.prohibited = []
  }, (manifestFile) => {
    assert.throws(
      () => validateWhatsappAdapterBaseline({ root: ROOT, manifestFile }),
      /runtimeAndObservability\.prohibited is missing/
    )
  })
})
