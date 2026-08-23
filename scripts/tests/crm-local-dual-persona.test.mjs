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

const expectedGestorModules = [
  'insumos',
  'conversa',
  'atendimento',
  'ponto',
  'clientes',
  'caixa',
  'faturamento',
  'procedimentos',
  'unit-monitor',
  'instagram-studio',
  'meta-pages-review',
  'meta-ads',
  'site-tracking',
  'escala-profissionais',
]

function tomlActions(source) {
  return source.split('[[actions]]').slice(1).map((block) => ({
    name: block.match(/^name = "([^"]+)"/m)?.[1],
    command: block.match(/^command = "([^"]+)"/m)?.[1],
  }))
}

test('Codex App and Windows expose CRM – Local and CRM – Módulos without the generic Local surface', () => {
  const crmActions = tomlActions(environment).filter(({ name }) => name?.startsWith('CRM'))
  assert.deepEqual(crmActions, [
    {
      name: 'CRM – Local',
      command: 'powershell.exe -ExecutionPolicy Bypass -File .\\\\scripts\\\\run-shared-codex-shortcut.ps1 -Action CrmLocal',
    },
    {
      name: 'CRM – Módulos',
      command: 'powershell.exe -ExecutionPolicy Bypass -File .\\\\scripts\\\\run-shared-codex-shortcut.ps1 -Action CrmModules',
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

test('canonical catalog exposes exactly 14 Gestor and 2 Consultor combinations', () => {
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
  assert.equal(catalog.combinations.length, 16)
  assert.ok(!catalog.combinations.some(({ module }) => module === 'finance'))

  for (const spec of catalog.combinations) {
    assert.equal(spec.route, `/?module=${encodeURIComponent(spec.module)}`)
    assert.equal(spec.runtimeId, `crm-local--${spec.module}--${spec.roleKey.toLowerCase()}`)
    assert.match(spec.configFingerprint, /^sha256:[a-f0-9]{64}$/)
  }
  assert.equal(new Set(catalog.combinations.map(({ runtimeId }) => runtimeId)).size, 16)
  assert.equal(new Set(catalog.combinations.map(({ configFingerprint }) => configFingerprint)).size, 16)
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

test('launcher assigns each role/module its own runtime, state, gate and browser paths', () => {
  assert.match(launcher, /\$crmInstanceRoot = Join-Path \$operatorRuntimeRoot "runtime\\crm-local\\instances"/)
  assert.match(launcher, /return Join-Path \$crmInstanceRoot \(Join-Path \$roleSegment \$moduleSegment\)/)
  assert.match(launcher, /Join-Path \$runtimeRoot "state\\pages"/)
  assert.match(launcher, /Join-Path \$runtimeRoot "state\\insumos"/)
  assert.match(launcher, /Join-Path \$runtimeRoot "state\\timekeeping"/)
  assert.match(launcher, /Join-Path \$runtimeRoot "state\\whatsapp"/)
  for (const contract of [
    'CRM_RUNTIME_ID={0}',
    'CRM_RUNTIME_MODULE={1}',
    'CRM_RUNTIME_CONFIG_FINGERPRINT={6}',
    'CRM_BUILD_STATE_FILE={8}',
    'CRM_BUILD_LOCK_DIR={9}',
    'CRM_BROWSER_PROFILE_DIR={11}',
    'CRM_LOCAL_ISOLATED=1',
    'CRM_GATE_STRICT=1',
    'CRM_GATE_MODULES={32}',
  ]) {
    assert.ok(launcher.includes(contract), `missing modular launch contract ${contract}`)
  }
  assert.match(launcher, /Start-CrmInstanceBackgroundUpdate -Spec \$spec -TargetCommit \$targetCommit/)
  assert.match(launcher, /Atualizando somente \$\(\[string\]\$spec\.runtimeId\)/)
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
  const helper = path.join(root, 'scripts', 'crm-local-persona-runtime.sh')
  const target = '5'.repeat(40)
  const body = `set -e
source "$1"
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
crm_persona_runtime_write_manifest ready`
  const result = spawnSync('bash', ['-c', body, 'bash', helper], {
    encoding: 'utf8',
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

test('runtime lock binds PID, Linux start ticks and runtime ID, then self-heals stale ownership', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-runtime-lock-v3-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const helper = path.join(root, 'scripts', 'crm-local-persona-runtime.sh')
  const body = `set -e
source "$1"
crm_persona_runtime_init
mkdir -p "$CRM_RUNTIME_LOCK_DIR"
printf '%s\\n' "$$" > "$CRM_RUNTIME_LOCK_DIR/pid"
current_ticks="$(crm_runtime_pid_start_ticks "$$")"
printf '%s\\n' "$((current_ticks + 1))" > "$CRM_RUNTIME_LOCK_DIR/start-ticks"
printf '%s\\n' "$CRM_RUNTIME_ID" > "$CRM_RUNTIME_LOCK_DIR/runtime-id"
crm_persona_runtime_acquire_lock
test "$CRM_RUNTIME_LOCK_HELD" = 1
test "$(cat "$CRM_RUNTIME_LOCK_DIR/pid")" = "$$"
test "$(cat "$CRM_RUNTIME_LOCK_DIR/start-ticks")" = "$current_ticks"
test "$(cat "$CRM_RUNTIME_LOCK_DIR/runtime-id")" = "$CRM_RUNTIME_ID"
crm_persona_runtime_release_lock
test ! -e "$CRM_RUNTIME_LOCK_DIR"`
  const result = spawnSync('bash', ['-c', body, 'bash', helper], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ROOT_DIR: root,
      CRM_RUNTIME_ROOT: temp,
      CRM_RUNTIME_ID: 'crm-local--ponto--consultor',
      CRM_RUNTIME_MODULE: 'ponto',
      CRM_PERSONA: 'CONSULTOR',
    },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
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
})

test('browser and Pages state remain inside the private role/module runtime', () => {
  assert.match(launcher, /\$expectedProfile = Join-Path \$runtimeRoot "browser\\profile"/)
  assert.match(launcher, /open-crm-local-browser\.ps1"\) -Url \$url -ProfilePath \$expectedProfile/)
  assert.match(browserLauncher, /\$privateRuntimeRoot = \[IO\.Path\]::GetFullPath\('C:\\CodexRuntime\\operator\\admin\\skincos'\)/)
  assert.match(browserLauncher, /--user-data-dir=/)
  assert.match(browserLauncher, /\$loopbackHost -notin @\('localhost', '127\.0\.0\.1', '::1'\)/)
  assert.match(crmRunner, /CRM_BROWSER_SCRIPT.*-ProfilePath "\$browser_profile_windows"/s)
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
