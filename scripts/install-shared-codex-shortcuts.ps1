param(
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$StartMenuRoot = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Skincos Codex",
    [string]$UserStartMenuRoot = (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Skincos Codex"),
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

function Ensure-Directory {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        try {
            New-Item -ItemType Directory -Path $Path -Force | Out-Null
        }
        catch [System.UnauthorizedAccessException] {
            throw "Access denied while creating '$Path'. Re-run this installer from an elevated PowerShell session to publish shared Start Menu shortcuts for all local users."
        }
    }
}

function Remove-DirectoryIfExists {
    param([string]$Path)

    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
}

function Test-SamePath {
    param(
        [string]$Left,
        [string]$Right
    )

    $leftFull = [System.IO.Path]::GetFullPath($Left).TrimEnd('\')
    $rightFull = [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
    return [string]::Equals($leftFull, $rightFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Clear-DirectoryContents {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    foreach ($item in Get-ChildItem -LiteralPath $Path -Force) {
        try {
            if ($item.PSIsContainer) {
                [System.IO.Directory]::Delete($item.FullName, $true)
            }
            else {
                [System.IO.File]::Delete($item.FullName)
            }
        }
        catch [System.UnauthorizedAccessException] {
            throw "Access denied while cleaning '$Path'. Re-run this installer from an elevated PowerShell session to publish shared Start Menu shortcuts for all local users."
        }
        catch {
            throw "Failed to clean '$($item.FullName)': $($_.Exception.Message)"
        }
    }
}

function New-ShortcutFile {
    param(
        [string]$ShortcutPath,
        [string]$TargetPath,
        [string]$Arguments,
        [string]$WorkingDirectory,
        [string]$Description
    )

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $TargetPath
    $shortcut.Arguments = $Arguments
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.Description = $Description
    $shortcut.IconLocation = "$TargetPath,0"
    try {
        $shortcut.Save()
    }
    catch [System.UnauthorizedAccessException] {
        throw "Access denied while saving '$ShortcutPath'. Re-run this installer from an elevated PowerShell session to publish shared Start Menu shortcuts for all local users."
    }
}

function Get-CrmLocalModuleCatalog {
    $catalogScript = Join-Path $ProjectRoot "scripts\crm-local-module-catalog.mjs"
    if (-not (Test-Path -LiteralPath $catalogScript)) {
        throw "CRM module catalog is missing: '$catalogScript'."
    }
    $wslInvoker = Join-Path $ProjectRoot "scripts\invoke-skincos-wsl.ps1"
    if (-not (Test-Path -LiteralPath $wslInvoker)) {
        throw "Typed WSL gateway is missing: '$wslInvoker'."
    }
    $raw = & $wslInvoker `
        -ProjectRoot $ProjectRoot `
        -Executable node `
        -ArgumentList @("./scripts/crm-local-module-catalog.mjs", "--json")
    if ($LASTEXITCODE -ne 0) {
        throw "The CRM module catalog could not be read through Ubuntu-24.04."
    }
    return ($raw -join "`n") | ConvertFrom-Json
}

if ($Uninstall) {
    Remove-DirectoryIfExists -Path $StartMenuRoot
    Remove-DirectoryIfExists -Path $UserStartMenuRoot
    [pscustomobject]@{
        action = "uninstall"
        startMenuRoot = $StartMenuRoot
        userStartMenuRoot = $UserStartMenuRoot
        removed = $true
    } | ConvertTo-Json -Depth 3
    exit 0
}

$runner = Join-Path $ProjectRoot "scripts\run-shared-codex-shortcut.ps1"
$powershellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

$shortcuts = @(
    @{ Name = "Workspace"; Action = "WorkspaceMenu"; Description = "Menu de bootstrap, validacao, WSL e GitHub do workspace Skincos." },
    @{ Name = "Contexto"; Action = "ContextMenu"; Description = "Menu de status, contexto e bootstrap de thread do Skincos." },
    @{ Name = "CRM – Local"; Action = "CrmLocal"; Description = "Inicia o CRM completo local com gate de todos os módulos." },
    @{ Name = "CRM – Módulos"; Action = "CrmModules"; Description = "Escolhe um módulo e um papel real em runtime local isolado." },
    @{ Name = "CRM – Prévia da Thread"; Action = "CrmThreadPreview"; Description = "Monta um snapshot privado do worktree atual em runtime local separado." },
    @{ Name = "EF App"; Action = "EfAppMenu"; Description = "Menu das automacoes do app.espacofacial.com.br." },
    @{ Name = "Orb"; Action = "OrbMenu"; Description = "Menu do runtime live do orb/n8n e utilitarios de suporte." }
)

function Install-ShortcutSet {
    param([string]$TargetRoot)

    Ensure-Directory -Path $TargetRoot
    Clear-DirectoryContents -Path $TargetRoot

    $installed = @()
    foreach ($shortcutSpec in $shortcuts) {
        $shortcutPath = Join-Path $TargetRoot ($shortcutSpec.Name + ".lnk")
        $arguments = '-NoExit -ExecutionPolicy Bypass -File "{0}" -Action {1} -ProjectRoot "{2}"' -f $runner, $shortcutSpec.Action, $ProjectRoot
        New-ShortcutFile -ShortcutPath $shortcutPath -TargetPath $powershellExe -Arguments $arguments -WorkingDirectory $ProjectRoot -Description $shortcutSpec.Description

        $installed += [pscustomobject]@{
            name = $shortcutSpec.Name
            action = $shortcutSpec.Action
            path = $shortcutPath
        }
    }

    $moduleRoot = Join-Path $TargetRoot "CRM – Módulos"
    Ensure-Directory -Path $moduleRoot
    $catalog = Get-CrmLocalModuleCatalog
    foreach ($spec in @($catalog.combinations)) {
        $shortcutName = "{0} – {1}" -f ([string]$spec.role), ([string]$spec.label)
        $shortcutPath = Join-Path $moduleRoot ($shortcutName + ".lnk")
        $arguments = '-NoExit -ExecutionPolicy Bypass -File "{0}" -Action CrmModule -CrmRole "{1}" -CrmModule "{2}" -ProjectRoot "{3}"' -f `
            $runner, ([string]$spec.role), ([string]$spec.module), $ProjectRoot
        $description = "Inicia $([string]$spec.label) como $([string]$spec.role) em runtime local isolado."
        New-ShortcutFile -ShortcutPath $shortcutPath -TargetPath $powershellExe -Arguments $arguments -WorkingDirectory $ProjectRoot -Description $description
        $installed += [pscustomobject]@{
            name = $shortcutName
            action = "CrmModule"
            role = [string]$spec.role
            module = [string]$spec.module
            path = $shortcutPath
        }
    }

    return $installed
}

$targetRoot = $StartMenuRoot
$mode = "shared"
$warning = $null

try {
    $installed = Install-ShortcutSet -TargetRoot $StartMenuRoot
    if (-not (Test-SamePath -Left $StartMenuRoot -Right $UserStartMenuRoot)) {
        try {
            Remove-DirectoryIfExists -Path $UserStartMenuRoot
        }
        catch {
            $warning = "Shared shortcuts were installed, but the stale current-user shortcut root could not be removed: $($_.Exception.Message)"
        }
    }
}
catch {
    if ($_.Exception.Message -notmatch "Access denied") {
        throw
    }

    $targetRoot = $UserStartMenuRoot
    $mode = "user-fallback"
    $warning = "Shared Start Menu write was denied in this Windows session. Shortcuts were installed for the current user only."
    $installed = Install-ShortcutSet -TargetRoot $UserStartMenuRoot
    if (-not (Test-SamePath -Left $StartMenuRoot -Right $UserStartMenuRoot)) {
        try {
            Remove-DirectoryIfExists -Path $StartMenuRoot
        }
        catch {
            $warning += " The shared shortcut root could not be cleaned; remove stale shared shortcuts from an elevated PowerShell session."
        }
        if (Test-Path -LiteralPath $StartMenuRoot) {
            $warning += " A shared shortcut root is still present and may expose stale entries."
        }
    }
}

[pscustomobject]@{
    action = "install"
    mode = $mode
    startMenuRoot = $targetRoot
    warning = $warning
    installed = $installed
} | ConvertTo-Json -Depth 4
