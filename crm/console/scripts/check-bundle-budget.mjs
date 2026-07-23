import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const rootDir = path.resolve(import.meta.dirname, '..')
const distDir = path.join(rootDir, 'dist')
const manifestPath = path.join(distDir, '.vite', 'bundle-manifest.json')
const initialBudgetBytes = 800 * 1024
const specializedBudgetBytes = 1400 * 1024
const writeReport = process.argv.includes('--report')
const pontoModulePath = path.join(rootDir, 'PontoModule.tsx')

function toKiB(bytes) {
  return Math.round((bytes / 1024) * 10) / 10
}

async function fileSize(file) {
  return (await fs.stat(path.join(distDir, file))).size
}

function collect(manifest, keys, includeDynamic = false) {
  const visited = new Set()
  const pending = [...keys]
  while (pending.length) {
    const key = pending.pop()
    if (!key || visited.has(key) || !manifest[key]) continue
    visited.add(key)
    pending.push(...(manifest[key].imports || []))
    if (includeDynamic) pending.push(...(manifest[key].dynamicImports || []))
  }
  return visited
}

function filesFor(manifest, keys) {
  return [...keys]
    .map((key) => manifest[key]?.file)
    .filter((file) => typeof file === 'string' && file.endsWith('.js'))
}

async function describeFiles(files) {
  return Promise.all(files.map(async (file) => {
    const bytes = await fileSize(file)
    return { file, bytes, kib: toKiB(bytes) }
  }))
}

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
const entryKeys = Object.entries(manifest)
  .filter(([, item]) => item.isEntry)
  .map(([key]) => key)
if (!entryKeys.length) throw new Error('BUNDLE_ENTRY_NOT_FOUND')

const initialKeys = collect(manifest, entryKeys)
const initialFiles = [...new Set(filesFor(manifest, initialKeys))]
const initialAssets = await describeFiles(initialFiles)
const initialBytes = initialAssets.reduce((total, item) => total + item.bytes, 0)

const specializedFiles = Object.values(manifest)
  .map((item) => item.file)
  .filter((file) => typeof file === 'string' && /^assets\/ponto-(tensorflow|face-api)-.+\.js$/.test(file))
const specializedAssets = await describeFiles([...new Set(specializedFiles)])
const pontoSource = await fs.readFile(pontoModulePath, 'utf8')
const faceIdentificationDisabled = /const FACE_IDENTIFICATION_ENABLED\s*=\s*false\b/.test(pontoSource)
const expectedSpecializedChunks = faceIdentificationDisabled ? 0 : 2
const pontoKeys = Object.keys(manifest).filter((key) => key === 'PontoModule.tsx' || key.endsWith('/PontoModule.tsx'))
if (pontoKeys.length !== 1) throw new Error('BUNDLE_PONTO_ENTRY_NOT_FOUND')
const pontoReachableFiles = new Set(filesFor(manifest, collect(manifest, pontoKeys, true)))

const failures = []
if (initialBytes > initialBudgetBytes) failures.push(`BUNDLE_INITIAL_BUDGET_EXCEEDED_${initialBytes}`)
if (specializedAssets.length !== expectedSpecializedChunks) failures.push('BUNDLE_SPECIALIZED_CHUNKS_MISMATCH')
for (const asset of specializedAssets) {
  if (initialFiles.includes(asset.file)) failures.push(`BUNDLE_SPECIALIZED_EAGER_${asset.file}`)
  if (!pontoReachableFiles.has(asset.file)) failures.push(`BUNDLE_SPECIALIZED_NOT_PONTO_${asset.file}`)
  if (asset.bytes > specializedBudgetBytes) failures.push(`BUNDLE_SPECIALIZED_BUDGET_EXCEEDED_${asset.file}`)
}

const report = {
  ok: failures.length === 0,
  generatedAt: new Date().toISOString(),
  budgets: {
    initialKiB: toKiB(initialBudgetBytes),
    specializedDeferredKiB: toKiB(specializedBudgetBytes),
  },
  faceIdentification: faceIdentificationDisabled ? 'disabled' : 'enabled',
  initial: { bytes: initialBytes, kib: toKiB(initialBytes), assets: initialAssets },
  specializedDeferred: specializedAssets,
  failures,
}

if (writeReport) {
  const reportDir = process.env.CRM_BUNDLE_REPORT_DIR || path.join(os.tmpdir(), 'skincos-crm-bundle')
  await fs.mkdir(reportDir, { recursive: true })
  const reportPath = path.join(reportDir, `bundle-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  report.reportPath = reportPath
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (failures.length) process.exitCode = 1
