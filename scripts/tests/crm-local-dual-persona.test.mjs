import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const launcher = read('scripts/run-shared-codex-shortcut.ps1')
const crmRunner = read('scripts/run-local-crm.sh')
const runtime = read('scripts/crm-local-persona-runtime.sh')
const environment = read('.codex/environments/environment.toml')
const installer = read('scripts/install-shared-codex-shortcuts.ps1')

test('Codex and Windows actions expose both personas', () => {
  for (const label of ['CRM – Local (Gestor)', 'CRM – Consultor (Ponto)']) {
    assert.match(environment, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(installer, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('Gestor owns every shared service on the canonical ports', () => {
  assert.match(launcher, /CRM_PERSONA=GESTOR/)
  assert.match(launcher, /CRM_WITH_INSUMOS=1 CRM_WITH_TIMEKEEPING=1 CRM_WITH_WHATSAPP=1/)
  assert.match(crmRunner, /run-local-whatsapp-orchestrator\.sh/)
  for (const port of ['8791', '8787', '8801', '8110']) assert.match(launcher, new RegExp(port))
})

test('Consultor owns only its Pages and Vite runtime', () => {
  assert.match(launcher, /CRM_PERSONA=CONSULTOR/)
  assert.match(launcher, /CRM_VITE_PORT=5174 CRM_PAGES_PORT=8792/)
  assert.match(launcher, /CRM_WITH_INSUMOS=0 CRM_WITH_TIMEKEEPING=0 CRM_WITH_WHATSAPP=0/)
})

test('preflight validates role and each shared dependency', () => {
  assert.match(launcher, /Role = "GESTOR"/)
  for (const url of [
    'http://127.0.0.1:8791/api/auth/me',
    'http://127.0.0.1:8787/insumos/health',
    'http://127.0.0.1:8801/api/ponto/readiness',
    'http://127.0.0.1:8110/health',
  ]) assert.ok(launcher.includes(url), `missing ${url}`)
})

test('persona runtime records isolated manifest, lock and build state', () => {
  for (const contract of ['CRM_RUNTIME_MANIFEST', 'CRM_RUNTIME_LOCK_DIR', 'CRM_BUILD_STATE_FILE']) {
    assert.ok(runtime.includes(contract), `missing ${contract}`)
  }
  assert.match(runtime, /timekeeping: enabled\(process\.env\.CRM_WITH_TIMEKEEPING\)/)
})

test('opening the browser never blocks the runtime manifest transition', () => {
  assert.match(crmRunner, /open \"\$DEFAULT_URL\" >\/dev\/null 2>&1 &/)
  assert.match(crmRunner, /xdg-open \"\$DEFAULT_URL\" >\/dev\/null 2>&1 &/)
})
