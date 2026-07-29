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
const runtimePolicy = read('scripts/crm-local-runtime-policy.mjs')
const crmRunner = read('scripts/run-local-crm.sh')
const atendimentoRunner = read('scripts/run-local-atendimento.sh')
const runtime = read('scripts/crm-local-persona-runtime.sh')
const wslInvoker = read('scripts/invoke-skincos-wsl.ps1')
const pagesRunner = read('crm/console/scripts/dev_pages.sh')
const whatsappRunner = read('scripts/run-local-whatsapp-orchestrator.sh')
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

test('local Pages routes Atendimento to the isolated CRM adapter', () => {
  assert.match(pagesRunner, /ATENDIMENTO_API_TARGET=\$\{LOCAL_WA_ORCHESTRATOR_API_TARGET\}/)
  assert.match(pagesRunner, /must not fall back to the[\s\S]*native service on :8099/)
})

test('local CRM adapter uses only the peer-authenticated Atendimento mirror', () => {
  assert.match(whatsappRunner, /DEFAULT_DATABASE_URL="postgresql:\/\/\$\{RUN_AS_USER\}@\/skincos_crm_local\?host=\/var\/run\/postgresql"/)
  assert.match(whatsappRunner, /CRM_LOCAL_WA_DATABASE_URL deve apontar somente para o socket local/)
  assert.match(whatsappRunner, /export DATABASE_URL="\$LOCAL_WA_ADAPTER_DATABASE_URL"/)
})

test('Gestor warms Atendimento before the Pages gate can issue concurrent requests', () => {
  assert.match(crmRunner, /warm_atendimento_api\(\)/)
  assert.match(crmRunner, /x-crm-user: eyJpZCI6ImNybS1sb2NhbC1nYXRlIiwicm9sZSI6IkdFU1RPUiJ9/)
  assert.match(crmRunner, /\/api\/atendimento\/local-mirror\/status/)
  assert.match(crmRunner, /\/api\/atendimento\/management\/finance/)
  assert.match(crmRunner, /start_whatsapp_orchestrator_local\n  warm_atendimento_api/)
})

test('Atendimento shortcut uses the canonical isolated Pages and adapter runtime', () => {
  assert.match(atendimentoRunner, /run-local-crm\.sh/)
  assert.match(atendimentoRunner, /--module atendimento/)
  assert.match(atendimentoRunner, /CRM_WITH_WHATSAPP=1/)
  assert.match(atendimentoRunner, /CRM_LOCAL_NATIVE_SOURCE_ROOT/)
  assert.match(atendimentoRunner, /crm-local-preview-source/)
  assert.match(atendimentoRunner, /rsync -a --delete/)
  assert.doesNotMatch(atendimentoRunner, /node "\$CRM_API_DIR\/server\.js"/)
  assert.match(launcher, /Start-CrmAtendimentoRuntime/)
  assert.match(launcher, /Start-CrmAtendimentoBackgroundUpdate/)
  assert.match(launcher, /CrmAtendimentoDetachedStart/)
  assert.match(launcher, /Invoke-CrmAtendimentoAction/)
  assert.match(launcher, /Get-CrmPersonaDecision -Persona Gestor/)
  assert.match(launcher, /nativeAtendimentoSource/)
})

test('Atendimento startup proves the authenticated Pages proxy after warming the adapter', () => {
  assert.match(crmRunner, /verify_atendimento_proxy\(\)/)
  assert.match(crmRunner, /Verificando proxy autenticado de Atendimento/)
  assert.match(crmRunner, /http:\/\/127\.0\.0\.1:\$\{CRM_PAGES_PORT\}\$\{endpoint\}/)
  assert.match(crmRunner, /O proxy autenticado de Atendimento não ficou pronto/)
})

test('Atendimento reuse health follows the services declared by its manifest', () => {
  assert.match(launcher, /\$Manifest\.ports\.insumos/)
  assert.match(launcher, /\$Manifest\.ports\.timekeeping/)
  assert.match(launcher, /\$Manifest\.ports\.whatsapp/)
  assert.match(launcher, /Test-CrmPersonaHealth -Persona \$Persona -Manifest \$manifest/)
})

test('isolated preview installs frontend dependencies from the lockfile', () => {
  assert.match(crmRunner, /npm --prefix "\$FRONTEND_DIR" ci --no-audit --no-fund/)
  assert.doesNotMatch(crmRunner, /npm --prefix "\$FRONTEND_DIR" install/)
})

test('private CRM preview snapshots register only their trusted WSL worktree path', () => {
  assert.match(wslInvoker, /CodexRuntime\/operator\/admin\/skincos\/source/)
  assert.match(wslInvoker, /git config --global --add safe\.directory/)
  assert.match(wslInvoker, /arbitrary caller paths still fail/)
  assert.match(launcher, /Invoke-ShortcutWslNativePreview/)
  assert.match(launcher, /crm-local-preview-source/)
})

test('persona runtime records isolated manifest, lock and build state', () => {
  for (const contract of ['CRM_RUNTIME_MANIFEST', 'CRM_RUNTIME_LOCK_DIR', 'CRM_BUILD_STATE_FILE', 'CRM_TARGET_COMMIT', 'CRM_SOURCE_FINGERPRINT']) {
    assert.ok(runtime.includes(contract), `missing ${contract}`)
  }
  assert.match(runtime, /targetCommit: process\.env\.CRM_RUNTIME_TARGET_COMMIT/)
  assert.match(runtime, /buildCommit: process\.env\.CRM_RUNTIME_BUILD_COMMIT/)
  assert.match(runtime, /CRM_BUILD_COMMIT="\$CRM_TARGET_COMMIT"/)
  assert.match(runtime, /timekeeping: enabled\(process\.env\.CRM_WITH_TIMEKEEPING\)/)
})

test('opening the browser never blocks the runtime manifest transition', () => {
  assert.match(crmRunner, /open \"\$DEFAULT_URL\" >\/dev\/null 2>&1 &/)
  assert.match(crmRunner, /xdg-open \"\$DEFAULT_URL\" >\/dev\/null 2>&1 &/)
})

test('persona helper checks a free port before starting the CRM services', () => {
  const helper = path.join(root, 'scripts', 'crm-local-persona-runtime.sh')
  const result = spawnSync('bash', ['-lc', `source ${JSON.stringify(helper)}; crm_runtime_port_is_free 65530`], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('generic CRM launcher only falls back from its default Vite port', () => {
  assert.match(crmRunner, /CRM_VITE_PORT_EXPLICIT=1/)
  assert.match(crmRunner, /select_available_vite_port/)
  assert.match(crmRunner, /Porta Vite padrão \$preferred ocupada; usando \$candidate/)
})

test('runtime policy reuses only a healthy build from the exact source snapshot', () => {
  const target = 'a'.repeat(40)
  const sourceFingerprint = `snapshot:${target}:${'b'.repeat(64)}`
  const sourceOrigin = 'C:/CodexRuntime/operator/admin/skincos/source/selected__atendimento'
  const current = {
    manifest: { persona: 'GESTOR', state: 'ready', targetCommit: target, buildCommit: target, sourceFingerprint, sourceOrigin },
    buildState: { commit: target, sourceFingerprint, sourceOrigin }, targetCommit: target, sourceFingerprint, sourceOrigin, persona: 'GESTOR', pidAlive: true, healthy: true,
  }
  assert.deepEqual(decideRuntimeAction(current), { action: 'reuse', reason: 'current_runtime_ready' })
  assert.deepEqual(decideRuntimeAction({ ...current, healthy: false }), { action: 'restart', reason: 'health_failed' })
  assert.deepEqual(decideRuntimeAction({ ...current, pidAlive: false }), { action: 'restart', reason: 'launcher_dead' })
  assert.deepEqual(decideRuntimeAction({ ...current, manifest: { ...current.manifest, buildCommit: 'b'.repeat(40) } }), {
    action: 'restart', reason: 'commit_outdated',
  })
  assert.deepEqual(decideRuntimeAction({ ...current, sourceFingerprint: `snapshot:${target}:${'c'.repeat(64)}` }), {
    action: 'restart', reason: 'source_outdated',
  })
  assert.deepEqual(decideRuntimeAction({ ...current, targetCommit: 'f'.repeat(40) }), {
    action: 'restart', reason: 'commit_outdated',
  })
  assert.deepEqual(decideRuntimeAction({ ...current, sourceOrigin: `${sourceOrigin}-other-module` }), {
    action: 'restart', reason: 'source_origin_outdated',
  })
  assert.deepEqual(decideRuntimeAction({ ...current, sourceOrigin: 'C:\\CODEXRUNTIME\\operator\\admin\\skincos\\source\\selected__atendimento' }), {
    action: 'reuse', reason: 'current_runtime_ready',
  })
  assert.deepEqual(decideRuntimeAction({
    ...current,
    manifest: { ...current.manifest, sourceFingerprint: undefined },
    buildState: { ...current.buildState, sourceFingerprint: undefined },
    sourceFingerprint: `commit:${target}`,
  }), { action: 'reuse', reason: 'current_runtime_ready' })
  assert.deepEqual(decideRuntimeAction({
    ...current,
    manifest: { ...current.manifest, sourceFingerprint: undefined },
    buildState: { ...current.buildState, sourceFingerprint: undefined },
    sourceFingerprint: `snapshot:${target}:${'c'.repeat(64)}`,
  }), { action: 'restart', reason: 'source_outdated' })
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

test('launcher snapshots dirty worktrees and invalidates an outdated source fingerprint', () => {
  assert.match(launcher, /Get-CrmLocalSourceSnapshot/)
  assert.match(launcher, /Get-CrmLocalSnapshotUntrackedFiles/)
  assert.match(launcher, /\[AllowEmptyCollection\(\)\]\[string\[\]\]\$Entries/)
  assert.match(launcher, /Get-CrmLocalSnapshotRelativePath/)
  assert.match(launcher, /diff --binary HEAD/)
  assert.match(launcher, /StandardOutput\.BaseStream\.CopyTo/)
  assert.match(launcher, /Ignorando checkout Git aninhado fora do snapshot do CRM Local/)
  assert.match(launcher, /check-ignore --quiet/)
  assert.match(launcher, /CRM_SOURCE_FINGERPRINT/)
  assert.match(launcher, /Get-CrmPersonaDecision -Persona \$Persona -TargetCommit \$TargetCommit -SourceFingerprint \$snapshot\.Fingerprint/)
  assert.match(launcher, /Stop-CrmPersonaRuntime -Persona \$Persona/)
  assert.match(launcher, /Sync-CrmLocalSourceRoot -Persona \$Persona -TargetCommit \$TargetCommit -Snapshot \$snapshot/)
  assert.match(launcher, /Worktree privado com alterações preservado/)
  assert.match(launcher, /Ensure-CrmGestorForConsultor -TargetCommit \$targetCommit/)
  assert.match(launcher, /Start-CrmGestorBackgroundUpdate/)
  assert.match(launcher, /snapshot:\$\{TargetCommit\}:\$\(Get-CrmLocalSnapshotHash/)
})

test('canonical CRM actions use origin/main only when no preview was explicitly selected', () => {
  assert.match(launcher, /return "origin\/main"/)
  assert.match(launcher, /git -C \$ProjectRoot fetch origin --prune --quiet/)
  assert.match(launcher, /function Test-CrmLocalIncludeWorkingChanges/)
  assert.match(launcher, /if \(-not \(Test-CrmLocalIncludeWorkingChanges\)\)/)
  assert.match(launcher, /Fingerprint = "commit:\$\{TargetCommit\}"/)
  assert.match(launcher, /A prévia ativa não deriva da revisão canônica solicitada/)
})

test('a named CRM preview is shared across actions but applied to the current canonical commit', () => {
  assert.match(launcher, /CRM_LOCAL_PREVIEW_SOURCE_ROOT/)
  assert.match(launcher, /active-source\.json/)
  assert.match(launcher, /CRM_LOCAL_CLEAR_PREVIEW_SOURCE/)
  assert.match(launcher, /if \(\$crmLocalPreviewSelected\) \{[\s\S]*return "HEAD"/)
  assert.match(launcher, /merge-base --is-ancestor \$sourceCommit \$TargetCommit/)
  assert.match(launcher, /A prévia ativa não deriva da revisão canônica solicitada/)
})

test('a selected preview persists its source and never silently substitutes local work with origin/main', () => {
  assert.match(launcher, /crm-local\\active-source\.json/)
  assert.match(launcher, /selectedBy = 'CRM_LOCAL_PREVIEW_SOURCE_ROOT'/)
  assert.match(launcher, /\$ProjectRoot = \$previewSourceRoot/)
  assert.match(launcher, /\$env:CRM_LOCAL_INCLUDE_WORKING_CHANGES = 'true'/)
  assert.match(launcher, /if \(\$crmLocalPreviewSelected\)[\s\S]*return "HEAD"/)
  assert.doesNotMatch(launcher, /git -C \$ProjectRoot reset --hard origin\/main/)
})

test('each CRM module materializes its own exact snapshot and cannot reuse a mismatched origin', () => {
  assert.match(launcher, /Resolve-CrmLocalModuleSourceRoot/)
  assert.match(launcher, /Sync-CrmLocalSourceRoot -Persona \$Persona -TargetCommit \$targetCommit -Snapshot \$snapshot/)
  assert.match(launcher, /Get-CrmPersonaDecision -Persona Gestor -TargetCommit \$targetCommit -SourceFingerprint \$snapshot\.Fingerprint/)
  assert.match(launcher, /-Module 'site-tracking'/)
  assert.match(launcher, /-Module 'meta-ads'/)
  assert.match(launcher, /-Module 'atendimento'/)
  assert.match(launcher, /return "\{0\}__\{1\}" -f \$sourceRoot, \$Module\.Trim\(\)\.ToLowerInvariant\(\)/)
  assert.match(runtimePolicy, /source_outdated/)
  assert.match(runtimePolicy, /commit_outdated/)
  assert.match(runtimePolicy, /source_origin_outdated/)
})

test('Atendimento runtime is detached from the invoking action but keeps the persisted source contract', () => {
  assert.match(launcher, /function Start-CrmAtendimentoBackgroundUpdate/)
  assert.match(launcher, /-CrmAtendimentoDetachedStart/)
  assert.match(launcher, /-RedirectStandardOutput \$outLog -RedirectStandardError \$errLog/)
  assert.match(launcher, /if \(-not \$CrmAtendimentoDetachedStart\)[\s\S]*Start-CrmAtendimentoBackgroundUpdate/)
  assert.match(launcher, /\[int\[\]\]\$AcceptedExitCode = @\(0\)/)
  assert.match(launcher, /CRM_OPEN_BROWSER=0/)
  assert.match(launcher, /-AcceptedExitCode @\(0, 143\)/)
  assert.match(launcher, /function Wait-CrmAtendimentoReady/)
  assert.match(launcher, /Wait-CrmAtendimentoReady -TargetCommit \$targetCommit -SourceFingerprint \$snapshot\.Fingerprint -SourceOrigin \$sourceOrigin -TimeoutSeconds 600/)
  assert.match(launcher, /previous manifest is intentionally retained/)
  assert.match(launcher, /a 143 is only accepted here/)
  assert.match(crmRunner, /wait "\$CRM_PID"/)
  assert.match(launcher, /\$policyCommand = "node \{0\} --manifest \{1\} --build-state \{2\} --target \{3\} --source-fingerprint \{4\} --source-origin \{5\}/)
  assert.match(launcher, /& wsl\.exe -d Ubuntu-24\.04 -- bash -lc \$policyCommand/)
})

test('all CRM module shortcuts select a current snapshot before launch', () => {
  assert.match(launcher, /"CrmSiteEf"[\s\S]*Invoke-CrmPersonaAction -Persona Gestor -TargetCommit \$targetCommit/)
  assert.match(launcher, /"CrmMetaAds"[\s\S]*Invoke-CrmPersonaAction -Persona Gestor -TargetCommit \$targetCommit/)
  assert.match(launcher, /"CrmAtendimento"[\s\S]*Invoke-CrmAtendimentoAction/)
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
    env: { ...process.env, ROOT_DIR: root, CRM_RUNTIME_ROOT: temp, CRM_PERSONA: 'GESTOR', CRM_TARGET_COMMIT: target, CRM_SOURCE_FINGERPRINT: `commit:${target}`, CRM_SOURCE_ORIGIN: 'test-origin__atendimento' },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const manifest = JSON.parse(fs.readFileSync(path.join(temp, 'current.json'), 'utf8'))
  assert.equal(manifest.version, 2)
  assert.equal(manifest.targetCommit, target)
  assert.equal(manifest.buildCommit, built)
  assert.equal(manifest.sourceFingerprint, `commit:${target}`)
  assert.equal(manifest.sourceOrigin, 'test-origin__atendimento')
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
