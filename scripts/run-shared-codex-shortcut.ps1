param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        "WorkspaceMenu",
        "ContextMenu",
        "LocalMenu",
        "EfAppMenu",
        "OrbMenu",
        "SharedSetup",
        "SharedValidate",
        "RuntimeSetup",
        "RuntimeValidate",
        "WslAccountBootstrap",
        "GitHubAuthLoginWsl",
        "GitHubAuthStatus",
        "SharedStatus",
        "CodexContext",
        "CodexContextOnline",
        "ThreadBootstrap",
        "NewWorktree",
        "WebsiteLocalStart",
        "WebsiteLocalStop",
        "WebsiteSiteCheck",
        "WebsiteReleaseCheck",
        "CrmLocal",
        "CrmSiteEf",
        "CrmMetaAds",
        "CrmAtendimento",
        "CrmAtendimentoMirrorStatus",
        "CrmAtendimentoMirrorSync",
        "CrmLocalStop",
        "CrmMemory",
        "CrmSiteSmoke",
        "CrmMetaAdsSmoke",
        "CrmAtendimentoSmoke",
        "PlatformLocalStart",
        "EfAppSetup",
        "EfAppSelftest",
        "EfAppCaixa",
        "EfAppAgendaDelta",
        "EfAppAgendaFullSync",
        "EfAppBookingApi",
        "EfAppProcedures",
        "EfAppClientRegistration",
        "EfAppRecorder",
        "EfAppRotateAgendaSyncToken",
        "OrbStatus",
        "OrbRestart",
        "OrbRepair",
        "OrbLogs",
        "MetaAdsPublishPreflight",
        "OrbValidate",
        "OrbBusinessValidate",
        "OrbAudit",
        "OrbSupportServicesApply",
        "OrbImportClinicWorkflowsLive"
    )]
    [string]$Action,
    [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-ProjectRoot {
    param(
        [string]$RequestedPath,
        [string]$ScriptDirectory
    )

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    $scriptProjectRoot = Split-Path -Parent $ScriptDirectory
    if ((Test-Path -LiteralPath (Join-Path $scriptProjectRoot ".git")) -or
        (Test-Path -LiteralPath (Join-Path $scriptProjectRoot "AGENTS.md"))) {
        return (Resolve-Path -LiteralPath $scriptProjectRoot).Path
    }

    $currentPath = (Get-Location).Path
    if ((Test-Path -LiteralPath (Join-Path $currentPath ".git")) -or
        (Test-Path -LiteralPath (Join-Path $currentPath "AGENTS.md"))) {
        return (Resolve-Path -LiteralPath $currentPath).Path
    }

    throw "Unable to resolve the Skincos project root automatically. Re-run the command from the project/worktree root or pass -ProjectRoot explicitly."
}

$ProjectRoot = Resolve-ProjectRoot -RequestedPath $ProjectRoot -ScriptDirectory $scriptRoot
$localStateRoot = Join-Path $env:LOCALAPPDATA "Codex\skincos"
$operatorRuntimeRoot = "C:\CodexRuntime\operator\admin\skincos"
$tmpRoot = Join-Path $localStateRoot "tmp"
$logRoot = Join-Path $operatorRuntimeRoot "logs"
$playwrightBrowsersRoot = Join-Path $operatorRuntimeRoot "playwright-browsers"
$crmBuildState = Join-Path $operatorRuntimeRoot "state\crm-local-build-state.env"
$wslInvoker = Join-Path $scriptRoot "invoke-skincos-wsl.ps1"

function Ensure-LocalState {
    foreach ($path in @(
        $localStateRoot,
        $tmpRoot,
        $logRoot,
        $playwrightBrowsersRoot,
        (Split-Path -Parent $crmBuildState),
        (Join-Path $operatorRuntimeRoot "scraper"),
        (Join-Path $operatorRuntimeRoot "scraper\report"),
        (Join-Path $operatorRuntimeRoot "scraper\debug"),
        (Join-Path $operatorRuntimeRoot "scraper\logs")
    )) {
        if (-not (Test-Path -LiteralPath $path)) {
            New-Item -ItemType Directory -Path $path -Force | Out-Null
        }
    }
}

function Convert-WindowsPathToWsl {
    param([string]$Path)

    if ($Path -match '^(?<drive>[A-Za-z]):\\(?<rest>.*)$') {
        $drive = $Matches.drive.ToLowerInvariant()
        $rest = $Matches.rest -replace '\\', '/'
        if ([string]::IsNullOrWhiteSpace($rest)) {
            return "/mnt/$drive"
        }
        return "/mnt/$drive/$rest"
    }

    return $Path
}

function Convert-ToBashLiteral {
    param([string]$Value)

    return "'" + $Value.Replace("'", "'""'""'") + "'"
}

function Invoke-ShortcutWsl {
    param(
        [string]$Command,
        [string[]]$EnvVar = @(),
        [int[]]$AcceptedExitCode = @(0),
        [switch]$SkipBootstrapCheck,
        [switch]$SkipNodeCheck,
        [switch]$SkipNpmCheck,
        [switch]$SkipGitCheck,
        [switch]$SkipRepoCheck
    )

    & $wslInvoker `
        -ProjectRoot $ProjectRoot `
        -RepoCommand $Command `
        -EnvVar $EnvVar `
        -SkipBootstrapCheck:$SkipBootstrapCheck `
        -SkipNodeCheck:$SkipNodeCheck `
        -SkipNpmCheck:$SkipNpmCheck `
        -SkipGitCheck:$SkipGitCheck `
        -SkipRepoCheck:$SkipRepoCheck

    if ($AcceptedExitCode -notcontains $LASTEXITCODE) {
        throw "The WSL command failed with exit code $LASTEXITCODE."
    }
}

function Invoke-RepoPowerShellScript {
    param([string]$ScriptName)

    & (Join-Path $scriptRoot $ScriptName) -ProjectRoot $ProjectRoot
}

function New-MenuOption {
    param(
        [string]$Label,
        [string]$Action
    )

    return [pscustomobject]@{
        Label = $Label
        Action = $Action
    }
}

function Read-MenuSelection {
    param(
        [string]$Title,
        [object[]]$Options,
        [string]$CancelLabel = "Voltar"
    )

    while ($true) {
        Write-Host ""
        Write-Host "== $Title ==" -ForegroundColor Cyan
        for ($index = 0; $index -lt $Options.Count; $index++) {
            Write-Host ("{0}. {1}" -f ($index + 1), $Options[$index].Label)
        }
        Write-Host ("0. {0}" -f $CancelLabel)

        $raw = Read-Host "Escolha uma opcao"
        $choice = 0
        if (-not [int]::TryParse($raw, [ref]$choice)) {
            Write-Host "Digite o numero da opcao desejada." -ForegroundColor Yellow
            continue
        }

        if ($choice -eq 0) {
            return $null
        }

        if ($choice -ge 1 -and $choice -le $Options.Count) {
            return $Options[$choice - 1]
        }

        Write-Host "Opcao invalida." -ForegroundColor Yellow
    }
}

function Pause-AfterMenuAction {
    Write-Host ""
    [void](Read-Host "Pressione ENTER para voltar ao menu")
}

Ensure-LocalState

$websitePid = Join-Path $tmpRoot "website-local-dev.pid"
$websiteLog = Join-Path $logRoot "website-local-dev.log"
$websitePort = Join-Path $tmpRoot "website-local-dev.port"
$sharedRoot = Split-Path (Split-Path $ProjectRoot -Parent) -Parent
$websiteSourceRoot = Join-Path $sharedRoot "Worktrees\skincos\shared\website-local-main"
$crmPid = Join-Path $tmpRoot "crm-local-dev.pid"
$crmLog = Join-Path $logRoot "crm-local-dev.log"
$atendimentoPid = Join-Path $tmpRoot "crm-atendimento-local.pid"
$atendimentoLog = Join-Path $logRoot "crm-atendimento-local.log"
$efAppStateRoot = Join-Path $localStateRoot "espacofacial-app"
$efAppArtifactRoot = Join-Path $operatorRuntimeRoot "scraper"
$efAppOutputRoot = Join-Path $efAppArtifactRoot "report"
$efAppDebugRoot = Join-Path $efAppArtifactRoot "debug"
$efAppLogRoot = Join-Path $efAppArtifactRoot "logs"
$efAppChromeProfileRoot = Join-Path $efAppStateRoot "chrome-profile"
$efAppBookingEnvFile = Join-Path $efAppStateRoot "booking_api.env"
$efAppAgendaSyncEnvFile = Join-Path $efAppStateRoot "agenda_sync.env"
$efAppLoginEnvFile = Join-Path $efAppStateRoot "login.env"

$tmpRootWsl = Convert-WindowsPathToWsl -Path $tmpRoot
$websitePidWsl = Convert-WindowsPathToWsl -Path $websitePid
$websiteLogWsl = Convert-WindowsPathToWsl -Path $websiteLog
$websitePortWsl = Convert-WindowsPathToWsl -Path $websitePort
$crmPidWsl = Convert-WindowsPathToWsl -Path $crmPid
$crmLogWsl = Convert-WindowsPathToWsl -Path $crmLog
$playwrightBrowsersRootWsl = Convert-WindowsPathToWsl -Path $playwrightBrowsersRoot
$crmBuildStateWsl = Convert-WindowsPathToWsl -Path $crmBuildState
$atendimentoPidWsl = Convert-WindowsPathToWsl -Path $atendimentoPid
$atendimentoLogWsl = Convert-WindowsPathToWsl -Path $atendimentoLog
$efAppOutputRootWsl = Convert-WindowsPathToWsl -Path $efAppOutputRoot

foreach ($path in @(
    $efAppStateRoot,
    $efAppOutputRoot,
    $efAppDebugRoot,
    $efAppLogRoot,
    $efAppChromeProfileRoot
)) {
    if (-not (Test-Path -LiteralPath $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

$efAppEnvVars = @(
    "EF_OUTPUT_DIR=$efAppOutputRoot",
    "EF_DEBUG_DIR=$efAppDebugRoot",
    "EF_LOG_DIR=$efAppLogRoot",
    "EF_CHROME_USER_DATA_DIR=$efAppChromeProfileRoot",
    "EF_BOOKING_ENV_FILE=$efAppBookingEnvFile",
    "EF_AGENDA_SYNC_ENV_FILE=$efAppAgendaSyncEnvFile",
    "EF_LOGIN_ENV_FILE=$efAppLoginEnvFile"
)

function Invoke-EfAppPythonMode {
    param(
        [string]$Mode,
        [string[]]$ExtraEnvVar = @(),
        [switch]$Headed
    )

    $headlessValue = if ($Headed) { "HEADLESS=0" } else { "HEADLESS=1" }
    Invoke-ShortcutWsl `
        -EnvVar ($efAppEnvVars + @("EF_MODE=$Mode", $headlessValue) + $ExtraEnvVar) `
        -SkipNodeCheck `
        -SkipNpmCheck `
        -Command "cd integration/ef && if [[ ! -x ./.venv/bin/python ]]; then echo 'Scraper venv is missing. Run EF App Setup first.'; exit 1; fi && ./.venv/bin/python run_scraper.py"
}

function Invoke-ShortcutActionInternal {
    param([string]$SelectedAction)

    switch ($SelectedAction) {
        "SharedSetup" { Invoke-RepoPowerShellScript -ScriptName "setup-shared-codex-workspace.ps1" }
        "SharedValidate" { Invoke-RepoPowerShellScript -ScriptName "validate-shared-codex-workspace.ps1" }
        "RuntimeSetup" { & (Join-Path $scriptRoot "setup-shared-runtime.ps1") }
        "RuntimeValidate" { & (Join-Path $scriptRoot "validate-shared-runtime.ps1") }
        "WslAccountBootstrap" {
            Invoke-ShortcutWsl -SkipBootstrapCheck -Command "cd orb/engine && bash scripts/bootstrap-imported-wsl-account.sh"
        }
        "GitHubAuthLoginWsl" {
            Invoke-ShortcutWsl `
                -SkipBootstrapCheck `
                -SkipNodeCheck `
                -SkipNpmCheck `
                -SkipGitCheck `
                -Command "gh auth login --web --git-protocol https --hostname github.com && gh auth status"
        }
        "GitHubAuthStatus" {
            & (Join-Path $scriptRoot "show-github-auth-status.ps1") -ProjectRoot $ProjectRoot
        }
        "SharedStatus" { Invoke-RepoPowerShellScript -ScriptName "show-shared-codex-status.ps1" }
        "CodexContext" { Invoke-ShortcutWsl -Command "bash ./scripts/codex-context.sh" }
        "CodexContextOnline" { Invoke-ShortcutWsl -Command "bash ./scripts/codex-context.sh --online" }
        "ThreadBootstrap" { & (Join-Path $scriptRoot "print-codex-thread-bootstrap.ps1") -Interactive }
        "NewWorktree" { & (Join-Path $scriptRoot "new-shared-worktree.ps1") -Fetch }
        "WebsiteLocalStart" {
            $websiteSourceWsl = Convert-ToBashLiteral -Value (Convert-WindowsPathToWsl -Path $websiteSourceRoot)
            $websiteLocalCommand = 'mkdir -p "$HOME/.cache/skincos-local-root/website" && rsync -a --delete --exclude node_modules --exclude .next {0}/website/ "$HOME/.cache/skincos-local-root/website/" && WEBSITE_SOURCE_ROOT="$HOME/.cache/skincos-local-root" WEBSITE_SKIP_WORKERD_CHECK=0 WEBSITE_STATE_DIR={1} WEBSITE_PID_FILE={2} WEBSITE_LOG_FILE={3} WEBSITE_PORT_FILE={4} WEBSITE_DETACH=1 OPEN_BROWSER=0 bash ./scripts/run-local-website.sh' -f `
                $websiteSourceWsl, `
                (Convert-ToBashLiteral -Value $tmpRootWsl), `
                (Convert-ToBashLiteral -Value $websitePidWsl), `
                (Convert-ToBashLiteral -Value $websiteLogWsl), `
                (Convert-ToBashLiteral -Value $websitePortWsl)
            Invoke-ShortcutWsl -Command $websiteLocalCommand
        }
        "WebsiteLocalStop" {
            Invoke-ShortcutWsl -Command ('WEBSITE_SOURCE_ROOT="$HOME/.cache/skincos-local-root" WEBSITE_STATE_DIR={0} WEBSITE_PID_FILE={1} WEBSITE_PORT_FILE={2} bash ./scripts/run-local-website.sh --stop' -f `
                (Convert-ToBashLiteral -Value $tmpRootWsl), `
                (Convert-ToBashLiteral -Value $websitePidWsl), `
                (Convert-ToBashLiteral -Value $websitePortWsl))
        }
        "WebsiteSiteCheck" { Invoke-ShortcutWsl -Command "npm run codex:site:check" }
        "WebsiteReleaseCheck" { Invoke-ShortcutWsl -Command "npm run codex:site:release-check" }
        "CrmLocal" {
            Invoke-ShortcutWsl -AcceptedExitCode @(0, 130, 143) -Command ("CRM_BUILD_BEFORE_START=auto CRM_OPEN_BROWSER=1 CRM_PID_FILE={0} CRM_LOG_FILE={1} CRM_PLAYWRIGHT_BROWSERS_PATH={2} CRM_BUILD_STATE_FILE={3} bash ./scripts/run-local-crm.sh --module conversa" -f `
                (Convert-ToBashLiteral -Value $crmPidWsl), `
                (Convert-ToBashLiteral -Value $crmLogWsl), `
                (Convert-ToBashLiteral -Value $playwrightBrowsersRootWsl), `
                (Convert-ToBashLiteral -Value $crmBuildStateWsl))
        }
        "CrmSiteEf" {
            Invoke-ShortcutWsl -AcceptedExitCode @(0, 130, 143) -Command ("CRM_PID_FILE={0} CRM_LOG_FILE={1} CRM_PLAYWRIGHT_BROWSERS_PATH={2} bash ./scripts/run-local-crm.sh --module site-tracking --meta-ads-scenario connected-ready" -f `
                (Convert-ToBashLiteral -Value $crmPidWsl), `
                (Convert-ToBashLiteral -Value $crmLogWsl), `
                (Convert-ToBashLiteral -Value $playwrightBrowsersRootWsl))
        }
        "CrmMetaAds" {
            Invoke-ShortcutWsl -AcceptedExitCode @(0, 130, 143) -Command ("CRM_PID_FILE={0} CRM_LOG_FILE={1} CRM_PLAYWRIGHT_BROWSERS_PATH={2} bash ./scripts/run-local-crm.sh --module meta-ads" -f `
                (Convert-ToBashLiteral -Value $crmPidWsl), `
                (Convert-ToBashLiteral -Value $crmLogWsl), `
                (Convert-ToBashLiteral -Value $playwrightBrowsersRootWsl))
        }
        "CrmAtendimento" {
            Invoke-ShortcutWsl -AcceptedExitCode @(0, 130, 143) -Command ("CRM_PID_FILE={0} CRM_LOG_FILE={1} CRM_PLAYWRIGHT_BROWSERS_PATH={2} bash ./scripts/run-local-atendimento.sh" -f `
                (Convert-ToBashLiteral -Value $atendimentoPidWsl), `
                (Convert-ToBashLiteral -Value $atendimentoLogWsl), `
                (Convert-ToBashLiteral -Value $playwrightBrowsersRootWsl))
        }
        "CrmAtendimentoMirrorStatus" { Invoke-ShortcutWsl -Command "npm run codex:crm:atendimento-mirror-status" }
        "CrmAtendimentoMirrorSync" { Invoke-ShortcutWsl -Command "npm run codex:crm:atendimento-mirror-sync -- --apply" }
        "CrmLocalStop" {
            Invoke-ShortcutWsl -Command ("CRM_PID_FILE={0} CRM_LOG_FILE={1} bash ./scripts/run-local-crm.sh --stop" -f `
                (Convert-ToBashLiteral -Value $crmPidWsl), `
                (Convert-ToBashLiteral -Value $crmLogWsl))
            Invoke-ShortcutWsl -Command ("CRM_PID_FILE={0} CRM_LOG_FILE={1} bash ./scripts/run-local-atendimento.sh --stop" -f `
                (Convert-ToBashLiteral -Value $atendimentoPidWsl), `
                (Convert-ToBashLiteral -Value $atendimentoLogWsl))
        }
        "CrmMemory" { Invoke-ShortcutWsl -Command "bash ./scripts/codex-memory-crm.sh" }
        "CrmSiteSmoke" {
            Invoke-ShortcutWsl `
                -EnvVar @("CRM_PLAYWRIGHT_BROWSERS_PATH=$playwrightBrowsersRoot") `
                -Command "npm run codex:crm:site-smoke"
        }
        "CrmMetaAdsSmoke" {
            Invoke-ShortcutWsl `
                -EnvVar @("CRM_PLAYWRIGHT_BROWSERS_PATH=$playwrightBrowsersRoot") `
                -Command "npm run codex:crm:meta-ads-smoke"
        }
        "CrmAtendimentoSmoke" {
            Invoke-ShortcutWsl `
                -EnvVar @("CRM_PLAYWRIGHT_BROWSERS_PATH=$playwrightBrowsersRoot") `
                -Command "npm run codex:crm:atendimento-smoke"
        }
        "PlatformLocalStart" { Invoke-ShortcutWsl -Command "OPEN_BROWSER=0 bash ./backend/scripts/dev.sh watch" }
        "EfAppSetup" {
            Invoke-ShortcutWsl `
                -EnvVar $efAppEnvVars `
                -SkipNodeCheck `
                -SkipNpmCheck `
                -Command "cd integration/ef && if ! command -v python3 >/dev/null 2>&1; then echo 'python3 is not available in WSL. Install Python 3 before using the Espaço Facial app automations.'; exit 1; fi && if [[ ! -d .venv ]]; then python3 -m venv .venv; fi && ./.venv/bin/python -m pip install --upgrade pip && ./.venv/bin/pip install -r requirements.lock"
        }
        "EfAppSelftest" {
            Invoke-ShortcutWsl `
                -EnvVar ($efAppEnvVars + @("HEADLESS=1")) `
                -SkipNodeCheck `
                -SkipNpmCheck `
                -Command "cd integration/ef && if [[ ! -x ./.venv/bin/python ]]; then echo 'Scraper venv is missing. Run EF App Setup first.'; exit 1; fi && ./.venv/bin/python selftest.py"
        }
        "EfAppCaixa" { Invoke-EfAppPythonMode -Mode "caixa" }
        "EfAppAgendaDelta" { Invoke-EfAppPythonMode -Mode "agenda_delta" }
        "EfAppAgendaFullSync" {
            Invoke-ShortcutWsl `
                -EnvVar ($efAppEnvVars + @("HEADLESS=1", "EF_OUTPUT_BASE_DIR=$efAppOutputRoot")) `
                -SkipNodeCheck `
                -SkipNpmCheck `
                -Command "cd integration/ef && if [[ ! -x ./.venv/bin/python ]]; then echo 'Scraper venv is missing. Run EF App Setup first.'; exit 1; fi && bash ./run_agenda_full_sync_all_units.sh"
        }
        "EfAppBookingApi" { Invoke-EfAppPythonMode -Mode "booking_api" }
        "EfAppProcedures" { Invoke-EfAppPythonMode -Mode "procedures" }
        "EfAppClientRegistration" {
            throw "The client registration export is still documented in integration/ef/README.md, but no runnable implementation is wired in run_scraper.py yet."
        }
        "EfAppRecorder" { Invoke-EfAppPythonMode -Mode "recorder" -Headed }
        "EfAppRotateAgendaSyncToken" {
            Invoke-ShortcutWsl `
                -EnvVar $efAppEnvVars `
                -Command "cd integration/ef && bash ./scripts/rotate_agenda_sync_token.sh --website-dir ../../../../website"
        }
        "OrbStatus" {
            Invoke-ShortcutWsl -Command "bash scripts/runtime/manage-native-runtime.sh status"
        }
        "OrbRestart" {
            Invoke-ShortcutWsl -Command "bash scripts/runtime/manage-native-runtime.sh restart"
        }
        "OrbRepair" {
            Invoke-ShortcutWsl -Command "bash scripts/runtime/prepare-lifecycle-layout.sh --apply && bash scripts/runtime/install-lifecycle-units.sh --apply && bash scripts/runtime/manage-native-runtime.sh restart && bash scripts/runtime/manage-native-runtime.sh validate"
        }
        "OrbLogs" {
            Invoke-ShortcutWsl -Command "bash scripts/runtime/manage-native-runtime.sh logs 200"
        }
        "MetaAdsPublishPreflight" {
            Invoke-ShortcutWsl -Command "cd orb/engine && bash scripts/validate-meta-ads-publish-preflight.sh"
        }
        "OrbValidate" {
            Invoke-ShortcutWsl -Command "bash scripts/runtime/manage-native-runtime.sh validate"
        }
        "OrbBusinessValidate" {
            Invoke-ShortcutWsl -Command "cd orb/engine && bash scripts/validate-mini-pc-business-readiness.sh"
        }
        "OrbAudit" {
            Invoke-ShortcutWsl -Command "cd orb/engine && bash scripts/audit-mini-pc-service-footprint.sh"
        }
        "OrbSupportServicesApply" {
            Invoke-ShortcutWsl -Command "bash ./scripts/runtime/install-lifecycle-units.sh --apply"
        }
        "OrbImportClinicWorkflowsLive" {
            $importChoice = Read-MenuSelection `
                -Title "Import Clinic Workflows Live" `
                -Options @(
                    (New-MenuOption -Label "Dry Run" -Action "DryRun"),
                    (New-MenuOption -Label "Apply" -Action "Apply")
                ) `
                -CancelLabel "Cancelar"
            if ($null -eq $importChoice) {
                return
            }

            $projectId = Read-Host "Project ID do n8n live (ENTER para detectar automaticamente)"
            $applyFlag = if ($importChoice.Action -eq "Apply") { " --apply" } else { "" }
            $projectArg = if ([string]::IsNullOrWhiteSpace($projectId)) {
                ""
            }
            else {
                " --project-id " + (Convert-ToBashLiteral -Value $projectId)
            }

            Invoke-ShortcutWsl -Command ("cd orb/engine && bash scripts/import-clinic-workflows-live.sh{0}{1}" -f $applyFlag, $projectArg)
        }
        "WorkspaceMenu" { Show-WorkspaceMenu }
        "ContextMenu" { Show-ContextMenu }
        "LocalMenu" { Show-LocalMenu }
        "EfAppMenu" { Show-EfAppMenu }
        "OrbMenu" { Show-OrbMenu }
        default {
            throw "Unsupported action: $SelectedAction"
        }
    }
}

function Invoke-MenuAction {
    param([string]$SelectedAction)

    try {
        Invoke-ShortcutActionInternal -SelectedAction $SelectedAction
    }
    catch {
        Write-Host ""
        Write-Host ("ERRO: {0}" -f $_.Exception.Message) -ForegroundColor Red
    }

    if ($SelectedAction -notin @("WorkspaceMenu", "ContextMenu", "LocalMenu", "EfAppMenu", "OrbMenu")) {
        Pause-AfterMenuAction
    }
}

function Show-WorkspaceMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "Workspace" `
            -Options @(
                (New-MenuOption -Label "Shared Setup" -Action "SharedSetup"),
                (New-MenuOption -Label "Shared Validate" -Action "SharedValidate"),
                (New-MenuOption -Label "Runtime Setup" -Action "RuntimeSetup"),
                (New-MenuOption -Label "Runtime Validate" -Action "RuntimeValidate"),
                (New-MenuOption -Label "WSL Account Bootstrap" -Action "WslAccountBootstrap"),
                (New-MenuOption -Label "GitHub Auth Login (WSL)" -Action "GitHubAuthLoginWsl"),
                (New-MenuOption -Label "GitHub Auth Status" -Action "GitHubAuthStatus")
            )
        if ($null -eq $selection) {
            return
        }
        Invoke-MenuAction -SelectedAction $selection.Action
    }
}

function Show-ContextMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "Contexto" `
            -Options @(
                (New-MenuOption -Label "Shared Status" -Action "SharedStatus"),
                (New-MenuOption -Label "Codex Context" -Action "CodexContext"),
                (New-MenuOption -Label "Codex Context Online" -Action "CodexContextOnline"),
                (New-MenuOption -Label "Thread Bootstrap" -Action "ThreadBootstrap"),
                (New-MenuOption -Label "New Worktree" -Action "NewWorktree")
            )
        if ($null -eq $selection) {
            return
        }
        Invoke-MenuAction -SelectedAction $selection.Action
    }
}

function Show-WebsiteMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "Local > Website" `
            -Options @(
                (New-MenuOption -Label "Start" -Action "WebsiteLocalStart"),
                (New-MenuOption -Label "Stop" -Action "WebsiteLocalStop"),
                (New-MenuOption -Label "Site Check" -Action "WebsiteSiteCheck"),
                (New-MenuOption -Label "Release Check" -Action "WebsiteReleaseCheck")
            )
        if ($null -eq $selection) {
            return
        }
        Invoke-MenuAction -SelectedAction $selection.Action
    }
}

function Show-CrmMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "Local > CRM" `
            -Options @(
                (New-MenuOption -Label "CRM Local" -Action "CrmLocal"),
                (New-MenuOption -Label "CRM Site EF" -Action "CrmSiteEf"),
                (New-MenuOption -Label "CRM Meta Ads" -Action "CrmMetaAds"),
                (New-MenuOption -Label "CRM Atendimento" -Action "CrmAtendimento"),
                (New-MenuOption -Label "CRM Atendimento - Status do Clone" -Action "CrmAtendimentoMirrorStatus"),
                (New-MenuOption -Label "CRM Atendimento - Atualizar Clone" -Action "CrmAtendimentoMirrorSync"),
                (New-MenuOption -Label "CRM Local Stop" -Action "CrmLocalStop"),
                (New-MenuOption -Label "CRM Memory" -Action "CrmMemory"),
                (New-MenuOption -Label "CRM Site Smoke" -Action "CrmSiteSmoke"),
                (New-MenuOption -Label "CRM Meta Ads Smoke" -Action "CrmMetaAdsSmoke"),
                (New-MenuOption -Label "CRM Atendimento Smoke" -Action "CrmAtendimentoSmoke")
            )
        if ($null -eq $selection) {
            return
        }
        Invoke-MenuAction -SelectedAction $selection.Action
    }
}

function Show-LocalMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "Local" `
            -Options @(
                (New-MenuOption -Label "Website" -Action "ShowWebsiteMenu"),
                (New-MenuOption -Label "CRM" -Action "ShowCrmMenu"),
                (New-MenuOption -Label "Platform Local" -Action "PlatformLocalStart")
            )
        if ($null -eq $selection) {
            return
        }

        switch ($selection.Action) {
            "ShowWebsiteMenu" { Show-WebsiteMenu }
            "ShowCrmMenu" { Show-CrmMenu }
            default { Invoke-MenuAction -SelectedAction $selection.Action }
        }
    }
}

function Show-EfAppMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "EF App" `
            -Options @(
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
        if ($null -eq $selection) {
            return
        }
        Invoke-MenuAction -SelectedAction $selection.Action
    }
}

function Show-OrbMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "Orb" `
            -Options @(
                (New-MenuOption -Label "Status" -Action "OrbStatus"),
                (New-MenuOption -Label "Restart" -Action "OrbRestart"),
                (New-MenuOption -Label "Logs" -Action "OrbLogs"),
                (New-MenuOption -Label "Meta Ads Publish Preflight" -Action "MetaAdsPublishPreflight"),
                (New-MenuOption -Label "Validate" -Action "OrbValidate"),
                (New-MenuOption -Label "Business Validate" -Action "OrbBusinessValidate"),
                (New-MenuOption -Label "Audit" -Action "OrbAudit"),
                (New-MenuOption -Label "Repair" -Action "OrbRepair"),
                (New-MenuOption -Label "Support Services Apply" -Action "OrbSupportServicesApply"),
                (New-MenuOption -Label "Import Clinic Workflows Live" -Action "OrbImportClinicWorkflowsLive")
            )
        if ($null -eq $selection) {
            return
        }
        Invoke-MenuAction -SelectedAction $selection.Action
    }
}

Invoke-ShortcutActionInternal -SelectedAction $Action
