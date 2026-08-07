import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateWindowsAclReport } from '../windows-private-acl.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const validator = path.join(root, 'scripts', 'validate-local-timekeeping-env.mjs')
const validatorSource = fs.readFileSync(validator, 'utf8')
const runner = fs.readFileSync(path.join(root, 'scripts', 'run-local-crm.sh'), 'utf8')
const pagesRunner = fs.readFileSync(path.join(root, 'crm', 'console', 'scripts', 'dev_pages.sh'), 'utf8')
const shortcut = fs.readFileSync(path.join(root, 'scripts', 'run-shared-codex-shortcut.ps1'), 'utf8')
const inventoryWrangler = fs.readFileSync(path.join(root, 'inventory', 'wrangler.toml'), 'utf8')
const consoleWrangler = fs.readFileSync(path.join(root, 'crm', 'console', 'wrangler.toml'), 'utf8')
const consolePackage = JSON.parse(fs.readFileSync(path.join(root, 'crm', 'console', 'package.json'), 'utf8'))
const workerBindings = [
  'PONTO_ACTOR_HMAC_KEY',
  'PONTO_IDEMPOTENCY_KEY',
  'PONTO_TEMPLATES_KEY',
  'PONTO_PROFILE_DATA_KEY',
  'PONTO_NETWORK_CONTEXT_KEY',
  'IDENTITY_WORKFORCE_HMAC_KEY',
]
const pagesBindings = ['PONTO_ACTOR_HMAC_KEY', 'PONTO_NETWORK_CONTEXT_KEY', 'PONTO_RELEASE_PROBE_HMAC_KEY']
const inventoryBindings = ['IDENTITY_WORKFORCE_HMAC_KEY', 'INSUMOS_SEED_TOKEN', 'SESSION_SECRET']
const gitSafeEnvironment = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'safe.directory',
  GIT_CONFIG_VALUE_0: root,
}
const windowsRoot = root.replace(/^\/mnt\/([a-z])\//i, (_, drive) => `${drive.toUpperCase()}:\\`).replaceAll('/', '\\')
let repositoryHeadResult = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, ...gitSafeEnvironment },
})
if (repositoryHeadResult.status !== 0 && /^\/mnt\/[a-z]\//i.test(root)) {
  repositoryHeadResult = spawnSync('git.exe', ['-C', windowsRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  })
}
assert.equal(repositoryHeadResult.status, 0, repositoryHeadResult.stderr)
const repositoryHead = repositoryHeadResult.stdout.trim()

function valueFor(binding) {
  return `local_${binding.toLowerCase()}_${'x'.repeat(24)}`
}

function envText(bindings, overrides = {}) {
  return bindings.map((binding) => `${binding}=${overrides[binding] || valueFor(binding)}`).join('\n') + '\n'
}

function validate(workerText, pagesText, {
  sameFile = false,
  insideSource = false,
  inventoryText,
  inventorySameAsWorker = false,
} = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ponto-local-env-'))
  const source = path.join(temporary, 'source')
  const privateRoot = insideSource ? path.join(source, 'private') : path.join(temporary, 'private')
  fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(privateRoot, 0o700)
  fs.mkdirSync(source, { recursive: true })
  const worker = path.join(privateRoot, 'worker.env')
  const pages = sameFile ? worker : path.join(privateRoot, 'pages.env')
  const inventory = inventorySameAsWorker ? worker : path.join(privateRoot, 'inventory.env')
  fs.writeFileSync(worker, workerText, { mode: 0o600 })
  if (!sameFile) fs.writeFileSync(pages, pagesText, { mode: 0o600 })
  if (inventoryText !== undefined && !inventorySameAsWorker) {
    fs.writeFileSync(inventory, inventoryText, { mode: 0o600 })
  }
  const args = [validator, worker, pages, source]
  if (inventoryText !== undefined || inventorySameAsWorker) args.push(inventory)
  return spawnSync(process.execPath, args, { encoding: 'utf8' })
}

test('private launcher env validator accepts the exact three-file contract without printing values', () => {
  const shared = {
    PONTO_ACTOR_HMAC_KEY: valueFor('PONTO_ACTOR_HMAC_KEY'),
    PONTO_NETWORK_CONTEXT_KEY: valueFor('PONTO_NETWORK_CONTEXT_KEY'),
    PONTO_RELEASE_PROBE_HMAC_KEY: createHmac('sha256', valueFor('PONTO_IDEMPOTENCY_KEY'))
      .update('skincos/ponto/release-probe/v1')
      .digest('base64url'),
  }
  const result = validate(
    envText(workerBindings),
    envText(pagesBindings, shared),
    { inventoryText: envText(inventoryBindings) },
  )
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.deepEqual(output.workerBindings, workerBindings)
  assert.deepEqual(output.pagesBindings, pagesBindings)
  assert.deepEqual(output.inventoryBindings, inventoryBindings)
  for (const binding of workerBindings) assert.equal(result.stdout.includes(valueFor(binding)), false)
  assert.deepEqual(output.permissionModels, [process.platform === 'win32' ? 'windows-owner-dacl' : 'posix-owner-mode'])
})

test('Windows private ACL validation rejects inheritance, broad principals and wrong owners', () => {
  const sid = 'S-1-5-21-100-200-300-400'
  const safeEntry = {
    ownerSid: sid,
    protected: true,
    rules: [{ identitySid: sid, type: 'Allow', inherited: false, rights: 'FullControl' }],
  }
  assert.equal(validateWindowsAclReport({ currentSid: sid, file: safeEntry, parent: safeEntry }), true)
  assert.throws(() => validateWindowsAclReport({
    currentSid: sid,
    file: { ...safeEntry, protected: false },
    parent: safeEntry,
  }), /herança DACL desativada/)
  assert.throws(() => validateWindowsAclReport({
    currentSid: sid,
    file: {
      ...safeEntry,
      rules: [...safeEntry.rules, {
        identitySid: 'S-1-1-0',
        type: 'Allow',
        inherited: false,
        rights: 'Read',
      }],
    },
    parent: safeEntry,
  }), /acesso fora do operador atual/)
})

test('private launcher env validator rejects unsafe scope, placeholders and mismatched boundary keys', () => {
  const validWorker = envText(workerBindings)
  const validPages = envText(pagesBindings, {
    PONTO_RELEASE_PROBE_HMAC_KEY: createHmac('sha256', valueFor('PONTO_IDEMPOTENCY_KEY'))
      .update('skincos/ponto/release-probe/v1')
      .digest('base64url'),
  })
  const cases = [
    validate(validWorker, validPages, { sameFile: true }),
    validate(validWorker, validPages, { insideSource: true }),
    validate(`${validWorker}UNEXPECTED_SECRET=${valueFor('UNEXPECTED_SECRET')}\n`, validPages),
    validate(validWorker.replace(/^PONTO_PROFILE_DATA_KEY=.*$/m, 'PONTO_PROFILE_DATA_KEY=changeme'), validPages),
    validate(validWorker, validPages.replace(/^PONTO_ACTOR_HMAC_KEY=.*$/m, `PONTO_ACTOR_HMAC_KEY=${valueFor('different')}`)),
    validate(validWorker, validPages.replace(/^PONTO_RELEASE_PROBE_HMAC_KEY=.*$/m, `PONTO_RELEASE_PROBE_HMAC_KEY=${valueFor('different-release-probe')}`)),
    validate(validWorker, validPages, { inventorySameAsWorker: true }),
    validate(validWorker, validPages, {
      inventoryText: envText(inventoryBindings, {
        IDENTITY_WORKFORCE_HMAC_KEY: valueFor('different-inventory'),
      }),
    }),
    validate(validWorker, validPages, {
      inventoryText: `${envText(inventoryBindings)}UNEXPECTED_SECRET=${valueFor('UNEXPECTED_SECRET')}\n`,
    }),
  ]
  for (const result of cases) {
    assert.notEqual(result.status, 0)
    assert.equal(result.stderr.includes(valueFor('PONTO_ACTOR_HMAC_KEY')), false)
  }
})

test('private launcher env validator enforces POSIX owner-only file and directory modes', {
  skip: process.platform === 'win32',
}, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ponto-local-mode-'))
  const source = path.join(temporary, 'source')
  const privateRoot = path.join(temporary, 'private')
  fs.mkdirSync(source)
  fs.mkdirSync(privateRoot, { mode: 0o700 })
  const worker = path.join(privateRoot, 'worker.env')
  const pages = path.join(privateRoot, 'pages.env')
  fs.writeFileSync(worker, envText(workerBindings), { mode: 0o600 })
  fs.writeFileSync(pages, envText(pagesBindings), { mode: 0o644 })

  const result = spawnSync(process.execPath, [validator, worker, pages, source], { encoding: 'utf8' })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /PONTO_PAGES_ENV_FILE deve usar permissão POSIX 0600/)
})

test('local launcher uses private env files, explicit KV control and exact release affinity', () => {
  for (const binding of workerBindings) assert.match(validatorSource, new RegExp(binding))
  assert.match(runner, /validate-local-timekeeping-env\.mjs/)
  assert.match(runner, /--env-file "\$CRM_TIMEKEEPING_ENV_FILE"/)
  assert.match(runner, /--env-file "\$CRM_INVENTORY_IDENTITY_ENV_FILE"/)
  assert.match(runner, /--var "ALLOW_DEV_SEED:true"/)
  assert.match(runner, /INSUMOS_SEED_TOKEN_SHA256/)
  assert.match(runner, /--var "ALLOW_DEV_AUTH_BYPASS:\$auth_bypass"/)
  assert.match(runner, /module-control:timekeeping/)
  assert.match(runner, /module-control:timekeeping:emergency-latch/)
  assert.match(runner, /syntheticLocalOnly: true/)
  assert.match(runner, /--binding MODULE_CONTROL --local/)
  assert.match(runner, /--var "APP_VERSION:\$CRM_TIMEKEEPING_RELEASE_SHA"/)
  assert.match(runner, /--var "ENVIRONMENT:local"/)
  assert.match(runner, /--var "LOCAL_IDENTITY_VERSION_ID:\$CRM_LOCAL_IDENTITY_VERSION_ID"/)
  assert.match(runner, /CRM_SOURCE_FINGERPRINT" != "commit:\$CRM_TARGET_COMMIT"/)
  assert.match(runner, /crm_source_git status --porcelain --untracked-files=all/)
  assert.match(runner, /x-skincos-gateway-release-sha/)
  assert.match(runner, /x-skincos-gateway-environment: local/)
  assert.match(runner, /PONTO_ALLOW_LOCAL_DIRECT_TIMEKEEPING=true/)
  assert.match(pagesRunner, /--env-file "\$PONTO_PAGES_ENV_FILE"/)
  assert.match(inventoryWrangler, /required = \["IDENTITY_WORKFORCE_HMAC_KEY", "SESSION_SECRET"\]/)
  const localConsoleWrangler = consoleWrangler.split('[[env.production.')[0]
  // Pages-compatible bindings live in the private env file validated above;
  // the generated Pages config must not reintroduce secret declarations.
  assert.doesNotMatch(localConsoleWrangler, /\[secrets\]/)
  assert.equal(consolePackage.devDependencies.wrangler, '4.119.0')
  assert.match(pagesRunner, /validate-local-timekeeping-env\.mjs/)
  assert.match(pagesRunner, /"\$CRM_TIMEKEEPING_ENV_FILE" "\$PONTO_PAGES_ENV_FILE" "\$WORKSPACE_ROOT"/)
  assert.match(pagesRunner, /SKINCOS_DEPLOYMENT_ENV:-\}" != "local"/)
  assert.match(pagesRunner, /PONTO_ALLOW_LOCAL_DIRECT_TIMEKEEPING:-\}" != "true"/)
  assert.match(pagesRunner, /LOCAL_AUTH_BYPASS:-\}" != "true"/)
  assert.match(pagesRunner, /\\\[::1\\\]/)
  assert.doesNotMatch(runner, /test-(?:actor|idempotency|template)-key-not-secret/)
  assert.doesNotMatch(shortcut, /PONTO_ACTOR_HMAC_KEY=test-actor-key-not-secret/)
  assert.doesNotMatch(pagesRunner, /--binding "PONTO_(?:ACTOR_HMAC_KEY|NETWORK_CONTEXT_KEY|RELEASE_PROBE_HMAC_KEY)=/)
  assert.doesNotMatch(runner, /CRM_INSUMOS_SEED_TOKEN|--insumos-seed-token|dev-seed-token/)
  assert.doesNotMatch(runner, /ensure_insumos_seed_config|touch "\$insumos_dev_vars"|>> "\$insumos_dev_vars"/)
  assert.doesNotMatch(pagesRunner, /cp .*\.dev\.vars|sed .*\.dev\.vars|>> .*\.dev\.vars/)
  assert.match(runner, /Arquivo \.dev\.vars proibido/)
  assert.match(pagesRunner, /\.dev\.vars na árvore compartilhada é proibido/)
})

test('local launcher stops before starting services when private bindings are absent', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ponto-local-fail-closed-'))
  const result = spawnSync('bash', [path.join(root, 'scripts', 'run-local-crm.sh'), '--module', 'ponto', '--no-browser'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...gitSafeEnvironment,
      CRM_RUNTIME_ROOT: temporary,
      CRM_PID_FILE: path.join(temporary, 'crm.pid'),
      CRM_LOG_FILE: path.join(temporary, 'crm.log'),
      CRM_WITH_INSUMOS: '0',
      CRM_WITH_TIMEKEEPING: '1',
      CRM_WITH_WHATSAPP: '0',
      CRM_BUILD_BEFORE_START: '0',
      CRM_TARGET_COMMIT: repositoryHead,
      CRM_SOURCE_FINGERPRINT: `commit:${repositoryHead}`,
      CRM_TIMEKEEPING_RELEASE_SHA: repositoryHead,
      CRM_TIMEKEEPING_ENV_FILE: path.join(temporary, 'missing-worker.env'),
      PONTO_PAGES_ENV_FILE: path.join(temporary, 'missing-pages.env'),
    },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CRM_TIMEKEEPING_ENV_FILE não existe ou não pode ser lido/)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Iniciando Workforce\/Timekeeping/)
})

test('local launcher rejects a dirty shared snapshot before reading private bindings or starting services', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ponto-local-snapshot-rejected-'))
  const result = spawnSync('bash', [path.join(root, 'scripts', 'run-local-crm.sh'), '--module', 'ponto', '--no-browser'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...gitSafeEnvironment,
      CRM_RUNTIME_ROOT: temporary,
      CRM_PID_FILE: path.join(temporary, 'crm.pid'),
      CRM_LOG_FILE: path.join(temporary, 'crm.log'),
      CRM_WITH_INSUMOS: '0',
      CRM_WITH_TIMEKEEPING: '1',
      CRM_WITH_WHATSAPP: '0',
      CRM_BUILD_BEFORE_START: '0',
      CRM_TARGET_COMMIT: repositoryHead,
      CRM_SOURCE_FINGERPRINT: `snapshot:${repositoryHead}:${'b'.repeat(64)}`,
      CRM_TIMEKEEPING_RELEASE_SHA: repositoryHead,
      CRM_TIMEKEEPING_ENV_FILE: path.join(temporary, 'missing-worker.env'),
      PONTO_PAGES_ENV_FILE: path.join(temporary, 'missing-pages.env'),
    },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /recusou snapshot ou fonte mutável/)
  assert.doesNotMatch(result.stderr, /CRM_TIMEKEEPING_ENV_FILE não existe/)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Iniciando Workforce\/Timekeeping/)
})

test('local launcher rejects a clean-looking fingerprint whose base SHA is not the source HEAD', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ponto-local-false-affinity-'))
  const falseBaseSha = repositoryHead === 'f'.repeat(40) ? 'e'.repeat(40) : 'f'.repeat(40)
  const result = spawnSync('bash', [path.join(root, 'scripts', 'run-local-crm.sh'), '--module', 'ponto', '--no-browser'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...gitSafeEnvironment,
      CRM_RUNTIME_ROOT: temporary,
      CRM_PID_FILE: path.join(temporary, 'crm.pid'),
      CRM_LOG_FILE: path.join(temporary, 'crm.log'),
      CRM_WITH_INSUMOS: '0',
      CRM_WITH_TIMEKEEPING: '1',
      CRM_WITH_WHATSAPP: '0',
      CRM_BUILD_BEFORE_START: '0',
      CRM_TARGET_COMMIT: falseBaseSha,
      CRM_SOURCE_FINGERPRINT: `commit:${falseBaseSha}`,
      CRM_TIMEKEEPING_RELEASE_SHA: falseBaseSha,
      CRM_TIMEKEEPING_ENV_FILE: path.join(temporary, 'missing-worker.env'),
      PONTO_PAGES_ENV_FILE: path.join(temporary, 'missing-pages.env'),
    },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CRM_TARGET_COMMIT não corresponde ao HEAD/)
  assert.doesNotMatch(result.stderr, /CRM_TIMEKEEPING_ENV_FILE não existe/)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Iniciando Workforce\/Timekeeping/)
})
