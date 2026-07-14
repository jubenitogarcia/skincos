[CmdletBinding()]
param(
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$WorktreeRoot = "C:\CodexShared\Worktrees\skincos",
    [string]$RuntimeRoot = "C:\CodexRuntime\n8n"
)

$ErrorActionPreference = "Stop"

$projectPath = (Resolve-Path -LiteralPath $ProjectRoot).Path
$worktreePath = (Resolve-Path -LiteralPath $WorktreeRoot).Path
$runtimePath = (Resolve-Path -LiteralPath $RuntimeRoot).Path
if (
    $projectPath -ne "C:\CodexShared\Projetos\skincos" -or
    $worktreePath -ne "C:\CodexShared\Worktrees\skincos" -or
    $runtimePath -ne "C:\CodexRuntime\n8n"
) {
    throw "Refusing to change ACLs outside the canonical Skincos paths."
}

$checkpointDir = "C:\CodexRuntime\n8n\exports\acl-checkpoints"
New-Item -ItemType Directory -Force -Path $checkpointDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
@{
    project = (Get-Acl -LiteralPath $projectPath).Sddl
    worktrees = (Get-Acl -LiteralPath $worktreePath).Sddl
    runtime = (Get-Acl -LiteralPath $runtimePath).Sddl
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $checkpointDir "before-$stamp.json") -Encoding UTF8

$computer = $env:COMPUTERNAME
$projectGrants = @(
    "$computer\admin:(OI)(CI)F",
    "BUILTIN\Administrators:(OI)(CI)F",
    "NT AUTHORITY\SYSTEM:(OI)(CI)F",
    "$computer\CodexSandboxOnline:(OI)(CI)M",
    "$computer\CodexSandboxOffline:(OI)(CI)M"
)
$runtimeGrants = @(
    "$computer\admin:(OI)(CI)F",
    "BUILTIN\Administrators:(OI)(CI)F",
    "NT AUTHORITY\SYSTEM:(OI)(CI)F"
)

$projectRemovals = @(
    "*S-1-5-32-545",
    "*S-1-5-21-1182633975-599567309-3182644714-4013155633",
    "*S-1-5-21-2443940948-2127406767-3190474855-1951045344",
    "*S-1-5-21-87720828-1808323919-4046491666-1487586628"
)
$runtimeRemovals = @("*S-1-5-32-545")

foreach ($identityToRemove in $projectRemovals) {
    & icacls.exe $projectPath /remove:g $identityToRemove /Q | Out-Null
}
& icacls.exe $projectPath /inheritance:r /grant:r $projectGrants /Q | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Failed to apply project ACLs." }
foreach ($identityToRemove in $projectRemovals) {
    & icacls.exe $worktreePath /remove:g $identityToRemove /Q | Out-Null
}
& icacls.exe $worktreePath /inheritance:r /grant:r $projectGrants /Q | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Failed to apply worktree ACLs." }
foreach ($identityToRemove in $runtimeRemovals) {
    & icacls.exe $runtimePath /remove:g $identityToRemove /Q | Out-Null
}
& icacls.exe $runtimePath /inheritance:r /grant:r $runtimeGrants /Q | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Failed to apply runtime ACLs." }

Write-Host "Single-operator ACLs applied."
Write-Host "checkpoint=$checkpointDir\before-$stamp.json"
