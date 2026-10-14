import fs from 'node:fs'
import path from 'node:path'
import { NATIVE_UUID, nativeDigest, snapshotNativeData } from './public-read-native-manifest.mjs'

export const NATIVE_RECEIPT_CONTRACT = 'schedule-public-read-native-production-receipt/v1'
const fail = () => { throw new Error('schedule_native_receipt_invalid') }
const safeOperation = /^(preflight|core-enable|core-disable|adapter-bootstrap-disabled|adapter-enable|adapter-disable|reconcile-probe)$/

export function assertPrivateDirectory(directory, root) {
  if (process.platform !== 'linux' || !path.isAbsolute(directory) || directory === '/'
    || directory === root || directory.startsWith(root + path.sep)) fail()
  const info = fs.lstatSync(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()
    || (info.mode & 0o777) !== 0o700 || fs.realpathSync(directory) !== directory) fail()
  return directory
}

export function readPrivateJson(file, { maxBytes = 65536, mode = 0o600, uid = process.getuid() } = {}) {
  const info = fs.lstatSync(file)
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== uid || info.nlink !== 1
    || (info.mode & 0o777) !== mode || info.size < 1 || info.size > maxBytes || fs.realpathSync(file) !== file) fail()
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  let bytes
  try {
    const before = fs.fstatSync(fd)
    if (before.dev !== info.dev || before.ino !== info.ino || before.mode !== info.mode) fail()
    bytes = fs.readFileSync(fd)
    const after = fs.fstatSync(fd)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail()
    const raw = bytes.toString('utf8')
    return Object.freeze({ raw, digest: nativeDigest(raw), data: snapshotNativeData(JSON.parse(raw)) })
  } catch { fail() } finally { bytes?.fill(0); fs.closeSync(fd) }
}

function writeExclusive(file, value) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  const parent = fs.openSync(path.dirname(file), fs.constants.O_RDONLY)
  try { fs.fsyncSync(parent) } finally { fs.closeSync(parent) }
}

// One operation directory is exclusive. A started or unknown mutation is
// never resumed by reissuing it. Reconciliation uses a separate operation.
export function createNativeJournal({ directory, root, manifest, operation }) {
  assertPrivateDirectory(directory, root)
  if (!NATIVE_UUID.test(manifest.releaseId) || !safeOperation.test(operation)) fail()
  const releaseRoot = path.join(directory, manifest.releaseId)
  if (!fs.existsSync(releaseRoot)) fs.mkdirSync(releaseRoot, { mode: 0o700 })
  assertPrivateDirectory(releaseRoot, root)
  const operationRoot = path.join(releaseRoot, operation)
  fs.mkdirSync(operationRoot, { mode: 0o700 })
  assertPrivateDirectory(operationRoot, root)
  let sequence = 0, previousDigest = null, complete = false
  const append = (phase, metadata = {}) => {
    if (complete || !/^[a-z][a-z0-9-]{0,63}$/.test(phase)) fail()
    const record = snapshotNativeData({ contract: NATIVE_RECEIPT_CONTRACT, releaseId: manifest.releaseId,
      sourceSha: manifest.sourceSha, sourceTree: manifest.sourceTree, configDigest: manifest.configDigest,
      operation, sequence, previousDigest, phase, recordedAt: new Date().toISOString(), metadata })
    const raw = JSON.stringify(record) + '\n'
    writeExclusive(path.join(operationRoot, `${String(sequence).padStart(3, '0')}-${phase}.json`), record)
    previousDigest = nativeDigest(raw); sequence++
    return Object.freeze({ digest: previousDigest, record })
  }
  return Object.freeze({ append, operationRoot,
    complete(metadata) {
      append('complete', metadata); complete = true
      const receipt = { contract: NATIVE_RECEIPT_CONTRACT, releaseId: manifest.releaseId,
        sourceSha: manifest.sourceSha, sourceTree: manifest.sourceTree, configDigest: manifest.configDigest,
        operation, phase: 'complete', recordedAt: new Date().toISOString(), finalJournalDigest: previousDigest,
        metadata: snapshotNativeData(metadata) }
      writeExclusive(path.join(operationRoot, 'receipt.json'), receipt)
      return Object.freeze({ digest: nativeDigest(JSON.stringify(receipt) + '\n'), record: snapshotNativeData(receipt) })
    },
  })
}

export function readNativePredecessor({ directory, root, manifest, operation }) {
  assertPrivateDirectory(directory, root)
  if (!safeOperation.test(operation)) fail()
  const operationRoot = path.join(directory, manifest.releaseId, operation)
  assertPrivateDirectory(path.dirname(operationRoot), root); assertPrivateDirectory(operationRoot, root)
  const receipt = readPrivateJson(path.join(operationRoot, 'receipt.json'))
  const data = receipt.data
  if (data.contract !== NATIVE_RECEIPT_CONTRACT || data.releaseId !== manifest.releaseId
    || data.sourceSha !== manifest.sourceSha || data.sourceTree !== manifest.sourceTree
    || data.configDigest !== manifest.configDigest || data.operation !== operation || data.phase !== 'complete'
    || !/^[a-f0-9]{64}$/.test(data.finalJournalDigest ?? '') || !Number.isSafeInteger(Date.parse(data.recordedAt))) fail()
  const files = fs.readdirSync(operationRoot).filter(name => /^\d{3}-[a-z][a-z0-9-]*\.json$/.test(name)).sort()
  if (!files.length || files.length > 100) fail()
  let previousDigest = null
  for (let index = 0; index < files.length; index++) {
    const item = readPrivateJson(path.join(operationRoot, files[index]))
    if (item.data.sequence !== index || item.data.previousDigest !== previousDigest
      || item.data.contract !== data.contract || item.data.releaseId !== data.releaseId
      || item.data.sourceSha !== data.sourceSha || item.data.configDigest !== data.configDigest
      || item.data.operation !== operation) fail()
    previousDigest = item.digest
  }
  if (previousDigest !== data.finalJournalDigest) fail()
  return receipt
}
