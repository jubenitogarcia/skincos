import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { discoverLocalLaunchCatalog } from '../crm-local-module-catalog.mjs'
import { decideRuntimeAction } from '../crm-local-runtime-policy.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const launcher = read('scripts/run-shared-codex-shortcut.ps1')
const crmRunner = read('scripts/run-local-crm.sh')
const runtime = read('scripts/crm-local-persona-runtime.sh')
const buildStateHelper = read('scripts/crm-local-build-state.mjs')
const browserLauncher = read('scripts/open-crm-local-browser.ps1')
const pagesRunner = read('crm/console/scripts/dev_pages.sh')
const environment = read('.codex/environments/environment.toml')
const installer = read('scripts/install-shared-codex-shortcuts.ps1')
const moduleCatalog = JSON.parse(read('crm/console/modules/localLaunchCatalog.json'))
const rolePolicy = JSON.parse(read('crm/console/modules/localRolePolicy.json'))
const catalog = discoverLocalLaunchCatalog()

const expectedGestorModules = moduleCatalog.modules.map(({ key }) => key)

function tomlActions(source) {
  return source.split('[[actions]]').slice(1).map((block) => ({
    name: block.match(/^name = "([^"]+)"/m)?.[1],
    command: block.match(/^command = "([^"]+)"/m)?.[1],
  }))
}

function runBashHarness(body, options = {}) {
  const harnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-local-bash-harness-'))
  const harnessPath = path.join(harnessRoot, 'run.sh')
  try {
    fs.writeFileSync(harnessPath, `${body}\n`, { mode: 0o700 })
    return spawnSync('bash', [harnessPath], {
      ...options,
      cwd: root,
      encoding: 'utf8',
    })
  } finally {
    fs.rmSync(harnessRoot, { recursive: true, force: true })
  }
}

test('Codex App and Windows expose CRM – Local and CRM – Módulos without the generic Local surface', () => {
  const crmActions = tomlActions(environment).filter(({ name }) => name?.startsWith('CRM'))
  assert.deepEqual(crmActions, [
    {
      name: 'CRM – Local',
      command: 'powershell.exe -ExecutionPolicy Bypass -File ./scripts/run-shared-codex-shortcut.ps1 -Action CrmLocal',
    },
    {
      name: 'CRM – Módulos',
      command: 'powershell.exe -ExecutionPolicy Bypass -File ./scripts/run-shared-codex-shortcut.ps1 -Action CrmModules',
    },
  ])
  assert.ok(!tomlActions(environment).some(({ name }) => name === 'Local'))
  assert.doesNotMatch(environment, /CRM – Local \(Gestor\)|CRM – Consultor \(Ponto\)/)

  const shortcutBlock = installer.match(/\$shortcuts = @\(([\s\S]*?)\r?\n\)/)?.[1]
  assert.ok(shortcutBlock, 'top-level Windows shortcut list was not found')
  const crmShortcuts = [...shortcutBlock.matchAll(/@\{ Name = "(CRM[^"]+)"; Action = "([^"]+)"/g)]
    .map((match) => ({ name: match[1], action: match[2] }))
  assert.deepEqual(crmShortcuts, [
    { name: 'CRM – Local', action: 'CrmLocal' },
    { name: 'CRM – Módulos', action: 'CrmModules' },
  ])
  assert.doesNotMatch(shortcutBlock, /Name = "Local"|CRM – Local \(Gestor\)|CRM – Consultor \(Ponto\)/)
  assert.match(installer, /\$moduleRoot = Join-Path \$TargetRoot "CRM – Módulos"/)
  assert.match(installer, /foreach \(\$spec in @\(\$catalog\.combinations\)\)/)
  assert.match(installer, /-Action CrmModule -CrmRole "\{1\}" -CrmModule "\{2\}"/)
})

test('canonical catalog exposes every catalog and role-policy combination', () => {
  assert.deepEqual(moduleCatalog.modules.map(({ key }) => key), expectedGestorModules)
  assert.deepEqual(rolePolicy.restrictedRoleModules.CONSULTOR, ['atendimento', 'ponto'])
  assert.deepEqual(catalog.roles, [
    { role: 'Gestor', roleKey: 'GESTOR' },
    { role: 'Consultor', roleKey: 'CONSULTOR' },
  ])

  const gestor = catalog.combinations.filter(({ roleKey }) => roleKey === 'GESTOR')
  const consultor = catalog.combinations.filter(({ roleKey }) => roleKey === 'CONSULTOR')
  assert.deepEqual(gestor.map(({ module }) => module), expectedGestorModules)
  assert.deepEqual(consultor.map(({ module }) => module), ['atendimento', 'ponto'])
  const expectedCombinationCount = expectedGestorModules.length +
    rolePolicy.restrictedRoleModules.CONSULTOR.length
  assert.equal(catalog.combinations.length, expectedCombinationCount)
  assert.ok(!catalog.combinations.some(({ module }) => module === 'finance'))

  for (const spec of catalog.combinations) {
    assert.equal(spec.route, `/?module=${encodeURIComponent(spec.module)}`)
    assert.equal(spec.runtimeId, `crm-local--${spec.module}--${spec.roleKey.toLowerCase()}`)
    assert.match(spec.configFingerprint, /^sha256:[a-f0-9]{64}$/)
  }
  assert.equal(new Set(catalog.combinations.map(({ runtimeId }) => runtimeId)).size, expectedCombinationCount)
  assert.equal(new Set(catalog.combinations.map(({ configFingerprint }) => configFingerprint)).size, expectedCombinationCount)
  assert.equal(catalog.fullRuntime.runtimeId, 'gestor--full')
  assert.equal(catalog.fullRuntime.module, 'full')
  assert.equal(catalog.fullRuntime.roleKey, 'GESTOR')
  assert.deepEqual(catalog.fullRuntime.gateModules, expectedGestorModules)
  assert.match(catalog.fullRuntime.configFingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.equal(catalog.fullRuntime.launcherContractFingerprint, catalog.launcherContractFingerprint)

  const changedContract = discoverLocalLaunchCatalog({
    launcherContractFingerprint: `sha256:${'0'.repeat(64)}`,
  })
  assert.notEqual(changedContract.fullRuntime.configFingerprint, catalog.fullRuntime.configFingerprint)
})

test('catalog CLI filters valid combinations and rejects role/module combinations outside policy', () => {
  const cli = path.join(root, 'scripts', 'crm-local-module-catalog.mjs')
  const valid = spawnSync(process.execPath, [cli, '--role', 'CONSULTOR', '--module', 'ponto', '--compact'], {
    encoding: 'utf8',
  })
  assert.equal(valid.status, 0, valid.stderr || valid.stdout)
  const result = JSON.parse(valid.stdout)
  assert.equal(result.combinations.length, 1)
  assert.equal(result.combinations[0].runtimeId, 'crm-local--ponto--consultor')

  const invalid = spawnSync(process.execPath, [cli, '--role', 'CONSULTOR', '--module', 'insumos', '--compact'], {
    encoding: 'utf8',
  })
  assert.equal(invalid.status, 2)
  assert.match(invalid.stderr, /CRM_LOCAL_COMBINATION_NOT_AVAILABLE/)
})

test('all module/role instances have non-overlapping deterministic ports', () => {
  const allocated = []
  for (const [index, spec] of catalog.combinations.entries()) {
    const start = catalog.portPlan.base + (index * catalog.portPlan.stride)
    assert.equal(spec.ports.pages, start + catalog.portPlan.offsets.pages)
    assert.equal(spec.ports.vite, start + catalog.portPlan.offsets.vite)
    for (const dependency of ['insumos', 'timekeeping', 'whatsapp']) {
      const expected = spec.dependencies[dependency]
        ? start + catalog.portPlan.offsets[dependency]
        : null
      assert.equal(spec.ports[dependency], expected, `${spec.runtimeId}:${dependency}`)
    }
    allocated.push(...Object.values(spec.ports).filter(Number.isInteger))
  }
  assert.equal(new Set(allocated).size, allocated.length)
})

test('CRM – Módulos consumes the canonical role field and launches only a resolved specification', () => {
  assert.match(launcher, /function Get-CrmLocalModuleCatalog/)
  assert.match(launcher, /crm-local-module-catalog\.mjs/)
  assert.match(launcher, /function Resolve-CrmLocalModuleSpec/)
  assert.match(launcher, /A combinação CRM '\$Role \/ \$Module' não é liberada pela fonte canônica/)
  assert.match(launcher, /New-MenuOption -Label \(\[string\]\$_\.role\) -Action \(\[string\]\$_\.role\)/)
  assert.match(launcher, /Invoke-CrmModuleAction -Role \$selectedRole -Module \(\[string\]\$moduleSelection\.Action\)/)
})

test('launcher derives local auth grants from the canonical role policy', () => {
  assert.match(launcher, /\$localAuthAdmin = if \(\[bool\]\$Spec\.auth\.testUserAdmin\)/)
  assert.match(launcher, /\$allowedModules = @\(\$Spec\.auth\.allowedModules\) -join ","/)
  assert.match(
    launcher,
    /\$consultorSpec = Resolve-CrmLocalModuleSpec -Role Consultor -Module "ponto" -SourceRoot \$SourceRoot/,
  )
  assert.match(launcher, /\$consultorAllowedModules = @\(\$consultorSpec\.auth\.allowedModules\) -join ","/)
  assert.doesNotMatch(launcher, /LOCAL_AUTH_ALLOWED_MODULES=atendimento,ponto/)
})

test('launcher assigns each role/module its own runtime, state, gate and browser paths', () => {
  assert.match(launcher, /\$crmInstanceRoot = Join-Path \$operatorRuntimeRoot "runtime\\crm-local\\instances"/)
  assert.match(launcher, /return Join-Path \$crmInstanceRoot \(Join-Path \$roleSegment \$moduleSegment\)/)
  assert.match(launcher, /Join-Path \$runtimeRoot "state\\pages"/)
  assert.match(launcher, /Join-Path \$runtimeRoot "state\\insumos"/)
  assert.match(launcher, /Join-Path \$runtimeRoot "state\\timekeeping"/)
  assert.match(launcher, /Join-Path \$runtimeRoot "state\\whatsapp"/)
  for (const contract of [
    '"CRM_RUNTIME_ID=$([string]$Spec.runtimeId)"',
    '"CRM_RUNTIME_MODULE=$module"',
    '"CRM_RUNTIME_CONFIG_FINGERPRINT=$([string]$Spec.configFingerprint)"',
    '"CRM_BUILD_STATE_FILE=$buildStateWsl"',
    '"CRM_BUILD_LOCK_DIR=$buildLockWsl"',
    '"CRM_BROWSER_PROFILE_DIR=$browserProfileWsl"',
    '"CRM_LOCAL_ISOLATED=1"',
    '"CRM_GATE_STRICT=1"',
    '"CRM_GATE_MODULES=$gateModules"',
  ]) {
    assert.ok(launcher.includes(contract), `missing modular launch contract ${contract}`)
  }
  assert.match(launcher, /Start-CrmInstanceBackgroundUpdate -Spec \$spec -TargetCommit \$targetCommit/)
  assert.match(launcher, /Atualizando somente \$\(\[string\]\$spec\.runtimeId\)/)
  assert.match(launcher, /Local\\SkincosCrmBuildDescriptor-\$descriptorKey/)
  assert.match(launcher, /\$mutex\.WaitOne\(\[TimeSpan\]::FromMinutes\(10\)\)/)
})

test('runtime policy reuses only the exact v3 module, configuration and build', () => {
  const target = 'a'.repeat(40)
  const expected = {
    targetCommit: target,
    sourceFingerprint: `snapshot:${target}:${'b'.repeat(64)}`,
    sourceOrigin: 'C:/CodexRuntime/operator/admin/skincos/source/crm-local/immutable/a1',
    persona: 'GESTOR',
    runtimeId: 'crm-local--atendimento--gestor',
    module: 'atendimento',
    configFingerprint: `sha256:${'c'.repeat(64)}`,
    buildInputFingerprint: `sha256:${'d'.repeat(64)}`,
    lockfileFingerprint: `sha256:${'e'.repeat(64)}`,
    artifactFingerprint: `sha256:${'f'.repeat(64)}`,
    pidAlive: true,
    healthy: true,
  }
  const manifest = {
    version: 3,
    state: 'ready',
    persona: expected.persona,
    runtimeId: expected.runtimeId,
    module: expected.module,
    targetCommit: target,
    buildCommit: target,
    sourceFingerprint: expected.sourceFingerprint,
    sourceOrigin: expected.sourceOrigin,
    configFingerprint: expected.configFingerprint,
    build: {
      inputFingerprint: expected.buildInputFingerprint,
      lockfileFingerprint: expected.lockfileFingerprint,
      artifactFingerprint: expected.artifactFingerprint,
    },
  }
  const current = { ...expected, manifest }

  assert.deepEqual(decideRuntimeAction(current), { action: 'reuse', reason: 'current_runtime_ready' })
  for (const [field, value, reason] of [
    ['runtimeId', 'crm-local--ponto--gestor', 'runtime_id_mismatch'],
    ['module', 'ponto', 'module_mismatch'],
    ['configFingerprint', `sha256:${'1'.repeat(64)}`, 'runtime_config_outdated'],
    ['buildInputFingerprint', `sha256:${'2'.repeat(64)}`, 'build_inputs_outdated'],
    ['lockfileFingerprint', `sha256:${'3'.repeat(64)}`, 'dependencies_outdated'],
    ['artifactFingerprint', `sha256:${'4'.repeat(64)}`, 'artifact_outdated'],
  ]) {
    assert.deepEqual(decideRuntimeAction({ ...current, [field]: value }), { action: 'restart', reason })
  }
  assert.deepEqual(decideRuntimeAction({ ...current, pidAlive: false }), {
    action: 'restart',
    reason: 'launcher_dead',
  })
  assert.deepEqual(decideRuntimeAction({ ...current, healthy: false }), {
    action: 'restart',
    reason: 'health_failed',
  })
})

test('full CRM propagates its catalog-derived runtime contract through policy and launch', () => {
  assert.doesNotMatch(launcher, /CRM_RUNTIME_CONFIG_FINGERPRINT=full-v2/)
  assert.match(launcher, /return \[string\]\$catalog\.fullRuntime\.configFingerprint/)
  assert.match(launcher, /function Test-CrmTimekeepingReadinessEndpoint/)
  assert.match(launcher, /'x-skincos-gateway-release-sha' = \$TargetCommit/)
  assert.match(launcher, /'x-skincos-gateway-environment' = 'local'/)
  assert.match(launcher, /Test-CrmTimekeepingReadinessEndpoint[\s\S]*?-TargetCommit \(\[string\]\$Manifest\.targetCommit\)/)
  assert.match(launcher, /"--runtime-id", \$RuntimeId/)
  assert.match(launcher, /"--module", \$Module/)
  assert.match(launcher, /"--config-fingerprint", \$ConfigFingerprint/)
  assert.match(
    launcher,
    /Get-CrmPersonaDecision[^\r\n]+-RuntimeId \$runtimeId -Module \$runtimeModule -ConfigFingerprint \$configFingerprint/,
  )
  assert.match(
    launcher,
    /"CRM_RUNTIME_ID=gestor--full"[\s\S]*?"CRM_RUNTIME_MODULE=full"[\s\S]*?"CRM_RUNTIME_CONFIG_FINGERPRINT=\$ConfigFingerprint"/,
  )
  assert.match(
    launcher,
    /Start-CrmPersonaRuntime[^\r\n]+-ConfigFingerprint \$configFingerprint/,
  )
  const personaAction = launcher.slice(
    launcher.indexOf('function Invoke-CrmPersonaAction'),
    launcher.indexOf('function Start-CrmGestorBackgroundUpdate'),
  )
  const candidateIndex = personaAction.indexOf(
    'Sync-CrmLocalSourceRoot -Persona $Persona -TargetCommit $TargetCommit -Snapshot $snapshot -Versioned',
  )
  const contractIndex = personaAction.indexOf('Assert-CrmLocalLauncherContract -SourceRoot $sourceRoot')
  const stopIndex = personaAction.indexOf('Stop-CrmPersonaRuntime -Persona $Persona')
  assert.ok(candidateIndex >= 0 && contractIndex > candidateIndex)
  assert.ok(stopIndex > contractIndex, 'the current full CRM must remain alive until the candidate contract passes')
})

test('auto build is fingerprinted, serialized and recorded only through the deterministic helper', () => {
  assert.match(crmRunner, /CRM_BUILD_BEFORE_START.*auto/s)
  assert.match(crmRunner, /node "\$BUILD_STATE_HELPER" inspect --root "\$ROOT_DIR" --state "\$CRM_BUILD_STATE_FILE"/)
  assert.match(crmRunner, /lock-acquire --lock-dir "\$CRM_BUILD_LOCK_DIR" --owner-pid "\$\$"/)
  assert.match(crmRunner, /lock-release --lock-dir "\$CRM_BUILD_LOCK_DIR" --token "\$CRM_BUILD_LOCK_TOKEN"/)
  assert.match(crmRunner, /if \[\[ "\$CRM_BUILD_BEFORE_START" == "auto" && "\$state_valid" == "true" \]\]/)
  assert.match(crmRunner, /npm --prefix "\$FRONTEND_DIR" ci --no-audit --no-fund/)
  assert.match(crmRunner, /node "\$BUILD_STATE_HELPER" state-write/)
  assert.doesNotMatch(crmRunner, /npm --prefix "\$FRONTEND_DIR" install/)
  for (const fingerprint of ['inputFingerprint', 'lockfileFingerprint', 'artifactFingerprint']) {
    assert.ok(buildStateHelper.includes(fingerprint), `missing ${fingerprint}`)
    assert.ok(runtime.includes(fingerprint), `manifest does not record ${fingerprint}`)
  }
})

test('runtime v3 manifest records role/module, build, PID identities, private state and browser profile', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-runtime-v3-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const target = '5'.repeat(40)
  const body = `set -e
source scripts/crm-local-persona-runtime.sh
crm_persona_runtime_init
CRM_BUILD_COMMIT=${target}
CRM_BUILD_INPUT_FINGERPRINT=sha256:${'6'.repeat(64)}
CRM_BUILD_LOCKFILE_FINGERPRINT=sha256:${'7'.repeat(64)}
CRM_BUILD_ARTIFACT_FINGERPRINT=sha256:${'8'.repeat(64)}
DEFAULT_URL=http://localhost:24020/?module=atendimento
LOG_FILE="$CRM_RUNTIME_ROOT/logs/runtime.log"
CRM_PAGES_PORT=24020 CRM_VITE_PORT=24021 CRM_WITH_INSUMOS=0 CRM_INSUMOS_PORT=24022
CRM_WITH_TIMEKEEPING=0 CRM_TIMEKEEPING_PORT=24023 CRM_WITH_WHATSAPP=1 CRM_WA_ORCHESTRATOR_PORT=24024
CRM_PID=$$
CRM_BROWSER_PROFILE_DIR="$CRM_RUNTIME_ROOT/browser/profile"
R2_PERSIST_DIR="$CRM_RUNTIME_ROOT/state/pages"
CRM_LOCAL_WA_RUNTIME_HOME="$CRM_RUNTIME_ROOT/state/whatsapp"
crm_persona_runtime_write_manifest ready
crm_persona_runtime_manifest_is_ready
CRM_RUNTIME_CONFIG_FINGERPRINT=sha256:${'a'.repeat(64)}
if crm_persona_runtime_manifest_is_ready; then
  echo "mismatched runtime configuration was accepted as ready" >&2
  exit 1
fi
CRM_RUNTIME_CONFIG_FINGERPRINT=sha256:${'9'.repeat(64)}
crm_persona_runtime_acquire_lock
set +e
crm_persona_runtime_acquire_lock
contention_status="$?"
set -e
test "$contention_status" = 2
crm_persona_runtime_wait_ready 1
sleep 10 &
stale_pid="$!"
stale_ticks="$(crm_runtime_pid_start_ticks "$stale_pid")"
node - "$CRM_RUNTIME_MANIFEST" "$stale_pid" "$stale_ticks" <<'NODE'
const fs = require('fs')
const file = process.argv[2]
const value = JSON.parse(fs.readFileSync(file, 'utf8'))
value.pids.launcher = Number(process.argv[3])
value.pidStartTicks.launcher = Number(process.argv[4])
fs.writeFileSync(file, JSON.stringify(value) + '\\n')
NODE
if crm_persona_runtime_manifest_is_ready; then
  echo "ready manifest from another live launcher was accepted" >&2
  exit 1
fi
kill "$stale_pid"
wait "$stale_pid" 2>/dev/null || true
crm_persona_runtime_write_manifest ready
node - "$CRM_RUNTIME_LOCK_DIR/owner.json" <<'NODE'
const fs = require('fs')
const file = process.argv[2]
const value = JSON.parse(fs.readFileSync(file, 'utf8'))
value.token = 'successor-token'
fs.writeFileSync(file, JSON.stringify(value) + '\\n')
NODE
if crm_persona_runtime_manifest_is_ready; then
  echo "ready manifest from a replaced lock token was accepted" >&2
  exit 1
fi
CRM_LOCK_ORIGINAL_TOKEN="$CRM_RUNTIME_LOCK_TOKEN" node - "$CRM_RUNTIME_LOCK_DIR/owner.json" <<'NODE'
const fs = require('fs')
const file = process.argv[2]
const value = JSON.parse(fs.readFileSync(file, 'utf8'))
value.token = process.env.CRM_LOCK_ORIGINAL_TOKEN
fs.writeFileSync(file, JSON.stringify(value) + '\\n')
NODE
crm_persona_runtime_release_lock`
  const result = runBashHarness(body, {
    env: {
      ...process.env,
      ROOT_DIR: root,
      CRM_RUNTIME_ROOT: temp,
      CRM_RUNTIME_ID: 'crm-local--atendimento--gestor',
      CRM_RUNTIME_MODULE: 'atendimento',
      CRM_PERSONA: 'GESTOR',
      CRM_TARGET_COMMIT: target,
      CRM_SOURCE_FINGERPRINT: `commit:${target}`,
      CRM_SOURCE_ORIGIN: `${root}__crm-local--atendimento--gestor`,
      CRM_RUNTIME_CONFIG_FINGERPRINT: `sha256:${'9'.repeat(64)}`,
    },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)

  const manifest = JSON.parse(fs.readFileSync(path.join(temp, 'current.json'), 'utf8'))
  assert.equal(manifest.version, 3)
  assert.equal(manifest.runtimeId, 'crm-local--atendimento--gestor')
  assert.equal(manifest.module, 'atendimento')
  assert.equal(manifest.persona, 'GESTOR')
  assert.equal(manifest.targetCommit, target)
  assert.equal(manifest.buildCommit, target)
  assert.deepEqual(manifest.build, {
    inputFingerprint: `sha256:${'6'.repeat(64)}`,
    lockfileFingerprint: `sha256:${'7'.repeat(64)}`,
    artifactFingerprint: `sha256:${'8'.repeat(64)}`,
  })
  assert.ok(Number.isInteger(manifest.pids.launcher))
  assert.ok(Number.isInteger(manifest.pidStartTicks.launcher))
  assert.ok(Number.isInteger(manifest.pidStartTicks.pages))
  assert.equal(manifest.ports.pages, 24020)
  assert.equal(manifest.ports.whatsapp, 24024)
  assert.equal(manifest.ports.insumos, null)
  assert.equal(manifest.browserProfile, path.join(temp, 'browser/profile'))
  assert.equal(manifest.statePaths.pages, path.join(temp, 'state/pages'))
  assert.equal(manifest.statePaths.whatsapp, path.join(temp, 'state/whatsapp'))
})

test('a concurrent launch waits for the exact ready manifest before health checks or browser opening', () => {
  const lockBranch = crmRunner.match(
    /if \[\[ "\$runtime_lock_status" == "2" \]\]; then([\s\S]*?)\nfi\nif \[\[ "\$runtime_lock_status" != "0" \]\]/,
  )?.[1]
  assert.ok(lockBranch, 'runtime contention branch not found')
  const readyIndex = lockBranch.indexOf('crm_persona_runtime_wait_ready 360')
  const apiIndex = lockBranch.indexOf('wait_for_crm_api')
  const browserIndex = lockBranch.indexOf('open_browser')
  assert.ok(readyIndex >= 0)
  assert.ok(apiIndex > readyIndex)
  assert.ok(browserIndex > apiIndex)
  assert.match(runtime, /value\.state === 'ready'/)
  for (const expectedField of [
    'CRM_EXPECTED_RUNTIME_ID',
    'CRM_EXPECTED_MODULE',
    'CRM_EXPECTED_PERSONA',
    'CRM_EXPECTED_TARGET_COMMIT',
    'CRM_EXPECTED_SOURCE_FINGERPRINT',
    'CRM_EXPECTED_SOURCE_ORIGIN',
    'CRM_EXPECTED_CONFIG_FINGERPRINT',
  ]) {
    assert.ok(runtime.includes(expectedField), `ready identity does not bind ${expectedField}`)
  }
  assert.match(runtime, /CRM_RUNTIME_OBSERVED_LOCK_TOKEN/)
  assert.match(runtime, /"\$lock_token" == "\$CRM_RUNTIME_OBSERVED_LOCK_TOKEN"/)
  assert.match(runtime, /"\$owner_pid" == "\$lock_pid"/)
  assert.match(runtime, /crm_runtime_pid_identity_matches "\$owner_pid" "\$owner_ticks"/)
})

test('runtime lock publishes one atomic owner and self-heals only a proven stale identity', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-runtime-lock-v3-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const body = `set -e
source scripts/crm-local-persona-runtime.sh
crm_persona_runtime_init
mkdir -p "$CRM_RUNTIME_LOCK_DIR"
current_ticks="$(crm_runtime_pid_start_ticks "$$")"
node - "$CRM_RUNTIME_LOCK_DIR/owner.json" "$$" "$((current_ticks + 1))" "$CRM_RUNTIME_ID" <<'NODE'
const fs = require('fs')
fs.writeFileSync(process.argv[2], JSON.stringify({
  version: 1,
  token: 'stale-owner',
  pid: Number(process.argv[3]),
  startTicks: Number(process.argv[4]),
  runtimeId: process.argv[5],
  sourceFingerprint: process.env.CRM_SOURCE_FINGERPRINT,
  configFingerprint: process.env.CRM_RUNTIME_CONFIG_FINGERPRINT,
  createdAtEpoch: Math.floor(Date.now() / 1000),
}) + '\\n')
NODE
crm_persona_runtime_acquire_lock
test "$CRM_RUNTIME_LOCK_HELD" = 1
node - "$CRM_RUNTIME_LOCK_DIR/owner.json" "$$" "$current_ticks" "$CRM_RUNTIME_ID" <<'NODE'
const fs = require('fs')
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (value.version !== 1 || !value.token || value.pid !== Number(process.argv[3]) ||
    value.startTicks !== Number(process.argv[4]) || value.runtimeId !== process.argv[5] ||
    value.sourceFingerprint !== process.env.CRM_SOURCE_FINGERPRINT ||
    value.configFingerprint !== process.env.CRM_RUNTIME_CONFIG_FINGERPRINT) process.exit(1)
NODE
crm_persona_runtime_release_lock
test ! -e "$CRM_RUNTIME_LOCK_DIR"`
  const result = runBashHarness(body, {
    env: {
      ...process.env,
      ROOT_DIR: root,
      CRM_RUNTIME_ROOT: temp,
      CRM_RUNTIME_ID: 'crm-local--ponto--consultor',
      CRM_RUNTIME_MODULE: 'ponto',
      CRM_PERSONA: 'CONSULTOR',
      CRM_SOURCE_FINGERPRINT: `sha256:${'a'.repeat(64)}`,
      CRM_RUNTIME_CONFIG_FINGERPRINT: `sha256:${'b'.repeat(64)}`,
    },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('runtime lock never steals a live owner with another source and release is token-CAS', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-runtime-lock-cas-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const body = `set -e
source scripts/crm-local-persona-runtime.sh
crm_persona_runtime_init
mkdir -p "$CRM_RUNTIME_LOCK_DIR"
ticks="$(crm_runtime_pid_start_ticks "$$")"
node - "$CRM_RUNTIME_LOCK_DIR/owner.json" "$$" "$ticks" "$CRM_RUNTIME_ID" <<'NODE'
const fs = require('fs')
fs.writeFileSync(process.argv[2], JSON.stringify({
  version: 1,
  token: 'live-other-source',
  pid: Number(process.argv[3]),
  startTicks: Number(process.argv[4]),
  runtimeId: process.argv[5],
  sourceFingerprint: 'sha256:old',
  configFingerprint: process.env.CRM_RUNTIME_CONFIG_FINGERPRINT,
  createdAtEpoch: Math.floor(Date.now() / 1000),
}) + '\\n')
NODE
set +e
crm_persona_runtime_acquire_lock
status="$?"
set -e
test "$status" = 3
test "$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).token" "$CRM_RUNTIME_LOCK_DIR/owner.json")" = live-other-source
rm -f "$CRM_RUNTIME_LOCK_DIR/owner.json"
rmdir "$CRM_RUNTIME_LOCK_DIR"
crm_persona_runtime_acquire_lock
node - "$CRM_RUNTIME_LOCK_DIR/owner.json" <<'NODE'
const fs = require('fs')
const file = process.argv[2]
const value = JSON.parse(fs.readFileSync(file, 'utf8'))
value.token = 'successor-token'
fs.writeFileSync(file, JSON.stringify(value) + '\\n')
NODE
crm_persona_runtime_release_lock
test -d "$CRM_RUNTIME_LOCK_DIR"
test "$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).token" "$CRM_RUNTIME_LOCK_DIR/owner.json")" = successor-token`
  const result = runBashHarness(body, {
    env: {
      ...process.env,
      ROOT_DIR: root,
      CRM_RUNTIME_ROOT: temp,
      CRM_RUNTIME_ID: 'crm-local--atendimento--gestor',
      CRM_RUNTIME_MODULE: 'atendimento',
      CRM_PERSONA: 'GESTOR',
      CRM_SOURCE_FINGERPRINT: `sha256:${'c'.repeat(64)}`,
      CRM_RUNTIME_CONFIG_FINGERPRINT: `sha256:${'d'.repeat(64)}`,
    },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('runtime lock treats a fresh partial owner as contention instead of deleting it', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-runtime-lock-partial-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const body = `set -e
source scripts/crm-local-persona-runtime.sh
crm_persona_runtime_init
mkdir -p "$CRM_RUNTIME_LOCK_DIR"
set +e
crm_persona_runtime_acquire_lock
status="$?"
set -e
test "$status" = 1
test -d "$CRM_RUNTIME_LOCK_DIR"
test ! -e "$CRM_RUNTIME_LOCK_DIR/owner.json"`
  const result = runBashHarness(body, {
    env: {
      ...process.env,
      ROOT_DIR: root,
      CRM_RUNTIME_ROOT: temp,
      CRM_RUNTIME_ID: 'crm-local--insumos--gestor',
      CRM_RUNTIME_MODULE: 'insumos',
      CRM_PERSONA: 'GESTOR',
      CRM_RUNTIME_LOCK_PARTIAL_TTL: '5',
      CRM_RUNTIME_LOCK_WAIT_ATTEMPTS: '3',
    },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('PID identity reads start ticks correctly when Linux comm contains spaces and a parenthesis', () => {
  const body = `set -e
source scripts/crm-local-persona-runtime.sh
printf 'crm ) worker' > "/proc/$$/comm"
actual="$(crm_runtime_pid_start_ticks "$$")"
  expected="$(node -e 'const fs=require("fs");const s=fs.readFileSync("/proc/"+process.ppid+"/stat","utf8");const i=s.lastIndexOf(")");process.stdout.write(s.slice(i+2).trim().split(/\\s+/)[19])')"
test "$actual" = "$expected"
crm_runtime_pid_identity_matches "$$" "$expected"`
  const result = runBashHarness(body)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(launcher, /"pid-start-ticks", \$pidText/)
  assert.doesNotMatch(launcher, /awk '\{print `\$20\}'/)
})

test('immutable source and build cache are keyed by the exact source fingerprint', () => {
  assert.match(launcher, /function Sync-CrmLocalImmutableSourceRoot/)
  assert.match(launcher, /source\\crm-local\\immutable\\\{0\}/)
  assert.match(launcher, /Get-CrmLocalSnapshotHash -Value \(\[string\]\$Snapshot\.Fingerprint\)/)
  assert.match(launcher, /Local\\SkincosCrmSource-\$sourceKey/)
  assert.match(launcher, /não corresponde à impressão solicitada; ela não será alterada/)
  assert.match(launcher, /\$crmBuildCacheRoot = Join-Path \$operatorRuntimeRoot "cache\\crm-local\\builds"/)
  assert.match(launcher, /Get-CrmInstanceBuildPaths -SourceFingerprint/)
  assert.match(launcher, /\$sourceOrigin = "\{0\}__\{1\}" -f \$sourceRoot, \(\[string\]\$spec\.runtimeId\)/)
  assert.match(launcher, /Local\\SkincosCrmPersonaSource-\$\(\$Persona\.ToLowerInvariant\(\)\)/)
  assert.match(launcher, /function Assert-CrmLocalLauncherContract/)
  assert.match(launcher, /launcherContractFingerprint/)
  assert.match(launcher, /Assert-CrmLocalLauncherContract -SourceRoot \$sourceRoot/)
})

test('browser and Pages state remain inside the private role/module runtime', () => {
  assert.match(launcher, /\$expectedProfile = Join-Path \$runtimeRoot "browser\\profile"/)
  assert.match(launcher, /open-crm-local-browser\.ps1"\) -Url \$url -ProfilePath \$expectedProfile/)
  assert.match(browserLauncher, /\$privateRuntimeRoot = \[IO\.Path\]::GetFullPath\('C:\\CodexRuntime\\operator\\admin\\skincos'\)/)
  assert.match(browserLauncher, /--user-data-dir=/)
  assert.match(browserLauncher, /\$loopbackHost -notin @\('localhost', '127\.0\.0\.1', '::1'\)/)
  assert.match(crmRunner, /CRM_BROWSER_SCRIPT.*-ProfilePath "\$browser_profile_windows"/s)
  assert.match(launcher, /\$browserScriptWsl = Convert-WindowsPathToWsl -Path \(Join-Path \$SourceRoot "scripts\\open-crm-local-browser\.ps1"\)/)
  assert.match(launcher, /\[switch\]\$CrmRuntimeSuppressBrowser/)
  assert.match(launcher, /"CRM_OPEN_BROWSER=\$openBrowser"/)
  assert.match(launcher, /\$arguments \+= "-CrmRuntimeSuppressBrowser"/)
  assert.match(pagesRunner, /R2_PERSIST_DIR/)
  assert.match(pagesRunner, /--persist-to "\$R2_PERSIST_DIR"/)
})

test('legacy explicit actions remain compatible by delegating to the modular runtime', () => {
  const mappings = [
    ['CrmConsultor', 'Consultor', 'ponto'],
    ['CrmSiteEf', 'Gestor', 'site-tracking'],
    ['CrmMetaAds', 'Gestor', 'meta-ads'],
    ['CrmAtendimento', 'Gestor', 'atendimento'],
  ]
  for (const [action, role, module] of mappings) {
    const pattern = new RegExp(
      `"${action}"\\s*\\{\\s*Invoke-CrmModuleAction -Role ${role} -Module "${module}"`,
    )
    assert.match(launcher, pattern)
  }
  assert.match(launcher, /"CrmConsultorStop"\s*\{[\s\S]*Resolve-CrmLocalModuleSpec -Role Consultor -Module "ponto"/)
  assert.match(launcher, /"CrmModuleStop"\s*\{[\s\S]*Resolve-CrmLocalModuleSpec -Role \$CrmRole -Module \$CrmModule/)
})
