import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

test('visible Codex actions start in PowerShell and use no direct WSL shell string', () => {
  const environment = read('.codex/environments/environment.toml')
  const launcher = read('scripts/run-shared-codex-shortcut.ps1')
  for (const command of environment.matchAll(/^command = "(.+)"$/gm)) {
    assert.match(command[1], /^powershell\.exe /)
  }
  assert.doesNotMatch(launcher, /\bwsl\.exe\b/i)
  assert.doesNotMatch(launcher, /bash\s+-lc/)
  assert.doesNotMatch(launcher, /RepoCommand/)
  assert.match(launcher, /-ScriptPath/)
  assert.match(launcher, /-NpmScript/)
  assert.match(launcher, /-Executable/)
})

test('the WSL gateway exposes typed operations and fail-closed preflight', () => {
  const gateway = read('scripts/invoke-skincos-wsl.ps1')
  for (const contract of [
    'ParameterSetName = "BashScript"',
    'ParameterSetName = "Executable"',
    'ParameterSetName = "NpmScript"',
    'ParameterSetName = "PythonScript"',
    'No Skincos service was started',
    'Ubuntu-24.04',
    'GIT_DIR=',
    'GIT_WORK_TREE=',
  ]) assert.ok(gateway.includes(contract), `missing gateway contract: ${contract}`)
  assert.match(gateway, /WslExecutable = "wsl\.exe"/)
  assert.doesNotMatch(gateway, /Write-Host "WSL backend:/)
})

test('direct WSL process ownership remains limited to documented infrastructure', () => {
  const allowed = new Set([
    'orb/engine/scripts/export-wsl-codex-base.ps1',
    'scripts/invoke-skincos-wsl.ps1',
    'scripts/install-wsl-runtime-keepalive.ps1',
    'scripts/start-wsl-runtime-keepalive.ps1',
    'scripts/test-wsl-runtime-keepalive.ps1',
    'scripts/runtime/publish-orb-backup.ps1',
    'scripts/validate-mcp-readonly-persistence.ps1',
  ])
  const diagnosticMentions = new Set([
    'scripts/show-github-auth-status.ps1',
    'scripts/test-invoke-skincos-wsl.ps1',
  ])
  const found = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.name.endsWith('.ps1')) {
        const relative = path.relative(root, absolute).split(path.sep).join('/')
        if (/\bwsl\.exe\b/i.test(fs.readFileSync(absolute, 'utf8'))) found.push(relative)
      }
    }
  }
  visit(root)

  for (const relative of found) {
    assert.ok(allowed.has(relative) || diagnosticMentions.has(relative), `undocumented direct WSL owner: ${relative}`)
    if (allowed.has(relative) && relative !== 'scripts/invoke-skincos-wsl.ps1') {
      assert.match(read(relative), /WSL_BOUNDARY_EXCEPTION/)
    }
  }
  assert.doesNotMatch(read('scripts/show-github-auth-status.ps1'), /&\s*wsl\.exe/i)
})

test('project instructions reserve npm and Python project work for Ubuntu', () => {
  const agents = read('AGENTS.md')
  assert.match(agents, /Run the Codex agent natively on Windows/)
  assert.match(agents, /Never run `npm install`, `npm ci`/)
  assert.match(agents, /scripts\/invoke-skincos-wsl\.ps1/)
})

test('CRM local binds every timekeeping runtime to one operator-private key root', () => {
  const launcher = read('scripts/run-shared-codex-shortcut.ps1')
  const initializer = read('scripts/initialize-local-crm-private-bindings.ps1')
  assert.match(launcher, /runtime\\crm-local\\ponto-private/)
  assert.match(launcher, /CRM_TIMEKEEPING_PRIVATE_ROOT=\$crmTimekeepingPrivateRootWsl/)
  assert.match(initializer, /RandomNumberGenerator.*Create/)
  assert.match(initializer, /\/inheritance:r/)
  assert.match(initializer, /não serão rotacionados automaticamente/)
  assert.doesNotMatch(initializer, /Write-(?:Host|Output).*(?:actorKey|idempotencyKey|sessionSecret)/)
})
