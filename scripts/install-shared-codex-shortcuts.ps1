param(
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$StartMenuRoot = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Skincos Codex",
    [string]$UserStartMenuRoot = (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Skincos Codex"),
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

function Ensure-Directory { param([string]$Path); if (-not (Test-Path -LiteralPath $Path)) { New-Item -ItemType Directory -Path $Path -Force | Out-Null } }
function Clear-DirectoryContents {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    foreach ($item in Get-ChildItem -LiteralPath $Path -Force) {
        if ($item.PSIsContainer) { [IO.Directory]::Delete($item.FullName, $true) } else { [IO.File]::Delete($item.FullName) }
    }
}
function New-ShortcutFile {
    param([string]$ShortcutPath, [string]$TargetPath, [string]$Arguments, [string]$WorkingDirectory, [string]$Description)
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $TargetPath; $shortcut.Arguments = $Arguments
    $shortcut.WorkingDirectory = $WorkingDirectory; $shortcut.Description = $Description
    $shortcut.IconLocation = "$TargetPath,0"; $shortcut.Save()
}

if ($Uninstall) {
    foreach ($root in @($StartMenuRoot, $UserStartMenuRoot)) {
        if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
    }
    [pscustomobject]@{ action = "uninstall"; removed = $true } | ConvertTo-Json
    exit 0
}

$runner = Join-Path $ProjectRoot "scripts\run-shared-codex-shortcut.ps1"
$powershellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcuts = @(
    @{ Name = "Workspace"; Action = "WorkspaceMenu"; Description = "Bootstrap, validação, WSL e GitHub do workspace." },
    @{ Name = "Contexto"; Action = "ContextMenu"; Description = "Status, contexto e bootstrap de tarefas." },
    @{ Name = "EF App"; Action = "EfAppMenu"; Description = "Automação do app.espacofacial.com.br." },
    @{ Name = "Orb"; Action = "OrbMenu"; Description = "Operações do projeto independente Orb/n8n." }
)

function Install-ShortcutSet {
    param([string]$TargetRoot)
    Ensure-Directory -Path $TargetRoot; Clear-DirectoryContents -Path $TargetRoot
    $installed = @()
    foreach ($spec in $shortcuts) {
        $shortcutPath = Join-Path $TargetRoot ($spec.Name + ".lnk")
        $arguments = '-NoExit -ExecutionPolicy Bypass -File "{0}" -Action {1} -ProjectRoot "{2}"' -f $runner, $spec.Action, $ProjectRoot
        New-ShortcutFile -ShortcutPath $shortcutPath -TargetPath $powershellExe -Arguments $arguments -WorkingDirectory $ProjectRoot -Description $spec.Description
        $installed += [pscustomobject]@{ name = $spec.Name; action = $spec.Action; path = $shortcutPath }
    }
    return $installed
}

$targetRoot = $StartMenuRoot; $mode = "shared"; $warning = $null
try { $installed = @(Install-ShortcutSet -TargetRoot $targetRoot) }
catch [System.UnauthorizedAccessException] {
    $targetRoot = $UserStartMenuRoot; $mode = "user"; $warning = $_.Exception.Message
    $installed = @(Install-ShortcutSet -TargetRoot $targetRoot)
}

[pscustomobject]@{
    action = "install"
    mode = $mode
    targetRoot = $targetRoot
    warning = $warning
    shortcuts = $installed
} | ConvertTo-Json -Depth 4
