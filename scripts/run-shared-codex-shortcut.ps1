param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        "SharedSetup",
        "SharedValidate",
        "RuntimeSetup",
        "RuntimeValidate",
        "WslAccountBootstrap",
        "SharedStatus",
        "CodexContext",
        "ThreadBootstrap",
        "NewWorktree",
        "WebsiteLocalStart",
        "WebsiteLocalStop",
        "CrmLocal",
        "CrmSiteEf",
        "CrmMetaAds",
        "CrmAtendimentoClinica",
        "CrmLocalStop",
        "OrbStatus",
        "OrbRestart",
        "OrbLogs",
        "OrbValidate",
        "OrbAudit",
        "OrbRepair"
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
$tmpRoot = Join-Path $localStateRoot "tmp"
$logRoot = Join-Path $localStateRoot "logs"
$wslInvoker = Join-Path $scriptRoot "invoke-skincos-wsl.ps1"

function Ensure-LocalState {
    foreach ($path in @($localStateRoot, $tmpRoot, $logRoot)) {
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
        [switch]$SkipBootstrapCheck
    )

    & $wslInvoker -ProjectRoot $ProjectRoot -RepoCommand $Command -SkipBootstrapCheck:$SkipBootstrapCheck
}

function Invoke-RepoPowerShellScript {
    param([string]$ScriptName)

    & (Join-Path $scriptRoot $ScriptName) -ProjectRoot $ProjectRoot
}

Ensure-LocalState

$websitePid = Join-Path $tmpRoot "website-local-dev.pid"
$websiteLog = Join-Path $logRoot "website-local-dev.log"
$websitePort = Join-Path $tmpRoot "website-local-dev.port"
$crmPid = Join-Path $tmpRoot "crm-local-dev.pid"
$crmLog = Join-Path $logRoot "crm-local-dev.log"
$atendimentoPid = Join-Path $tmpRoot "crm-atendimento-clinica-local.pid"
$atendimentoLog = Join-Path $logRoot "crm-atendimento-clinica-local.log"

$tmpRootWsl = Convert-WindowsPathToWsl -Path $tmpRoot
$websitePidWsl = Convert-WindowsPathToWsl -Path $websitePid
$websiteLogWsl = Convert-WindowsPathToWsl -Path $websiteLog
$websitePortWsl = Convert-WindowsPathToWsl -Path $websitePort
$crmPidWsl = Convert-WindowsPathToWsl -Path $crmPid
$crmLogWsl = Convert-WindowsPathToWsl -Path $crmLog
$atendimentoPidWsl = Convert-WindowsPathToWsl -Path $atendimentoPid
$atendimentoLogWsl = Convert-WindowsPathToWsl -Path $atendimentoLog

switch ($Action) {
    "SharedSetup" { Invoke-RepoPowerShellScript -ScriptName "setup-shared-codex-workspace.ps1" }
    "SharedValidate" { Invoke-RepoPowerShellScript -ScriptName "validate-shared-codex-workspace.ps1" }
    "RuntimeSetup" { & (Join-Path $scriptRoot "setup-shared-runtime.ps1") }
    "RuntimeValidate" { & (Join-Path $scriptRoot "validate-shared-runtime.ps1") }
    "WslAccountBootstrap" {
        Invoke-ShortcutWsl -SkipBootstrapCheck -Command "cd modules/automations/n8n && bash scripts/bootstrap-imported-wsl-account.sh"
    }
    "SharedStatus" { Invoke-RepoPowerShellScript -ScriptName "show-shared-codex-status.ps1" }
    "CodexContext" { Invoke-ShortcutWsl -Command "bash ./scripts/codex-context.sh" }
    "ThreadBootstrap" { & (Join-Path $scriptRoot "print-codex-thread-bootstrap.ps1") -Interactive }
    "NewWorktree" { & (Join-Path $scriptRoot "new-shared-worktree.ps1") -Fetch }
    "WebsiteLocalStart" {
        Invoke-ShortcutWsl -Command ("WEBSITE_STATE_DIR={0} WEBSITE_PID_FILE={1} WEBSITE_LOG_FILE={2} WEBSITE_PORT_FILE={3} WEBSITE_DETACH=1 OPEN_BROWSER=0 bash ./scripts/run-local-website.sh" -f `
            (Convert-ToBashLiteral -Value $tmpRootWsl), `
            (Convert-ToBashLiteral -Value $websitePidWsl), `
            (Convert-ToBashLiteral -Value $websiteLogWsl), `
            (Convert-ToBashLiteral -Value $websitePortWsl))
    }
    "WebsiteLocalStop" {
        Invoke-ShortcutWsl -Command ("WEBSITE_STATE_DIR={0} WEBSITE_PID_FILE={1} WEBSITE_PORT_FILE={2} bash ./scripts/run-local-website.sh --stop" -f `
            (Convert-ToBashLiteral -Value $tmpRootWsl), `
            (Convert-ToBashLiteral -Value $websitePidWsl), `
            (Convert-ToBashLiteral -Value $websitePortWsl))
    }
    "CrmLocal" {
        Invoke-ShortcutWsl -Command ("CRM_PID_FILE={0} CRM_LOG_FILE={1} bash ./scripts/run-local-crm.sh" -f `
            (Convert-ToBashLiteral -Value $crmPidWsl), `
            (Convert-ToBashLiteral -Value $crmLogWsl))
    }
    "CrmSiteEf" {
        Invoke-ShortcutWsl -Command ("CRM_PID_FILE={0} CRM_LOG_FILE={1} bash ./scripts/run-local-crm.sh --module site-tracking --meta-ads-scenario connected-ready" -f `
            (Convert-ToBashLiteral -Value $crmPidWsl), `
            (Convert-ToBashLiteral -Value $crmLogWsl))
    }
    "CrmMetaAds" {
        Invoke-ShortcutWsl -Command ("CRM_PID_FILE={0} CRM_LOG_FILE={1} bash ./scripts/run-local-crm.sh --module meta-ads" -f `
            (Convert-ToBashLiteral -Value $crmPidWsl), `
            (Convert-ToBashLiteral -Value $crmLogWsl))
    }
    "CrmAtendimentoClinica" {
        Invoke-ShortcutWsl -Command ("CRM_PID_FILE={0} CRM_LOG_FILE={1} bash ./scripts/run-local-atendimento-clinica.sh" -f `
            (Convert-ToBashLiteral -Value $atendimentoPidWsl), `
            (Convert-ToBashLiteral -Value $atendimentoLogWsl))
    }
    "CrmLocalStop" {
        Invoke-ShortcutWsl -Command ("CRM_PID_FILE={0} CRM_LOG_FILE={1} bash ./scripts/run-local-atendimento-clinica.sh --stop" -f `
            (Convert-ToBashLiteral -Value $atendimentoPidWsl), `
            (Convert-ToBashLiteral -Value $atendimentoLogWsl))
        Invoke-ShortcutWsl -Command ("CRM_PID_FILE={0} CRM_LOG_FILE={1} bash ./scripts/run-local-crm.sh --stop" -f `
            (Convert-ToBashLiteral -Value $crmPidWsl), `
            (Convert-ToBashLiteral -Value $crmLogWsl))
    }
    "OrbStatus" {
        Invoke-ShortcutWsl -Command "cd modules/automations/n8n && bash scripts/manage-mini-pc-system-services.sh status"
    }
    "OrbRestart" {
        Invoke-ShortcutWsl -Command "cd modules/automations/n8n && bash scripts/manage-mini-pc-system-services.sh restart"
    }
    "OrbLogs" {
        Invoke-ShortcutWsl -Command "cd modules/automations/n8n && bash scripts/manage-mini-pc-system-services.sh logs 200"
    }
    "OrbValidate" {
        Invoke-ShortcutWsl -Command "cd modules/automations/n8n && bash scripts/validate-mini-pc-system-runtime.sh"
    }
    "OrbAudit" {
        Invoke-ShortcutWsl -Command "cd modules/automations/n8n && bash scripts/audit-mini-pc-service-footprint.sh"
    }
    "OrbRepair" {
        Invoke-ShortcutWsl -Command "cd modules/automations/n8n && bash scripts/reconcile-mini-pc-runtime-postgres.sh"
    }
}
