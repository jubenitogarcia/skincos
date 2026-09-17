param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        "WorkspaceMenu", "ContextMenu", "LocalMenu", "EfAppMenu", "OrbMenu",
        "SharedSetup", "SharedValidate", "RuntimeSetup", "GitHubAuthLoginWsl",
        "GitHubAuthStatus", "SharedStatus", "CodexContext", "CodexContextOnline",
        "ThreadBootstrap", "NewWorktree", "WebsiteLocalStart", "WebsiteLocalStop",
        "WebsiteSiteCheck", "WebsiteReleaseCheck", "PlatformLocalStart",
        "EfAppSetup", "EfAppSelftest", "EfAppCaixa", "EfAppAgendaDelta",
        "EfAppAgendaFullSync", "EfAppBookingApi", "EfAppProcedures",
        "EfAppClientRegistration", "EfAppRecorder", "EfAppRotateAgendaSyncToken"
    )]
    [string]$Action,
    [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherProjectRoot = Split-Path -Parent $scriptRoot

function Resolve-ProjectRoot {
    param([string]$RequestedPath, [string]$ScriptDirectory)
    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) { return (Resolve-Path -LiteralPath $RequestedPath).Path }
    $scriptProjectRoot = Split-Path -Parent $ScriptDirectory
    if ((Test-Path -LiteralPath (Join-Path $scriptProjectRoot ".git")) -or (Test-Path -LiteralPath (Join-Path $scriptProjectRoot "AGENTS.md"))) { return (Resolve-Path -LiteralPath $scriptProjectRoot).Path }
    $currentPath = (Get-Location).Path
    if ((Test-Path -LiteralPath (Join-Path $currentPath ".git")) -or (Test-Path -LiteralPath (Join-Path $currentPath "AGENTS.md"))) { return (Resolve-Path -LiteralPath $currentPath).Path }
    throw "Não foi possível localizar automaticamente a raiz do projeto. Execute a ação a partir da raiz ou informe -ProjectRoot."
}

$ProjectRoot = Resolve-ProjectRoot -RequestedPath $ProjectRoot -ScriptDirectory $scriptRoot
$localStateRoot = Join-Path $env:LOCALAPPDATA "Codex\skincos"
$operatorRuntimeRoot = "C:\CodexRuntime\operator\admin\skincos"
$tmpRoot = Join-Path $localStateRoot "tmp"
$logRoot = Join-Path $operatorRuntimeRoot "logs"
$wslInvoker = Join-Path $scriptRoot "invoke-skincos-wsl.ps1"

function Convert-WindowsPathToWsl {
    param([string]$Path)
    if ($Path -match '^(?<drive>[A-Za-z]):\\(?<rest>.*)$') {
        $drive = $Matches.drive.ToLowerInvariant(); $rest = $Matches.rest -replace '\\', '/'
        if ([string]::IsNullOrWhiteSpace($rest)) { return "/mnt/$drive" }
        return "/mnt/$drive/$rest"
    }
    return $Path
}

function Test-WindowsPathWithinRoot {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Root)
    $candidate = [IO.Path]::GetFullPath($Path).TrimEnd([char]'\', [char]'/')
    $boundaryRoot = [IO.Path]::GetFullPath($Root).TrimEnd([char]'\', [char]'/')
    if ($candidate.Equals($boundaryRoot, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    return $candidate.StartsWith($boundaryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Invoke-ShortcutWsl {
    [CmdletBinding(DefaultParameterSetName = "BashScript")]
    param(
        [Parameter(Mandatory = $true, ParameterSetName = "BashScript")][string]$ScriptPath,
        [Parameter(Mandatory = $true, ParameterSetName = "Executable")][string]$Executable,
        [Parameter(Mandatory = $true, ParameterSetName = "NpmScript")][string]$NpmScript,
        [Parameter(Mandatory = $true, ParameterSetName = "PythonScript")][string]$PythonScript,
        [Parameter(ParameterSetName = "BashScript")]
        [Parameter(ParameterSetName = "Executable")]
        [Parameter(ParameterSetName = "NpmScript")]
        [Parameter(ParameterSetName = "PythonScript")]
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory = ".",
        [string]$WorkingProjectRoot = $ProjectRoot,
        [string[]]$EnvVar = @(),
        [int[]]$AcceptedExitCode = @(0),
        [switch]$SkipBootstrapCheck, [switch]$SkipNodeCheck, [switch]$SkipNpmCheck,
        [switch]$SkipGitCheck, [switch]$SkipRepoCheck
    )
    $invokeParameters = @{
        ProjectRoot = $WorkingProjectRoot; WorkingDirectory = $WorkingDirectory
        ArgumentList = $ArgumentList; EnvVar = $EnvVar
        SkipBootstrapCheck = $SkipBootstrapCheck; SkipNodeCheck = $SkipNodeCheck
        SkipNpmCheck = $SkipNpmCheck; SkipGitCheck = $SkipGitCheck; SkipRepoCheck = $SkipRepoCheck
    }
    switch ($PSCmdlet.ParameterSetName) {
        "BashScript" { $invokeParameters.ScriptPath = $ScriptPath }
        "Executable" { $invokeParameters.Executable = $Executable }
        "NpmScript" { $invokeParameters.NpmScript = $NpmScript }
        "PythonScript" { $invokeParameters.PythonScript = $PythonScript }
    }
    & $wslInvoker @invokeParameters
    $exitCode = $LASTEXITCODE
    if ($exitCode -notin $AcceptedExitCode) { throw "A operação WSL falhou com o código de saída $exitCode." }
}

function Ensure-LocalState {
    foreach ($path in @($localStateRoot, $tmpRoot, $logRoot)) {
        if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
    }
}

function Invoke-RepoPowerShellScript {
    param([Parameter(Mandatory = $true)][string]$ScriptName)
    & (Join-Path $scriptRoot $ScriptName) -ProjectRoot $ProjectRoot
}

function New-MenuOption {
    param([string]$Label, [string]$Action)
    [pscustomobject]@{ Label = $Label; Action = $Action }
}

function Read-MenuSelection {
    param([string]$Title, [object[]]$Options, [string]$CancelLabel = "Voltar")
    while ($true) {
        Write-Host ""; Write-Host "== $Title ==" -ForegroundColor Cyan
        for ($index = 0; $index -lt $Options.Count; $index++) { Write-Host ("{0}. {1}" -f ($index + 1), $Options[$index].Label) }
        Write-Host ("0. {0}" -f $CancelLabel)
        $raw = Read-Host "Escolha uma opcao"; $choice = 0
        if (-not [int]::TryParse($raw, [ref]$choice)) { Write-Host "Digite o numero da opcao desejada." -ForegroundColor Yellow; continue }
        if ($choice -eq 0) { return $null }
        if ($choice -ge 1 -and $choice -le $Options.Count) { return $Options[$choice - 1] }
        Write-Host "Opcao invalida." -ForegroundColor Yellow
    }
}

function Pause-AfterMenuAction { Write-Host ""; [void](Read-Host "Pressione ENTER para voltar ao menu") }

Ensure-LocalState
$websitePid = Join-Path $tmpRoot "website-local-dev.pid"
$websiteLog = Join-Path $logRoot "website-local-dev.log"
$websitePort = Join-Path $tmpRoot "website-local-dev.port"
$sharedRoot = Split-Path (Split-Path $ProjectRoot -Parent) -Parent
$websiteSourceRoot = Join-Path $sharedRoot "Worktrees\skincos\shared\website-local-main"

$efAppStateRoot = Join-Path $localStateRoot "espacofacial-app"
$efAppArtifactRoot = Join-Path $operatorRuntimeRoot "scraper"
$efAppOutputRoot = Join-Path $efAppArtifactRoot "report"
$efAppClientRegistrationRunRoot = Join-Path $efAppArtifactRoot "client-registration"
$efAppDebugRoot = Join-Path $efAppArtifactRoot "debug"
$efAppLogRoot = Join-Path $efAppArtifactRoot "logs"
$efAppChromeProfileRoot = Join-Path $efAppStateRoot "chrome-profile"
$efAppBookingEnvFile = Join-Path $efAppStateRoot "booking_api.env"
$efAppAgendaSyncEnvFile = Join-Path $efAppStateRoot "agenda_sync.env"
$efAppLoginEnvFile = Join-Path $efAppStateRoot "login.env"

foreach ($path in @($efAppStateRoot, $efAppOutputRoot, $efAppClientRegistrationRunRoot, $efAppDebugRoot, $efAppLogRoot, $efAppChromeProfileRoot)) {
    if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
}

$efAppEnvVars = @(
    "EF_OUTPUT_DIR=$(Convert-WindowsPathToWsl -Path $efAppOutputRoot)",
    "EF_DEBUG_DIR=$(Convert-WindowsPathToWsl -Path $efAppDebugRoot)",
    "EF_LOG_DIR=$(Convert-WindowsPathToWsl -Path $efAppLogRoot)",
    "EF_CHROME_USER_DATA_DIR=$(Convert-WindowsPathToWsl -Path $efAppChromeProfileRoot)",
    "EF_BOOKING_ENV_FILE=$(Convert-WindowsPathToWsl -Path $efAppBookingEnvFile)",
    "EF_AGENDA_SYNC_ENV_FILE=$(Convert-WindowsPathToWsl -Path $efAppAgendaSyncEnvFile)",
    "EF_LOGIN_ENV_FILE=$(Convert-WindowsPathToWsl -Path $efAppLoginEnvFile)"
)

function Protect-EfAppLoginEnvFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Path /setowner "*$sid" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha ao definir o proprietário do arquivo privado de login." }
    & icacls.exe $Path /grant:r "*$($sid):F" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha ao restringir a DACL do arquivo privado de login." }
    & icacls.exe $Path /inheritance:r /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha ao remover a herança da DACL do arquivo privado de login." }
}

function Test-EfAppLoginEnvFile {
    if (-not (Test-Path -LiteralPath $efAppLoginEnvFile -PathType Leaf)) { return $false }
    $present = @{ EF_LOGIN_EMAIL = $false; EF_LOGIN_PASSWORD = $false }
    try {
        foreach ($line in Get-Content -LiteralPath $efAppLoginEnvFile) {
            $trimmed = $line.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#')) { continue }
            if ($trimmed -notmatch '^(?:export\s+)?(?<key>EF_LOGIN_EMAIL|EF_LOGIN_PASSWORD)\s*=\s*(?<value>.*)$') { continue }
            if (-not [string]::IsNullOrWhiteSpace($Matches.value.Trim().Trim('"').Trim("'"))) { $present[$Matches.key] = $true }
        }
    } catch { return $false }
    return [bool]($present.EF_LOGIN_EMAIL -and $present.EF_LOGIN_PASSWORD)
}

function Save-EfAppLoginCredentials {
    param([Parameter(Mandatory = $true)][string]$Email, [Parameter(Mandatory = $true)][Security.SecureString]$Password)
    if ([string]::IsNullOrWhiteSpace($Email) -or $Password.Length -eq 0) { return $false }
    if ($Email.IndexOfAny([char[]]"`r`n$([char]0)") -ge 0) { throw "O email não pode conter quebras de linha." }
    $passwordBstr = [IntPtr]::Zero; $temporaryPath = $null
    try {
        $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
        $passwordValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
        if ([string]::IsNullOrWhiteSpace($passwordValue)) { return $false }
        if ($passwordValue.IndexOfAny([char[]]"`r`n$([char]0)") -ge 0) { throw "A senha não pode conter quebras de linha." }
        $parent = Split-Path -Parent $efAppLoginEnvFile; New-Item -ItemType Directory -Path $parent -Force | Out-Null
        $temporaryPath = Join-Path $parent (".login-{0}.tmp" -f [Guid]::NewGuid().ToString('N'))
        [IO.File]::WriteAllText($temporaryPath, "EF_LOGIN_EMAIL=$($Email.Trim())`nEF_LOGIN_PASSWORD=$passwordValue`n", [Text.UTF8Encoding]::new($false))
        Protect-EfAppLoginEnvFile -Path $temporaryPath
        Move-Item -LiteralPath $temporaryPath -Destination $efAppLoginEnvFile -Force; $temporaryPath = $null
        Protect-EfAppLoginEnvFile -Path $efAppLoginEnvFile
        return $true
    } finally {
        if ($passwordBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr) }
        if ($null -ne $temporaryPath -and (Test-Path -LiteralPath $temporaryPath)) { Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue }
    }
}

function Ensure-EfAppLoginCredentials {
    if (Test-EfAppLoginEnvFile) { Protect-EfAppLoginEnvFile -Path $efAppLoginEnvFile; return $true }
    Write-Host "[ef-app] Credenciais não encontradas no armazenamento privado." -ForegroundColor Yellow
    $email = (Read-Host "Email do app Espaço Facial").Trim()
    if ([string]::IsNullOrWhiteSpace($email)) { Write-Host "Credenciais não informadas; ação cancelada." -ForegroundColor Yellow; return $false }
    $password = Read-Host "Senha do app Espaço Facial" -AsSecureString
    try {
        if (-not (Save-EfAppLoginCredentials -Email $email -Password $password)) { Write-Host "Credenciais não informadas; ação cancelada." -ForegroundColor Yellow; return $false }
    } finally { $password.Dispose() }
    Write-Host "[ef-app] Credenciais salvas no armazenamento privado do operador."; return $true
}

function New-EfAppClientRegistrationOutputDirectory {
    $resumeOutputDirectory = ([string]$env:EF_CLIENT_REGISTRATION_RESUME_OUTPUT_DIR).Trim()
    $runRoot = (Resolve-Path -LiteralPath $efAppClientRegistrationRunRoot).Path.TrimEnd([char]'\', [char]'/')
    if (-not [string]::IsNullOrWhiteSpace($resumeOutputDirectory)) {
        if (-not (Test-Path -LiteralPath $resumeOutputDirectory -PathType Container)) { throw "O diretório de retomada não existe: '$resumeOutputDirectory'." }
        $resolvedResumeDirectory = (Resolve-Path -LiteralPath $resumeOutputDirectory).Path.TrimEnd([char]'\', [char]'/')
        if (-not (Test-WindowsPathWithinRoot -Path $resolvedResumeDirectory -Root $runRoot) -or $resolvedResumeDirectory.Equals($runRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "A retomada deve estar abaixo de '$runRoot'." }
        $runId = [IO.Path]::GetFileName($resolvedResumeDirectory)
        if ([string]::IsNullOrWhiteSpace($runId)) { throw "A retomada não possui identificador válido." }
        return [pscustomobject]@{ OutputDirectory = $resolvedResumeDirectory; RunId = $runId; LaunchMode = 'explicit_resume' }
    }
    $runId = "{0}-{1}" -f (Get-Date).ToUniversalTime().ToString("yyyyMMdd'T'HHmmssfff'Z'"), ([Guid]::NewGuid().ToString('N').Substring(0, 12))
    $outputDirectory = Join-Path $runRoot $runId; New-Item -ItemType Directory -Path $outputDirectory -ErrorAction Stop | Out-Null
    return [pscustomobject]@{ OutputDirectory = $outputDirectory; RunId = $runId; LaunchMode = 'fresh' }
}

function Get-EfAppUnitOptions {
    $configuredOptions = [string]$env:EF_UNIT_OPTIONS
    if ([string]::IsNullOrWhiteSpace($configuredOptions)) { $configuredOptions = [string]$env:EF_UNITS }
    if ([string]::IsNullOrWhiteSpace($configuredOptions)) { return @("BarraShoppingSul", "Novo Hamburgo") }
    return @($configuredOptions -split ',' | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
}

function Select-EfAppUnitName {
    param([Parameter(Mandatory = $true)][string]$Mode)
    $configuredUnit = [string]$env:EF_UNIT_NAME
    if (-not [string]::IsNullOrWhiteSpace($configuredUnit)) { return $configuredUnit.Trim() }
    $options = @(Get-EfAppUnitOptions)
    if ($options.Count -eq 0) { throw "Nenhuma unidade está configurada. Defina EF_UNIT_OPTIONS ou EF_UNITS." }
    if ($options.Count -eq 1) { return [string]$options[0] }
    $menuOptions = @($options | ForEach-Object { New-MenuOption -Label ([string]$_) -Action ([string]$_) })
    $selection = Read-MenuSelection -Title ("EF App > {0} > Unidade" -f $Mode) -Options $menuOptions -CancelLabel "Cancelar"
    if ($null -eq $selection) { Write-Host "Unidade não selecionada." -ForegroundColor Yellow; return $null }
    return [string]$selection.Action
}

function Read-EfAppCashDateRange {
    $today = (Get-Date).Date; $defaultStart = $today.AddDays(-7); $defaultEnd = $today
    while ($true) {
        $startRaw = Read-Host ("Data inicial (DD/MM/AAAA; ENTER p/ padrão: {0})" -f $defaultStart.ToString('dd/MM/yyyy'))
        $endRaw = Read-Host ("Data final (DD/MM/AAAA; ENTER p/ padrão: {0})" -f $defaultEnd.ToString('dd/MM/yyyy'))
        $startValue = if ([string]::IsNullOrWhiteSpace($startRaw)) { $defaultStart } else { $null }
        $endValue = if ([string]::IsNullOrWhiteSpace($endRaw)) { $defaultEnd } else { $null }
        if ($null -eq $startValue) {
            [datetime]$parsedStart = [datetime]::MinValue
            if (-not [datetime]::TryParseExact($startRaw.Trim(), 'dd/MM/yyyy', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsedStart)) { Write-Host "Data inicial inválida. Use DD/MM/AAAA." -ForegroundColor Yellow; continue }
            $startValue = $parsedStart.Date
        }
        if ($null -eq $endValue) {
            [datetime]$parsedEnd = [datetime]::MinValue
            if (-not [datetime]::TryParseExact($endRaw.Trim(), 'dd/MM/yyyy', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsedEnd)) { Write-Host "Data final inválida. Use DD/MM/AAAA." -ForegroundColor Yellow; continue }
            $endValue = $parsedEnd.Date
        }
        if ($endValue -lt $startValue) { Write-Host "A data final não pode ser menor que a inicial." -ForegroundColor Yellow; continue }
        return [pscustomobject]@{ Start = $startValue.ToString('dd/MM/yyyy'); End = $endValue.ToString('dd/MM/yyyy') }
    }
}

function Invoke-EfAppPythonMode {
    param([string]$Mode, [string[]]$ExtraEnvVar = @(), [switch]$Headed)
    $normalizedMode = $Mode.Trim().ToLowerInvariant(); $headlessValue = if ($Headed) { "HEADLESS=0" } else { "HEADLESS=1" }
    $modeEnvVars = @("EF_MODE=$Mode", $headlessValue)
    if ($normalizedMode -in @("caixa", "cash", "agenda_delta")) {
        $unitName = Select-EfAppUnitName -Mode $Mode; if ([string]::IsNullOrWhiteSpace($unitName)) { return }; $modeEnvVars += "EF_UNIT_NAME=$unitName"
    }
    if ($normalizedMode -in @("caixa", "cash")) { $dateRange = Read-EfAppCashDateRange; $modeEnvVars += @("EF_CASH_START_DATE=$($dateRange.Start)", "EF_CASH_END_DATE=$($dateRange.End)") }
    if (-not (Ensure-EfAppLoginCredentials)) { return }
    $modeSpecificEnvVars = @(); $launcherEnvVars = $efAppEnvVars
    if ($normalizedMode -eq "client_registration") {
        if ($ExtraEnvVar | Where-Object { $_ -like "EF_OUTPUT_DIR=*" }) { throw "EF_OUTPUT_DIR não pode sobrescrever a execução isolada. Use EF_CLIENT_REGISTRATION_RESUME_OUTPUT_DIR para uma retomada explícita." }
        $clientRegistrationRun = New-EfAppClientRegistrationOutputDirectory
        $launcherEnvVars = @($efAppEnvVars | Where-Object { $_ -notlike "EF_OUTPUT_DIR=*" })
        $modeSpecificEnvVars = @(
            "EF_OUTPUT_DIR=$(Convert-WindowsPathToWsl -Path $clientRegistrationRun.OutputDirectory)",
            "EF_CLIENT_REGISTRATION_RUN_ID=$($clientRegistrationRun.RunId)",
            "EF_CLIENT_REGISTRATION_LAUNCH_MODE=$($clientRegistrationRun.LaunchMode)"
        )
        Write-Host "[ef-app] Client Registration: saída privada $($clientRegistrationRun.LaunchMode) em $($clientRegistrationRun.OutputDirectory)"
    }
    Invoke-ShortcutWsl -ScriptPath "integration/ef/scripts/run-local-python.sh" -ArgumentList @("run_scraper.py") -EnvVar ($launcherEnvVars + $modeEnvVars + $modeSpecificEnvVars + $ExtraEnvVar) -SkipNodeCheck -SkipNpmCheck
}

function Invoke-ShortcutActionInternal {
    param([Parameter(Mandatory = $true)][string]$SelectedAction)
    switch ($SelectedAction) {
        "SharedSetup" { Invoke-RepoPowerShellScript -ScriptName "setup-shared-codex-workspace.ps1" }
        "SharedValidate" { Invoke-RepoPowerShellScript -ScriptName "validate-shared-codex-workspace.ps1" }
        "RuntimeSetup" { & (Join-Path $scriptRoot "setup-shared-runtime.ps1") }
        "GitHubAuthLoginWsl" {
            Invoke-ShortcutWsl -Executable gh -ArgumentList @("auth", "login", "--web", "--git-protocol", "https", "--hostname", "github.com") -SkipBootstrapCheck -SkipNodeCheck -SkipNpmCheck -SkipGitCheck
            Invoke-ShortcutWsl -Executable gh -ArgumentList @("auth", "status") -SkipBootstrapCheck -SkipNodeCheck -SkipNpmCheck -SkipGitCheck
        }
        "GitHubAuthStatus" { & (Join-Path $scriptRoot "show-github-auth-status.ps1") -ProjectRoot $ProjectRoot }
        "SharedStatus" { Invoke-RepoPowerShellScript -ScriptName "show-shared-codex-status.ps1" }
        "CodexContext" { Invoke-ShortcutWsl -ScriptPath "./scripts/codex-context.sh" }
        "CodexContextOnline" { Invoke-ShortcutWsl -ScriptPath "./scripts/codex-context.sh" -ArgumentList @("--online") }
        "ThreadBootstrap" { & (Join-Path $scriptRoot "print-codex-thread-bootstrap.ps1") -Interactive }
        "NewWorktree" { & (Join-Path $scriptRoot "new-shared-worktree.ps1") -Fetch }
        "WebsiteLocalStart" {
            $websiteSourceWsl = Convert-WindowsPathToWsl -Path $websiteSourceRoot
            Invoke-ShortcutWsl -ScriptPath "./scripts/prepare-local-website-source.sh" -ArgumentList @($websiteSourceWsl, "/home/admin/.cache/skincos-local-root")
            Invoke-ShortcutWsl -ScriptPath "./scripts/run-local-website.sh" -EnvVar @("WEBSITE_SOURCE_ROOT=/home/admin/.cache/skincos-local-root", "WEBSITE_SKIP_WORKERD_CHECK=0", "WEBSITE_STATE_DIR=$(Convert-WindowsPathToWsl -Path $tmpRoot)", "WEBSITE_PID_FILE=$(Convert-WindowsPathToWsl -Path $websitePid)", "WEBSITE_LOG_FILE=$(Convert-WindowsPathToWsl -Path $websiteLog)", "WEBSITE_PORT_FILE=$(Convert-WindowsPathToWsl -Path $websitePort)", "WEBSITE_DETACH=1", "OPEN_BROWSER=0")
        }
        "WebsiteLocalStop" { Invoke-ShortcutWsl -ScriptPath "./scripts/run-local-website.sh" -ArgumentList @("--stop") -EnvVar @("WEBSITE_SOURCE_ROOT=/home/admin/.cache/skincos-local-root", "WEBSITE_STATE_DIR=$(Convert-WindowsPathToWsl -Path $tmpRoot)", "WEBSITE_PID_FILE=$(Convert-WindowsPathToWsl -Path $websitePid)", "WEBSITE_PORT_FILE=$(Convert-WindowsPathToWsl -Path $websitePort)") }
        "WebsiteSiteCheck" { Invoke-ShortcutWsl -NpmScript "codex:site:check" }
        "WebsiteReleaseCheck" { Invoke-ShortcutWsl -NpmScript "codex:site:release-check" }
        "PlatformLocalStart" { Invoke-ShortcutWsl -ScriptPath "./backend/scripts/dev.sh" -ArgumentList @("watch") -EnvVar @("OPEN_BROWSER=0") }
        "EfAppSetup" { Invoke-ShortcutWsl -ScriptPath "integration/ef/scripts/setup-local-venv.sh" -EnvVar $efAppEnvVars -SkipNodeCheck -SkipNpmCheck }
        "EfAppSelftest" { Invoke-ShortcutWsl -ScriptPath "integration/ef/scripts/run-local-python.sh" -ArgumentList @("selftest.py") -EnvVar ($efAppEnvVars + @("HEADLESS=1")) -SkipNodeCheck -SkipNpmCheck }
        "EfAppCaixa" { Invoke-EfAppPythonMode -Mode "caixa" }
        "EfAppAgendaDelta" { Invoke-EfAppPythonMode -Mode "agenda_delta" }
        "EfAppAgendaFullSync" { if (-not (Ensure-EfAppLoginCredentials)) { return }; Invoke-ShortcutWsl -ScriptPath "integration/ef/run_agenda_full_sync_all_units.sh" -EnvVar ($efAppEnvVars + @("HEADLESS=1", "EF_OUTPUT_BASE_DIR=$(Convert-WindowsPathToWsl -Path $efAppOutputRoot)")) -SkipNodeCheck -SkipNpmCheck }
        "EfAppBookingApi" { Invoke-EfAppPythonMode -Mode "booking_api" }
        "EfAppProcedures" { Invoke-EfAppPythonMode -Mode "procedures" }
        "EfAppClientRegistration" { Invoke-EfAppPythonMode -Mode "client_registration" }
        "EfAppRecorder" { Invoke-EfAppPythonMode -Mode "recorder" -Headed }
        "EfAppRotateAgendaSyncToken" { Invoke-ShortcutWsl -ScriptPath "integration/ef/scripts/rotate_agenda_sync_token.sh" -ArgumentList @("--website-dir", "website") -EnvVar $efAppEnvVars -SkipNodeCheck -SkipNpmCheck }
        "OrbMenu" { Write-Host "O Orb possui projeto independente em C:\CodexShared\Projetos\orb. Abra esse projeto para operar os workflows." }
        "WorkspaceMenu" { Show-WorkspaceMenu }
        "ContextMenu" { Show-ContextMenu }
        "LocalMenu" { Show-LocalMenu }
        "EfAppMenu" { Show-EfAppMenu }
        default { throw "Ação não suportada: $SelectedAction" }
    }
}

function Invoke-MenuAction {
    param([string]$SelectedAction)
    try { Invoke-ShortcutActionInternal -SelectedAction $SelectedAction } catch { Write-Host ""; Write-Host ("ERRO: {0}" -f $_.Exception.Message) -ForegroundColor Red }
    if ($SelectedAction -notin @("WorkspaceMenu", "ContextMenu", "LocalMenu", "EfAppMenu")) { Pause-AfterMenuAction }
}

function Show-WorkspaceMenu {
    while ($true) {
        $selection = Read-MenuSelection -Title "Workspace" -Options @(
            (New-MenuOption -Label "Shared Setup" -Action "SharedSetup"),
            (New-MenuOption -Label "Shared Validate" -Action "SharedValidate"),
            (New-MenuOption -Label "Runtime Setup" -Action "RuntimeSetup"),
            (New-MenuOption -Label "GitHub Auth Login (WSL)" -Action "GitHubAuthLoginWsl"),
            (New-MenuOption -Label "GitHub Auth Status" -Action "GitHubAuthStatus")
        )
        if ($null -eq $selection) { return }; Invoke-MenuAction -SelectedAction $selection.Action
    }
}

function Show-ContextMenu {
    while ($true) {
        $selection = Read-MenuSelection -Title "Contexto" -Options @(
            (New-MenuOption -Label "Shared Status" -Action "SharedStatus"),
            (New-MenuOption -Label "Codex Context" -Action "CodexContext"),
            (New-MenuOption -Label "Codex Context Online" -Action "CodexContextOnline"),
            (New-MenuOption -Label "Thread Bootstrap" -Action "ThreadBootstrap"),
            (New-MenuOption -Label "New Worktree" -Action "NewWorktree")
        )
        if ($null -eq $selection) { return }; Invoke-MenuAction -SelectedAction $selection.Action
    }
}

function Show-WebsiteMenu {
    while ($true) {
        $selection = Read-MenuSelection -Title "Local > Website" -Options @(
            (New-MenuOption -Label "Start" -Action "WebsiteLocalStart"),
            (New-MenuOption -Label "Stop" -Action "WebsiteLocalStop"),
            (New-MenuOption -Label "Site Check" -Action "WebsiteSiteCheck"),
            (New-MenuOption -Label "Release Check" -Action "WebsiteReleaseCheck")
        )
        if ($null -eq $selection) { return }; Invoke-MenuAction -SelectedAction $selection.Action
    }
}

function Show-LocalMenu {
    while ($true) {
        $selection = Read-MenuSelection -Title "Local" -Options @(
            (New-MenuOption -Label "Website" -Action "ShowWebsiteMenu"),
            (New-MenuOption -Label "Platform Local" -Action "PlatformLocalStart")
        )
        if ($null -eq $selection) { return }
        if ($selection.Action -eq "ShowWebsiteMenu") { Show-WebsiteMenu } else { Invoke-MenuAction -SelectedAction $selection.Action }
    }
}

function Show-EfAppMenu {
    while ($true) {
        $selection = Read-MenuSelection -Title "EF App" -Options @(
            (New-MenuOption -Label "Setup" -Action "EfAppSetup"),
            (New-MenuOption -Label "Selftest" -Action "EfAppSelftest"),
            (New-MenuOption -Label "Caixa" -Action "EfAppCaixa"),
            (New-MenuOption -Label "Agenda Delta" -Action "EfAppAgendaDelta"),
            (New-MenuOption -Label "Agenda Full Sync" -Action "EfAppAgendaFullSync"),
            (New-MenuOption -Label "Booking API" -Action "EfAppBookingApi"),
            (New-MenuOption -Label "Procedures" -Action "EfAppProcedures"),
            (New-MenuOption -Label "Client Registration" -Action "EfAppClientRegistration"),
            (New-MenuOption -Label "Recorder" -Action "EfAppRecorder"),
            (New-MenuOption -Label "Rotate Agenda Sync Token" -Action "EfAppRotateAgendaSyncToken")
        )
        if ($null -eq $selection) { return }; Invoke-MenuAction -SelectedAction $selection.Action
    }
}

Invoke-ShortcutActionInternal -SelectedAction $Action
