#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import { inspectWindowsPrivateAcl } from './windows-private-acl.mjs'

const WORKER_BINDINGS = [
  'PONTO_ACTOR_HMAC_KEY',
  'PONTO_IDEMPOTENCY_KEY',
  'PONTO_TEMPLATES_KEY',
  'PONTO_PROFILE_DATA_KEY',
  'PONTO_NETWORK_CONTEXT_KEY',
  'IDENTITY_WORKFORCE_HMAC_KEY',
]
const PAGES_BINDINGS = [
  'PONTO_ACTOR_HMAC_KEY',
  'PONTO_NETWORK_CONTEXT_KEY',
  'PONTO_RELEASE_PROBE_HMAC_KEY',
]
const INVENTORY_BINDINGS = [
  'IDENTITY_WORKFORCE_HMAC_KEY',
  'INSUMOS_SEED_TOKEN',
  'SESSION_SECRET',
]
const UNSAFE_VALUE = /^(?:__.*__|changeme|password|secret|test|test-.*|.*not-secret.*)$/i

function fail(message) {
  process.stderr.write(`[crm-local] ${message}\n`)
  process.exit(1)
}

function permissionModel(resolved, label) {
  const windowsAclBacked = process.platform === 'win32' || /^\/mnt\/[a-z](?:\/|$)/i.test(resolved)
  if (windowsAclBacked) {
    try {
      return inspectWindowsPrivateAcl(resolved, label)
    } catch (error) {
      fail(error?.message || `${label} não pôde ter sua DACL verificada.`)
    }
  }

  const stat = fs.statSync(resolved)
  const parent = fs.statSync(path.dirname(resolved))
  if (typeof process.getuid === 'function' && (stat.uid !== process.getuid() || parent.uid !== process.getuid())) {
    fail(`${label} e seu diretório privado devem pertencer ao operador atual.`)
  }
  if ((stat.mode & 0o077) !== 0) fail(`${label} deve usar permissão POSIX 0600.`)
  if ((parent.mode & 0o077) !== 0) fail(`O diretório de ${label} deve usar permissão POSIX 0700.`)
  return 'posix-owner-mode'
}

function privateFile(file, sourceRoot, label) {
  if (!file) fail(`${label} não informado.`)
  let resolved
  try {
    resolved = fs.realpathSync(file)
  } catch {
    fail(`${label} não existe ou não pode ser lido.`)
  }
  const relative = path.relative(sourceRoot, resolved)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    fail(`${label} deve ficar fora da árvore de código compartilhada.`)
  }
  if (!fs.statSync(resolved).isFile()) fail(`${label} deve apontar para um arquivo regular.`)
  return { path: resolved, permissionModel: permissionModel(resolved, label) }
}

function normalizedValue(raw) {
  const value = raw.trim()
  if (
    value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) return value.slice(1, -1)
  return value
}

function parseEnv(file, allowed, label) {
  const values = new Map()
  const allowedSet = new Set(allowed)
  for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (!match) fail(`${label} contém sintaxe inválida na linha ${index + 1}.`)
    const [, key, raw] = match
    if (!allowedSet.has(key)) fail(`${label} contém binding não autorizado: ${key}.`)
    if (values.has(key)) fail(`${label} repete o binding ${key}.`)
    const value = normalizedValue(raw)
    if (!/^[A-Za-z0-9_-]{16,}$/.test(value) || UNSAFE_VALUE.test(value)) {
      fail(`${label} contém valor vazio, curto ou placeholder em ${key}.`)
    }
    values.set(key, value)
  }
  const missing = allowed.filter((key) => !values.has(key))
  if (missing.length) fail(`${label} não contém: ${missing.join(', ')}.`)
  return values
}

const inputs = process.argv.slice(2)
if (inputs[0] === '--inventory-only') {
  const [, inventoryInput, sourceInput] = inputs
  if (!sourceInput) fail('Uso: validate-local-timekeeping-env.mjs --inventory-only <inventory.env> <source-root>.')
  const sourceRoot = fs.realpathSync(sourceInput)
  const inventoryPrivate = privateFile(inventoryInput, sourceRoot, 'CRM_INVENTORY_IDENTITY_ENV_FILE')
  parseEnv(inventoryPrivate.path, INVENTORY_BINDINGS, 'CRM_INVENTORY_IDENTITY_ENV_FILE')
  process.stdout.write(JSON.stringify({
    ok: true,
    workerBindings: [],
    pagesBindings: [],
    inventoryBindings: INVENTORY_BINDINGS,
    permissionModels: [inventoryPrivate.permissionModel],
  }) + '\n')
  process.exit(0)
}

const [workerInput, pagesInput, sourceInput, inventoryInput] = inputs
if (!sourceInput) {
  fail('Uso: validate-local-timekeeping-env.mjs <worker.env> <pages.env> <source-root> [inventory.env].')
}

const sourceRoot = fs.realpathSync(sourceInput)
const workerPrivate = privateFile(workerInput, sourceRoot, 'CRM_TIMEKEEPING_ENV_FILE')
const pagesPrivate = privateFile(pagesInput, sourceRoot, 'PONTO_PAGES_ENV_FILE')
const inventoryPrivate = inventoryInput
  ? privateFile(inventoryInput, sourceRoot, 'CRM_INVENTORY_IDENTITY_ENV_FILE')
  : null
const workerFile = workerPrivate.path
const pagesFile = pagesPrivate.path
if (workerFile === pagesFile) fail('Worker e Pages devem usar arquivos privados separados.')
if (inventoryPrivate && [workerFile, pagesFile].includes(inventoryPrivate.path)) {
  fail('Inventory deve usar um arquivo privado separado de Worker e Pages.')
}

const worker = parseEnv(workerFile, WORKER_BINDINGS, 'CRM_TIMEKEEPING_ENV_FILE')
const pages = parseEnv(pagesFile, PAGES_BINDINGS, 'PONTO_PAGES_ENV_FILE')
const inventory = inventoryPrivate
  ? parseEnv(inventoryPrivate.path, INVENTORY_BINDINGS, 'CRM_INVENTORY_IDENTITY_ENV_FILE')
  : null
const workerUnique = new Set(WORKER_BINDINGS.map((key) => worker.get(key)))
if (workerUnique.size !== WORKER_BINDINGS.length) {
  fail('Os bindings críticos do Worker devem usar valores locais independentes.')
}
for (const binding of ['PONTO_ACTOR_HMAC_KEY', 'PONTO_NETWORK_CONTEXT_KEY']) {
  if (pages.get(binding) !== worker.get(binding)) {
    fail(`${binding} deve coincidir entre os arquivos privados de Pages e Worker.`)
  }
}
const derivedReleaseProbeKey = createHmac('sha256', worker.get('PONTO_IDEMPOTENCY_KEY'))
  .update('skincos/ponto/release-probe/v1')
  .digest('base64url')
if (pages.get('PONTO_RELEASE_PROBE_HMAC_KEY') !== derivedReleaseProbeKey) {
  fail('PONTO_RELEASE_PROBE_HMAC_KEY deve ser derivada do PONTO_IDEMPOTENCY_KEY pelo domínio de release probe.')
}
if (inventory && inventory.get('IDENTITY_WORKFORCE_HMAC_KEY') !== worker.get('IDENTITY_WORKFORCE_HMAC_KEY')) {
  fail('IDENTITY_WORKFORCE_HMAC_KEY deve coincidir entre os arquivos privados de Inventory e Worker.')
}

process.stdout.write(JSON.stringify({
  ok: true,
  workerBindings: WORKER_BINDINGS,
  pagesBindings: PAGES_BINDINGS,
  inventoryBindings: inventory ? INVENTORY_BINDINGS : [],
  permissionModels: [...new Set([
    workerPrivate.permissionModel,
    pagesPrivate.permissionModel,
    inventoryPrivate?.permissionModel,
  ].filter(Boolean))],
}) + '\n')
