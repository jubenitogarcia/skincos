import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { decideRuntimeAction } from '../crm-local-runtime-policy.mjs'

const require = createRequire(import.meta.url)
const { partitionModuleErrors } = require('../../crm/console/scripts/crm-local-smoke-policy.cjs')

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
  assert.doesNotMatch(launcher, /CRM_ROUTE='\/\?localAuthReset=1'/)
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
  for (const contract of ['CRM_RUNTIME_MANIFEST', 'CRM_RUNTIME_LOCK_DIR', 'CRM_BUILD_STATE_FILE', 'CRM_TARGET_COMMIT']) {
    assert.ok(runtime.includes(contract), `missing ${contract}`)
  }
  assert.match(runtime, /targetCommit: process\.env\.CRM_RUNTIME_TARGET_COMMIT/)
  assert.match(runtime, /buildCommit: process\.env\.CRM_RUNTIME_BUILD_COMMIT/)
  assert.match(runtime, /CRM_BUILD_COMMIT="\$CRM_TARGET_COMMIT"/)
  assert.match(runtime, /timekeeping: enabled\(process\.env\.CRM_WITH_TIMEKEEPING\)/)
})

test('persona runtime exposes the loopback-aware port preflight used by the CRM launcher', () => {
  assert.match(runtime, /crm_runtime_port_is_free\(\)/)
  assert.match(runtime, /lsof -nP -iTCP:"\$port" -sTCP:LISTEN/)
  assert.match(runtime, /curl -sS --connect-timeout 1 --max-time 1/)
  assert.match(crmRunner, /if crm_runtime_port_is_free "\$port"; then/)
})

test('opening the browser never blocks the runtime manifest transition', () => {
  assert.match(crmRunner, /open \"\$DEFAULT_URL\" >\/dev\/null 2>&1 &/)
  assert.match(crmRunner, /xdg-open \"\$DEFAULT_URL\" >\/dev\/null 2>&1 &/)
})

test('runtime policy reuses only a healthy build from the target commit', () => {
  const target = 'a'.repeat(40)
  const current = {
    manifest: { persona: 'GESTOR', state: 'ready', targetCommit: target, buildCommit: target },
    buildState: { commit: target }, targetCommit: target, persona: 'GESTOR', pidAlive: true, healthy: true,
  }
  assert.deepEqual(decideRuntimeAction(current), { action: 'reuse', reason: 'current_runtime_ready' })
  assert.deepEqual(decideRuntimeAction({ ...current, healthy: false }), { action: 'restart', reason: 'health_failed' })
  assert.deepEqual(decideRuntimeAction({ ...current, pidAlive: false }), { action: 'restart', reason: 'launcher_dead' })
  assert.deepEqual(decideRuntimeAction({ ...current, manifest: { ...current.manifest, buildCommit: 'b'.repeat(40) } }), {
    action: 'restart', reason: 'commit_outdated',
  })
})

test('runtime policy starts missing state and waits for the same target build', () => {
  const target = 'c'.repeat(40)
  assert.deepEqual(decideRuntimeAction({ manifest: null, targetCommit: target, persona: 'CONSULTOR' }), {
    action: 'start', reason: 'manifest_missing',
  })
  assert.deepEqual(decideRuntimeAction({
    manifest: { persona: 'CONSULTOR', state: 'starting', targetCommit: target },
    targetCommit: target, persona: 'CONSULTOR', pidAlive: true, healthy: false,
  }), { action: 'wait', reason: 'current_start_in_progress' })
})

test('launcher coordinates version checks before checkout and preserves dirty private worktrees', () => {
  assert.match(launcher, /Get-CrmPersonaDecision -Persona \$Persona -TargetCommit \$TargetCommit/)
  assert.match(launcher, /Stop-CrmPersonaRuntime -Persona \$Persona/)
  assert.match(launcher, /Sync-CrmLocalSourceRoot -Persona \$Persona -TargetCommit \$TargetCommit/)
  assert.match(launcher, /Worktree privado com alterações preservado/)
  assert.match(launcher, /Ensure-CrmGestorForConsultor -TargetCommit \$targetCommit/)
  assert.match(launcher, /Start-CrmGestorBackgroundUpdate/)
})

test('a concurrent launcher reports an active runtime with a reusable status', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-runtime-lock-'))
  const helper = path.join(root, 'scripts', 'crm-local-persona-runtime.sh')
  const command = `ROOT_DIR=${JSON.stringify(root)} CRM_RUNTIME_ROOT=${JSON.stringify(temp)} CRM_PERSONA=GESTOR bash -c 'source ${JSON.stringify(helper)}; crm_persona_runtime_init; mkdir -p "$CRM_RUNTIME_LOCK_DIR"; printf "%s\\n" "$$" > "$CRM_RUNTIME_LOCK_DIR/pid"; crm_persona_runtime_acquire_lock; test "$?" = 2'`
  const result = spawnSync('bash', ['-lc', command], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /Runtime de GESTOR já está ativo/)
})

test('runtime manifest records the exact target and built commits', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-runtime-manifest-'))
  const helper = path.join(root, 'scripts', 'crm-local-persona-runtime.sh')
  const target = 'd'.repeat(40)
  const built = 'e'.repeat(40)
  const body = `source "$1"
crm_persona_runtime_init
CRM_BUILD_COMMIT=${built}
DEFAULT_URL=http://localhost:8791/
LOG_FILE="$CRM_RUNTIME_ROOT/runtime.log"
CRM_PAGES_PORT=8791 CRM_VITE_PORT=5173 CRM_WITH_INSUMOS=1 CRM_INSUMOS_PORT=8787
CRM_WITH_TIMEKEEPING=1 CRM_TIMEKEEPING_PORT=8801 CRM_WITH_WHATSAPP=1 CRM_WA_ORCHESTRATOR_PORT=8110
crm_persona_runtime_write_manifest ready`
  const result = spawnSync('bash', ['-c', body, 'bash', helper], {
    encoding: 'utf8',
    env: { ...process.env, ROOT_DIR: root, CRM_RUNTIME_ROOT: temp, CRM_PERSONA: 'GESTOR', CRM_TARGET_COMMIT: target },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const manifest = JSON.parse(fs.readFileSync(path.join(temp, 'current.json'), 'utf8'))
  assert.equal(manifest.version, 2)
  assert.equal(manifest.targetCommit, target)
  assert.equal(manifest.buildCommit, built)
})

test('local smoke downgrades only the exact optional Google chart credential failure', () => {
  const optional = {
    status: 500,
    url: 'http://localhost:8791/api/atendimento/management/charts?tab=Comercial',
    body: '{"ok":false,"error":"No key or keyFile set."}',
  }
  const genericConsole = 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)'
  const accepted = partitionModuleErrors('faturamento', [optional], [genericConsole])
  assert.equal(accepted.apiErrors.length, 0)
  assert.equal(accepted.apiWarnings.length, 1)
  assert.equal(accepted.consoleErrors.length, 0)
  assert.equal(accepted.consoleWarnings.length, 1)

  for (const changed of [
    { ...optional, status: 502 },
    { ...optional, url: 'http://localhost:8791/api/atendimento/management/finance' },
    { ...optional, body: '{"ok":false,"error":"DATABASE_URL missing"}' },
  ]) {
    assert.equal(partitionModuleErrors('faturamento', [changed], []).apiErrors.length, 1)
  }
  assert.equal(partitionModuleErrors('atendimento', [optional], []).apiErrors.length, 1)
})
