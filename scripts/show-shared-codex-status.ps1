param(
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$WorktreeRoot = (Join-Path $env:USERPROFILE '.codex\worktrees'),
    [string]$RuntimeRoot = "C:\CodexRuntime",
    [string]$OperatorRuntimeRoot = "C:\CodexRuntime\operator\admin\skincos"
)

$ErrorActionPreference = "Stop"

function Normalize-PathString {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    return $Path.Replace('\', '/').TrimEnd('/').ToLowerInvariant()
}

function Invoke-GitSafe {
    param(
        [string]$RepoPath,
        [string[]]$Arguments
    )

    $argumentList = @("-C", $RepoPath) + $Arguments
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = "git.exe"
    $startInfo.Arguments = (($argumentList | ForEach-Object {
        '"' + $_.Replace('"', '\"') + '"'
    }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo

    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()

        if ($process.ExitCode -ne 0) {
            return $null
        }
    }
    finally {
        $process.Dispose()
    }

    if ([string]::IsNullOrEmpty($stdout)) {
        return @()
    }

    return @($stdout -split "`r?`n" | Where-Object { $_ -ne "" })
}

function Get-GitStatusSummary {
    param([string]$RepoPath)

    $branchLines = @(Invoke-GitSafe -RepoPath $RepoPath -Arguments @("rev-parse", "--abbrev-ref", "HEAD") | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_)
    })
    $statusLines = @(Invoke-GitSafe -RepoPath $RepoPath -Arguments @("status", "--short") | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_)
    })
    $branch = if ($branchLines.Count -gt 0) { ([string]$branchLines[0]).Trim() } else { "untrusted-or-unavailable" }

    [pscustomobject]@{
        branch = $branch
        dirtyCount = $statusLines.Count
        isDirty = $statusLines.Count -gt 0
        sample = @($statusLines | Select-Object -First 10)
    }
}

function Get-WorktreeSummary {
    param([string]$Root, [string]$RepoPath)

    if (-not (Test-Path -LiteralPath $Root)) {
        return @()
    }

    $lines = @(Invoke-GitSafe -RepoPath $RepoPath -Arguments @('worktree', 'list', '--porcelain'))
    $records = @(); $current = $null
    foreach ($line in @($lines + '')) {
        if ($line -like 'worktree *') {
            if ($null -ne $current) { $records += [pscustomobject]$current }
            $current = [ordered]@{ path = $line.Substring(9); head = $null; branch = $null; detached = $false }
        }
        elseif ($null -ne $current -and $line -like 'HEAD *') { $current.head = $line.Substring(5) }
        elseif ($null -ne $current -and $line -match '^branch refs/heads/(.*)$') { $current.branch = $Matches[1] }
        elseif ($null -ne $current -and $line -eq 'detached') { $current.detached = $true }
    }
    if ($null -ne $current) { $records += [pscustomobject]$current }

    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $items = @()
    foreach ($record in $records) {
        $path = [IO.Path]::GetFullPath([string]$record.path).TrimEnd('\', '/')
        $parent = [IO.Path]::GetDirectoryName($path).TrimEnd('\', '/')
        if (-not $parent.Equals($rootPath, [StringComparison]::OrdinalIgnoreCase)) { continue }
        $leaf = [IO.Path]::GetFileName($path)
        $identity = if ($leaf -match '^(?<actor>.+)--(?<task>.+)$') { @{ actor = $Matches.actor; task = $Matches.task } } else { @{ actor = 'canonical-or-managed'; task = $leaf } }
        $statusLines = @(Invoke-GitSafe -RepoPath $path -Arguments @('status', '--short') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $items += [pscustomobject]@{
            actor = $identity.actor
            task = $identity.task
            path = $path
            branch = if ($record.branch) { [string]$record.branch } else { 'detached' }
            head = [string]$record.head
            dirtyCount = $statusLines.Count
            isDirty = $statusLines.Count -gt 0
            sample = @($statusLines | Select-Object -First 10)
            gitTrusted = $true
        }
    }

    return @($items | Sort-Object path)
}

$safeDirectories = @(Invoke-GitSafe -RepoPath $ProjectRoot -Arguments @('config', '--global', '--get-all', 'safe.directory') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$normalizedProjectRoot = Normalize-PathString -Path $ProjectRoot
$normalizedSafeDirectories = @($safeDirectories | ForEach-Object { Normalize-PathString -Path $_ })

$localStateRoot = Join-Path $env:LOCALAPPDATA "Codex\skincos"
$operatorRuntimeExists = Test-Path -LiteralPath $OperatorRuntimeRoot
$operatorRuntimeAcl = if ($operatorRuntimeExists) { Get-Acl -LiteralPath $OperatorRuntimeRoot } else { $null }
$status = [pscustomobject]@{
    currentUser = $env:USERNAME
    computerName = $env:COMPUTERNAME
    projectRoot = $ProjectRoot
    projectStatus = Get-GitStatusSummary -RepoPath $ProjectRoot
    worktreeRoot = $WorktreeRoot
    worktrees = @(Get-WorktreeSummary -Root $WorktreeRoot -RepoPath $ProjectRoot)
    safeDirectoryRegistered = $normalizedSafeDirectories -contains $normalizedProjectRoot
    safeDirectories = $safeDirectories
    localStateRoot = $localStateRoot
    localStateExists = Test-Path -LiteralPath $localStateRoot
    runtimeRoot = $RuntimeRoot
    runtimeExists = Test-Path -LiteralPath $RuntimeRoot
    operatorRuntimeRoot = $OperatorRuntimeRoot
    operatorRuntimeExists = $operatorRuntimeExists
    operatorRuntimeOwner = if ($operatorRuntimeAcl) { $operatorRuntimeAcl.Owner } else { $null }
    nativeStateRoot = "/var/lib/skincos-runtime"
    nativeConfigRoot = "/etc/skincos"
}

$status | ConvertTo-Json -Depth 5
