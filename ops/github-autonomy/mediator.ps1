[CmdletBinding()]
param(
    [ValidateSet('Inspect','Publish','Merge')][string]$Mode = 'Inspect',
    [Parameter(Mandatory)][string]$WorktreePath,
    [string]$Branch,
    [int]$PullRequest,
    [string]$RuntimeRoot,
    [string]$PolicyPath
)

. (Join-Path $PSScriptRoot 'lib.ps1')
$RuntimeRoot = Get-AutonomyRoot $RuntimeRoot
if ([string]::IsNullOrWhiteSpace($PolicyPath)) { $PolicyPath = Join-Path $PSScriptRoot 'gate-policy.json' }
Ensure-AutonomyLayout $RuntimeRoot
$config = Get-AutonomyConfig $RuntimeRoot
$policy = Get-AutonomyPolicy $PolicyPath

function Get-Candidate {
    if (-not (Test-Path -LiteralPath $WorktreePath)) { throw "Unknown worktree: $WorktreePath" }
    $changed = @(& git -C $WorktreePath diff --name-only origin/main...HEAD)
    $blocked = @()
    foreach ($path in $changed) {
        foreach ($forbidden in @($policy.forbidden_changed_paths)) {
            if ($path.Replace('/','\\').StartsWith(([string]$forbidden).Replace('/','\\'),[StringComparison]::OrdinalIgnoreCase)) { $blocked += $path }
        }
    }
    $status = @(& git -C $WorktreePath status --porcelain)
    $head = (& git -C $WorktreePath rev-parse HEAD).Trim()
    $currentBranch = (& git -C $WorktreePath branch --show-current).Trim()
    return @{ allowed=($blocked.Count -eq 0 -and $status.Count -eq 0); branch=$currentBranch; head_sha=$head; changed_paths=$changed; blocked_paths=$blocked; dirty=$status }
}

function Invoke-GitWithInstallationToken {
    param([string[]]$Arguments,[string]$Token)
    $askPass = Join-Path $RuntimeRoot ('state\\askpass-' + [Guid]::NewGuid().ToString('N') + '.cmd')
    [System.IO.File]::WriteAllText($askPass,"@echo off`r`necho %SKINCOS_GITHUB_AUTONOMY_TOKEN%`r`n",[System.Text.ASCIIEncoding]::new())
    $oldAskPass=$env:GIT_ASKPASS; $oldToken=$env:SKINCOS_GITHUB_AUTONOMY_TOKEN; $oldTerminal=$env:GIT_TERMINAL_PROMPT
    try {
        $env:GIT_ASKPASS=$askPass; $env:SKINCOS_GITHUB_AUTONOMY_TOKEN=$Token; $env:GIT_TERMINAL_PROMPT='0'
        & git @Arguments
        if ($LASTEXITCODE -ne 0) { throw "git failed with exit code $LASTEXITCODE" }
    } finally {
        $env:GIT_ASKPASS=$oldAskPass; $env:SKINCOS_GITHUB_AUTONOMY_TOKEN=$oldToken; $env:GIT_TERMINAL_PROMPT=$oldTerminal
        Remove-Item -LiteralPath $askPass -Force -ErrorAction SilentlyContinue
    }
}

$candidate = Get-Candidate
if ($Mode -eq 'Inspect') { $candidate | ConvertTo-Json -Depth 8; exit 0 }
if (-not $candidate.allowed) { throw "Candidate is not publishable. dirty=$($candidate.dirty.Count) blocked=$($candidate.blocked_paths -join ',')" }
if (-not $Branch) { $Branch=$candidate.branch }
if ($Branch -notmatch '^codex/admin/[A-Za-z0-9._/-]+$') { throw 'Only first-party codex/admin branches are publishable.' }

$token = Get-GitHubInstallationToken $config
try {
    if ($Mode -eq 'Publish') {
        Invoke-GitWithInstallationToken -Token $token -Arguments @('-C',$WorktreePath,'push','origin',("HEAD:refs/heads/{0}" -f $Branch))
        $existing = Invoke-GitHubApi -Method 'GET' -Path ("/repos/{0}/pulls?state=open&head={1}:{2}" -f $config.repository,($config.repository.Split('/')[0]),$Branch) -Token $token
        if (@($existing).Count -eq 0) {
            $created = Invoke-GitHubApi -Method 'POST' -Path ("/repos/{0}/pulls" -f $config.repository) -Token $token -Body @{title=("Codex autonomy: {0}" -f $Branch); head=$Branch; base='main'; body='Created by the isolated Skincos GitHub autonomy broker.'}
            Write-AutonomyLog $RuntimeRoot 'pr_created' @{branch=$Branch; pr=$created.number; sha=$candidate.head_sha}
            @{published=$true; pull_request=$created.number; sha=$candidate.head_sha} | ConvertTo-Json
        } else { @{published=$true; pull_request=$existing[0].number; sha=$candidate.head_sha; existing=$true} | ConvertTo-Json }
        exit 0
    }
    if ($PullRequest -lt 1) { throw '-PullRequest is required for Merge.' }
    $pr = Invoke-GitHubApi -Method 'GET' -Path ("/repos/{0}/pulls/{1}" -f $config.repository,$PullRequest) -Token $token
    if ([string]$pr.head.sha -ne $candidate.head_sha -or [string]$pr.head.ref -ne $Branch -or -not $pr.mergeable) { throw 'PR is not at the verified candidate SHA or is not mergeable.' }
    $checks = Invoke-GitHubApi -Method 'GET' -Path ("/repos/{0}/commits/{1}/check-runs?filter=latest&per_page=100" -f $config.repository,$candidate.head_sha) -Token $token
    $missing = @(); foreach ($required in @($policy.required_checks)) { $check=@($checks.check_runs | Where-Object {$_.name -eq $required}) | Select-Object -First 1; if ($null -eq $check -or [string]$check.conclusion -ne 'success') { $missing += $required } }
    if ($missing.Count) { throw ('Required checks not green: ' + ($missing -join ', ')) }
    $merged = Invoke-GitHubApi -Method 'PUT' -Path ("/repos/{0}/pulls/{1}/merge" -f $config.repository,$PullRequest) -Token $token -Body @{sha=$candidate.head_sha; merge_method='squash'}
    Write-AutonomyLog $RuntimeRoot 'pr_merged' @{branch=$Branch; pr=$PullRequest; sha=$candidate.head_sha; merged=$merged.merged}
    $merged | ConvertTo-Json -Depth 8
} finally { $token=$null }
