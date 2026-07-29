[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9a-fA-F]{7,64}$')]
    [string]$ReleaseSha,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9a-fA-F]{7,64}$')]
    [string]$ParentReleaseSha,

    [string]$RepositoryRoot = (Join-Path $PSScriptRoot '..\..'),

    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-VerifiedGit {
    param([string[]]$Arguments)
    $result = & git -C $resolvedRepository @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Git verification failed: git $($Arguments -join ' ')"
    }
    return ($result | Out-String).Trim()
}

$resolvedRepository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$inside = Invoke-VerifiedGit -Arguments @('rev-parse', '--is-inside-work-tree')
if ($inside -ne 'true') {
    throw 'RepositoryRoot must be a Git worktree.'
}

$release = (Invoke-VerifiedGit -Arguments @('rev-parse', "$ReleaseSha^{commit}")).ToLowerInvariant()
$parent = (Invoke-VerifiedGit -Arguments @('rev-parse', "$ParentReleaseSha^{commit}")).ToLowerInvariant()
$originMain = (Invoke-VerifiedGit -Arguments @('rev-parse', 'origin/main')).ToLowerInvariant()

& git -C $resolvedRepository merge-base --is-ancestor $parent $release
if ($LASTEXITCODE -ne 0) {
    throw 'The declared parent release is not an ancestor of the candidate release.'
}
& git -C $resolvedRepository merge-base --is-ancestor $release $originMain
if ($LASTEXITCODE -ne 0) {
    throw 'The candidate release is not an ancestor of origin/main.'
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $env:SystemDrive "CodexRuntime\operator\admin\skincos\native-releases\$release\lineage.json"
}
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$repositoryPrefix = [IO.Path]::GetFullPath($resolvedRepository).TrimEnd('\') + '\'
if ($resolvedOutput.StartsWith($repositoryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Lineage output must be private operator evidence, not a repository file.'
}

$record = [ordered]@{
    releaseId        = $release
    parentReleaseId  = $parent
    verifiedAncestor = $true
    verifiedAgainst  = 'origin/main'
    verifiedAtUtc    = (Get-Date).ToUniversalTime().ToString('o')
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedOutput) | Out-Null
$json = $record | ConvertTo-Json -Depth 3
[IO.File]::WriteAllText($resolvedOutput, $json, (New-Object System.Text.UTF8Encoding($false)))
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedOutput).Hash.ToLowerInvariant()

[pscustomobject]@{
    ReleaseSha       = $release
    ParentReleaseSha = $parent
    OriginMain       = $originMain
    OutputPath       = $resolvedOutput
    Sha256           = $hash
} | ConvertTo-Json -Compress
