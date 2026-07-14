param(
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$WorktreeRoot = "C:\CodexShared\Worktrees\skincos",
    [string]$RuntimeRoot = "C:\CodexRuntime\n8n",
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
    param([string]$Root)

    if (-not (Test-Path -LiteralPath $Root)) {
        return @()
    }

    $items = @()
    foreach ($actorDir in Get-ChildItem -LiteralPath $Root -Directory -Force | Sort-Object Name) {
        foreach ($taskDir in Get-ChildItem -LiteralPath $actorDir.FullName -Directory -Force | Sort-Object Name) {
            $branch = $null
            $gitTrusted = $false
            if (Test-Path -LiteralPath (Join-Path $taskDir.FullName '.git')) {
                $branchLines = @(Invoke-GitSafe -RepoPath $taskDir.FullName -Arguments @("rev-parse", "--abbrev-ref", "HEAD") | Where-Object {
                    -not [string]::IsNullOrWhiteSpace($_)
                })
                if ($branchLines.Count -gt 0) {
                    $branch = ([string]$branchLines[0]).Trim()
                    $gitTrusted = $true
                } else {
                    $branch = "untrusted-or-unavailable"
                }
            }

            $items += [pscustomobject]@{
                actor = $actorDir.Name
                task = $taskDir.Name
                path = $taskDir.FullName
                branch = $branch
                gitTrusted = $gitTrusted
            }
        }
    }

    return $items
}

$safeDirectories = @(git config --global --get-all safe.directory 2>$null)
$normalizedProjectRoot = Normalize-PathString -Path $ProjectRoot
$normalizedSafeDirectories = @($safeDirectories | ForEach-Object { Normalize-PathString -Path $_ })

$localStateRoot = Join-Path $env:LOCALAPPDATA "Codex\skincos"
$runtimeEnvRoot = Join-Path $RuntimeRoot "env"
$operatorRuntimeExists = Test-Path -LiteralPath $OperatorRuntimeRoot
$operatorRuntimeAcl = if ($operatorRuntimeExists) { Get-Acl -LiteralPath $OperatorRuntimeRoot } else { $null }
$status = [pscustomobject]@{
    currentUser = $env:USERNAME
    computerName = $env:COMPUTERNAME
    projectRoot = $ProjectRoot
    projectStatus = Get-GitStatusSummary -RepoPath $ProjectRoot
    worktreeRoot = $WorktreeRoot
    worktrees = @(Get-WorktreeSummary -Root $WorktreeRoot)
    safeDirectoryRegistered = $normalizedSafeDirectories -contains $normalizedProjectRoot
    safeDirectories = $safeDirectories
    localStateRoot = $localStateRoot
    localStateExists = Test-Path -LiteralPath $localStateRoot
    runtimeRoot = $RuntimeRoot
    runtimeExists = Test-Path -LiteralPath $RuntimeRoot
    operatorRuntimeRoot = $OperatorRuntimeRoot
    operatorRuntimeExists = $operatorRuntimeExists
    operatorRuntimeOwner = if ($operatorRuntimeAcl) { $operatorRuntimeAcl.Owner } else { $null }
    runtimeEnvRoot = $runtimeEnvRoot
    runtimeEnvFiles = @(
        "n8n.env",
        "n8n-business.env",
        "evolution-api.env"
    ) | ForEach-Object {
        $path = Join-Path $runtimeEnvRoot $_
        [pscustomobject]@{
            name = $_
            exists = Test-Path -LiteralPath $path
            path = $path
        }
    }
}

$status | ConvertTo-Json -Depth 5
