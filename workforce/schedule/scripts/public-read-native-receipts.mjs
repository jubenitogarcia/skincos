import fs from 'node:fs'
import path from 'node:path'
import { NATIVE_UUID, NATIVE_RESOURCES, nativeAdapterMode, nativeDigest, snapshotNativeData, validateNativeManifest } from './public-read-native-manifest.mjs'

export const NATIVE_RECEIPT_CONTRACT = 'schedule-public-read-native-production-receipt/v1'
const fail = () => { throw new Error('schedule_native_receipt_invalid') }
const safeOperation = /^(preflight|core-enable|core-disable|adapter-bootstrap-disabled|adapter-enable|adapter-disable|adapter-reconcile-disable|reconcile-probe)$/

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

export function readNativePredecessor({ directory, root, manifest, operation, manifestDigest }) {
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
  const chain = readOperationChain({ directory, root, manifest, operation, manifestDigest })
  const terminal = chain.records.at(-1)
  if (chain.digest !== data.finalJournalDigest || terminal?.phase !== 'complete'
    || nativeDigest(JSON.stringify(terminal.metadata)) !== nativeDigest(JSON.stringify(data.metadata))) fail()
  return receipt
}

// Historical authority is explicit: the current manifest pins both documents.
// Expiry is ignored only when reading history, never for the new release.
export function readNativeAdapterHistory({ directory, root, releaseId, operation, manifestDigest }) {
  assertPrivateDirectory(directory, root)
  if (!NATIVE_UUID.test(releaseId ?? '')) fail()
  const mode = nativeAdapterMode(operation)
  const document = readPrivateJson(path.join(directory, releaseId + '-manifest.json'), { maxBytes: 8192 })
  const prior = validateNativeManifest(document.raw, { sourceSha: document.data.sourceSha, sourceTree: document.data.sourceTree,
    configDigest: document.data.configDigest, expectedDigest: manifestDigest, recovery: true, historical: true })
  if (prior.releaseId !== releaseId) fail()
  const receipt = readNativePredecessor({ directory, root, manifest: prior, operation, manifestDigest: document.digest })
  const metadata = receipt.data.metadata
  if (!NATIVE_UUID.test(metadata?.versionId ?? '') || metadata.mode !== mode || metadata.surface !== 'adapter'
    || typeof metadata.deploymentId !== 'string' || !metadata.deploymentId || metadata.deploymentId.length > 128
    || typeof metadata.namespaceId !== 'string' || !metadata.namespaceId || metadata.namespaceId.length > 128) fail()
  return Object.freeze({ manifest: prior, receipt, descriptor: snapshotNativeData({ releaseId, sourceSha: prior.sourceSha,
    sourceTree: prior.sourceTree, configDigest: prior.configDigest, manifestDigest: document.digest, receiptDigest: receipt.digest,
    operation, mode, versionId: metadata.versionId, deploymentId: metadata.deploymentId, namespaceId: metadata.namespaceId }) })
}

export function readNativeAdapterLineage({ directory, root, manifest }) {
  const selected = manifest.adapterPredecessor
  if (!selected) fail()
  const history = readNativeAdapterHistory({ directory, root, releaseId: selected.releaseId,
    operation: selected.operation, manifestDigest: selected.manifestDigest })
  if (history.manifest.releaseId === manifest.releaseId || Date.parse(history.manifest.createdAt) > Date.parse(manifest.createdAt)
    || Object.keys(history.descriptor).some(key => history.descriptor[key] !== selected[key])) fail()
  return history
}

// One claim per observed adapter version (or its initial absence), across all
// releases in this private ledger. Keep it after success, failure or unknown ACK.
export function claimNativeAdapterVersion({ directory, root, manifest, operation, versionId, namespaceId, basisDigest }) {
  assertPrivateDirectory(directory, root)
  if (!['adapter-bootstrap-disabled', 'adapter-enable', 'adapter-disable', 'adapter-reconcile-disable'].includes(operation)
    || !/^[a-f0-9]{64}$/.test(basisDigest ?? '')
    || (versionId === 'absent' ? operation !== 'adapter-bootstrap-disabled' || namespaceId !== null
      : !NATIVE_UUID.test(versionId ?? '') || typeof namespaceId !== 'string' || !namespaceId)) fail()
  const claims = path.join(directory, 'adapter-version-claims')
  try { fs.mkdirSync(claims, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  assertPrivateDirectory(claims, root)
  const parent = fs.openSync(directory, fs.constants.O_RDONLY)
  try { fs.fsyncSync(parent) } finally { fs.closeSync(parent) }
  writeExclusive(path.join(claims, versionId + '.json'), { contract: NATIVE_RECEIPT_CONTRACT, kind: 'adapter-version-claim',
    accountId: NATIVE_RESOURCES.accountId, worker: NATIVE_RESOURCES.adapterWorker, releaseId: manifest.releaseId,
    sourceSha: manifest.sourceSha, operation, versionId, namespaceId, basisDigest })
}

function readOperationChain({ directory, root, manifest, operation, manifestDigest }) {
  assertPrivateDirectory(directory, root)
  const operationRoot = path.join(directory, manifest.releaseId, operation)
  assertPrivateDirectory(path.dirname(operationRoot), root); assertPrivateDirectory(operationRoot, root)
  const files = fs.readdirSync(operationRoot).filter(name => /^\d{3}-[a-z][a-z0-9-]*\.json$/.test(name)).sort()
  if (!files.length || files.length > 100) fail()
  let previousDigest = null
  const records = []
  for (let index = 0; index < files.length; index++) {
    const item = readPrivateJson(path.join(operationRoot, files[index])), data = item.data
    if (data.sequence !== index || data.previousDigest !== previousDigest || data.contract !== NATIVE_RECEIPT_CONTRACT
      || data.releaseId !== manifest.releaseId || data.sourceSha !== manifest.sourceSha || data.sourceTree !== manifest.sourceTree
      || data.configDigest !== manifest.configDigest || data.operation !== operation) fail()
    if (index === 0 && manifestDigest !== undefined
      && (data.phase !== 'prepared' || data.metadata?.manifestDigest !== manifestDigest)) fail()
    previousDigest = item.digest; records.push(data)
  }
  return { records, digest: previousDigest }
}

// Compensation accepts only the exact ready readback already recorded by this
// enable attempt. It never manufactures a successful activation receipt.
export function readNativeIncompleteAdapterReadback({ directory, root, manifest, manifestDigest }) {
  const operation = 'adapter-enable', receiptFile = path.join(directory, manifest.releaseId, operation, 'receipt.json')
  try { fs.lstatSync(receiptFile); fail() } catch (error) { if (error.code !== 'ENOENT') throw error }
  const chain = readOperationChain({ directory, root, manifest, operation, manifestDigest })
  const completed = chain.records.filter(record => record.phase === 'adapter-readback')
  if (completed.length !== 1 || !chain.records.some(record => record.phase === 'adapter-deploy-started'
    && record.sequence < completed[0].sequence)) fail()
  const observed = completed[0].metadata
  if (!NATIVE_UUID.test(observed?.versionId ?? '') || observed.surface !== 'adapter' || observed.mode !== 'ready'
    || typeof observed.namespaceId !== 'string' || !observed.namespaceId
    || typeof observed.deploymentId !== 'string' || !observed.deploymentId) fail()
  return Object.freeze({ data: snapshotNativeData({ metadata: observed }), digest: chain.digest })
}
