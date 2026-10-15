import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const assertPlatformAction = (platform, command) => {
  assert.ok(platform === 'win32' || platform === 'darwin', `unapproved action platform: ${platform}`)
  if (platform === 'win32') assert.match(command, /^powershell\.exe /)
  else assert.match(command, /^bash \.\/scripts\/run-local-codex-shortcut\.sh [a-z-]+$/)
}

test('visible Codex actions use their approved platform launcher and no direct WSL shell string', () => {
  const environment = read('.codex/environments/environment.toml')
  const launcher = read('scripts/run-shared-codex-shortcut.ps1')
  const counts = { win32: 0, darwin: 0 }
  for (const action of environment.split(/^\[\[actions\]\]\r?$/m).slice(1)) {
    const platform = action.match(/^platform = "([^"]+)"\r?$/m)?.[1]
    const command = action.match(/^command = "([^"]+)"\r?$/m)?.[1]
    assertPlatformAction(platform, command)
    counts[platform] += 1
  }
  assert.deepEqual(counts, { win32: 6, darwin: 6 })
  assert.doesNotThrow(() => assertPlatformAction('darwin', 'bash ./scripts/run-local-codex-shortcut.sh context'))
  assert.throws(() => assertPlatformAction('win32', 'bash ./scripts/run-local-codex-shortcut.sh context'))
  assert.throws(() => assertPlatformAction('linux', 'bash ./scripts/run-local-codex-shortcut.sh context'))
  assert.throws(() => assertPlatformAction(undefined, 'powershell.exe -File ./scripts/run-shared-codex-shortcut.ps1'))
  assert.doesNotMatch(launcher, /\bwsl\.exe\b/i)
  assert.doesNotMatch(launcher, /bash\s+-lc/)
  assert.doesNotMatch(launcher, /RepoCommand/)
  assert.match(launcher, /-ScriptPath/)
  assert.match(launcher, /ParameterSetName = "NpmScript"/)
  assert.match(launcher, /\$invokeParameters\.NpmScript = \$NpmScript/)
  assert.match(launcher, /& \$wslInvoker @invokeParameters/)
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
    'scripts/invoke-skincos-wsl.ps1',
    'scripts/bootstrap-schedule-public-read-custody.ps1',
    'scripts/install-wsl-runtime-keepalive.ps1',
    'scripts/start-wsl-runtime-keepalive.ps1',
    'scripts/test-wsl-runtime-keepalive.ps1',
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
        const contents = fs.readFileSync(absolute, 'utf8')
        // Documentation may name wsl.exe (for example, to forbid a command
        // shape) without owning a WSL process. Restrict this audit to actual
        // invocation forms, including the typed gateway's resolved executable
        // and the keepalive's Start-Process form.
        const ownsWslProcess = /\bwsl\.exe\s+(?:--[a-z]|-[a-z])|&\s+\$wsl(?:\.Source)?\b|Start-Process[\s\S]{0,240}-FilePath\s+\$wslPath\b|\$info\.FileName\s*=\s*\$wsl\.Source/i.test(contents)
        if (ownsWslProcess) found.push(relative)
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

test('Schedule custody VM enrollment is a fixed pinned infrastructure exception', () => {
  const source = read('scripts/bootstrap-schedule-public-read-custody.ps1')
  assert.match(source, /WSL_BOUNDARY_EXCEPTION/)
  assert.match(source, /'--distribution', 'Ubuntu-24.04', '--user', 'root'/)
  assert.match(source, /'--exec', '\/usr\/bin\/python3', '-I', '-B', '-c'/)
  assert.match(source, /if \(-not \$Apply\)/)
  assert.match(source, /Assert-ScheduleEnrollmentSourceMetadata -Metadata \$last/)
  assert.match(source, /Get-ScheduleApprovedBlob/)
  assert.match(source, /ScheduleHelperSha256/)
  assert.match(source, /ScheduleReceiverSha256/)
  assert.match(source, /EnvironmentVariables\.Clear\(\)/)
  assert.doesNotMatch(source, /-Skip(?:Bootstrap|Node|Npm|Git|Repo)Check/)
  assert.doesNotMatch(source, /(?:registration-token|sudoers|groupadd|useradd|bash\s+-lc)/)
})

test('project instructions reserve npm and Python project work for Ubuntu', () => {
  const agents = read('AGENTS.md')
  assert.match(agents, /Run the Codex agent natively on Windows/)
  assert.match(agents, /Never run `npm install`, `npm ci`/)
  assert.match(agents, /scripts\/invoke-skincos-wsl\.ps1/)
})

test('EF App unit actions select the unit in PowerShell before crossing WSL', () => {
  const launcher = read('scripts/run-shared-codex-shortcut.ps1')
  assert.match(launcher, /function Get-EfAppUnitOptions/)
  assert.match(launcher, /function Select-EfAppUnitName/)
  assert.match(launcher, /-Title \("EF App > \{0\} > Unidade" -f \$Mode\)/)
  assert.match(launcher, /\$normalizedMode = \$Mode\.Trim\(\)\.ToLowerInvariant\(\)/)
  assert.match(launcher, /\$normalizedMode -in @\("caixa", "cash", "agenda_delta"\)/)
  assert.match(launcher, /\$modeEnvVars \+= "EF_UNIT_NAME=\$unitName"/)
  assert.match(launcher, /-EnvVar \(\$launcherEnvVars \+ \$modeEnvVars \+ \$modeSpecificEnvVars \+ \$ExtraEnvVar\)/)
})

test('EF App Caixa asks for a validated date range before WSL execution', () => {
  const launcher = read('scripts/run-shared-codex-shortcut.ps1')
  assert.match(launcher, /function Read-EfAppCashDateRange/)
  assert.match(launcher, /Data inicial \(DD\/MM\/AAAA; ENTER p\/ padrão:/)
  assert.match(launcher, /Data final \(DD\/MM\/AAAA; ENTER p\/ padrão:/)
  assert.match(launcher, /\[datetime\]::TryParseExact/)
  assert.match(launcher, /EF_CASH_START_DATE=\$\(\$dateRange\.Start\)/)
  assert.match(launcher, /EF_CASH_END_DATE=\$\(\$dateRange\.End\)/)
})

test('EF App Client Registration dispatches the supported checkpointed read-only exporter', () => {
  const launcher = read('scripts/run-shared-codex-shortcut.ps1')
  const runner = read('integration/ef/run_scraper.py')
  const exporter = read('integration/ef/espacofacial/client_registration.py')
  assert.match(launcher, /"EfAppClientRegistration"\s*\{\s*Invoke-EfAppPythonMode -Mode "client_registration"\s*\}/)
  assert.doesNotMatch(launcher, /EfAppClientRegistration"\s*\{\s*throw /)
  assert.match(runner, /if mode in \{"client_registration", "cadastro_clientes", "clientes_cadastro"\}:/)
  assert.match(exporter, /def run_client_registration_export\(/)
  assert.match(exporter, /_load_checkpoint\(/)
})

test('EF App Client Registration isolates new checkpoints and requires an explicit private resume', () => {
  const launcher = read('scripts/run-shared-codex-shortcut.ps1')
  assert.match(launcher, /\$efAppClientRegistrationRunRoot = Join-Path \$efAppArtifactRoot "client-registration"/)
  assert.match(launcher, /function New-EfAppClientRegistrationOutputDirectory/)
  assert.match(launcher, /EF_CLIENT_REGISTRATION_RESUME_OUTPUT_DIR/)
  assert.match(launcher, /\[Guid\]::NewGuid\(\)\.ToString\('N'\)\.Substring\(0, 12\)/)
  assert.match(launcher, /Test-WindowsPathWithinRoot -Path \$resolvedResumeDirectory -Root \$runRoot/)
  assert.match(launcher, /\$normalizedMode -eq "client_registration"/)
  assert.match(launcher, /EF_CLIENT_REGISTRATION_RUN_ID=\$\(\$clientRegistrationRun\.RunId\)/)
  assert.match(launcher, /EF_CLIENT_REGISTRATION_LAUNCH_MODE=\$\(\$clientRegistrationRun\.LaunchMode\)/)
  assert.match(launcher, /EF_OUTPUT_DIR não pode sobrescrever a execução isolada/)
})

test('EF App prompts for absent credentials and persists them only in the private login file', () => {
  const launcher = read('scripts/run-shared-codex-shortcut.ps1')
  assert.match(launcher, /function Protect-EfAppLoginEnvFile/)
  assert.match(launcher, /function Test-EfAppLoginEnvFile/)
  assert.match(launcher, /function Save-EfAppLoginCredentials/)
  assert.match(launcher, /Read-Host "Senha do app Espaço Facial" -AsSecureString/)
  assert.match(launcher, /EF_LOGIN_EMAIL=\$\(\$Email\.Trim\(\)\)/)
  assert.match(launcher, /EF_LOGIN_PASSWORD=\$passwordValue/)
  assert.match(launcher, /Protect-EfAppLoginEnvFile -Path \$efAppLoginEnvFile/)
  assert.match(launcher, /if \(-not \(Ensure-EfAppLoginCredentials\)\) \{\s*return\s*\}/)
  assert.doesNotMatch(launcher, /EfAppAgendaFullSync|EfAppBookingApi|EfAppRotateAgendaSyncToken/)
})
