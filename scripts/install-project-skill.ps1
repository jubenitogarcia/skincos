[CmdletBinding()]
param(
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$skillName = 'skincos-project-orchestrator'
$source = Join-Path $repoRoot "skills\$skillName"
$targetRoot = Join-Path $env:USERPROFILE '.agents\skills'
$target = Join-Path $targetRoot $skillName

if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md'))) {
    throw "Versioned skill source was not found: $source"
}

if ($Uninstall) {
    if (Test-Path -LiteralPath $target) {
        $item = Get-Item -LiteralPath $target -Force
        if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing to remove a non-link skill directory: $target"
        }
        Remove-Item -LiteralPath $target -Force
        Write-Output "Removed local skill link: $target"
    } else {
        Write-Output "No local skill link found: $target"
    }
    exit 0
}

New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null

if (Test-Path -LiteralPath $target) {
    $item = Get-Item -LiteralPath $target -Force
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "A non-link directory already occupies the skill target: $target"
    }

    $resolvedTarget = $item.Target | Select-Object -First 1
    if ($resolvedTarget -and ((Resolve-Path -LiteralPath $resolvedTarget).Path -eq (Resolve-Path -LiteralPath $source).Path)) {
        Write-Output "Local skill link already current: $target"
        exit 0
    }

    throw "A different skill link already occupies the target: $target"
}

New-Item -ItemType Junction -Path $target -Target $source | Out-Null
Write-Output "Installed local skill link: $target -> $source"
