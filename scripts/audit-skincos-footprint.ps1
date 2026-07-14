param(
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$WorktreeRoot = "C:\CodexShared\Worktrees\skincos",
    [string]$RuntimeRoot = "C:\CodexRuntime\n8n",
    [switch]$FailOnDrift
)

$ErrorActionPreference = "Stop"

function Get-DirectoryFootprint {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return [pscustomobject]@{ path = $Path; exists = $false; files = 0; bytes = 0 }
    }

    $entries = @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue)
    $directFiles = @($entries | Where-Object { -not $_.PSIsContainer })

    return [pscustomobject]@{
        path = $Path
        exists = $true
        scope = "top-level"
        items = $entries.Count
        directFiles = $directFiles.Count
        directBytes = [int64]($directFiles | Measure-Object -Property Length -Sum).Sum
    }
}

function Get-GitOutput {
    param([string[]]$Arguments)
    return @(& git -C $ProjectRoot @Arguments 2>$null)
}

function Get-WorktreeAudit {
    $records = @()
    $lines = @(Get-GitOutput -Arguments @("worktree", "list", "--porcelain"))
    $current = $null

    foreach ($line in $lines + "") {
        if ($line -like "worktree *") {
            $current = [ordered]@{ path = $line.Substring(9); branch = $null }
            continue
        }
        if ($line -like "branch refs/heads/*" -and $current) {
            $current.branch = $line.Substring(18)
            continue
        }
        if ([string]::IsNullOrWhiteSpace($line) -and $current) {
            $path = [string]$current.path
            $dirty = @(& git -C $path status --porcelain 2>$null).Count
            $merged = $false
            if ($current.branch -and $current.branch -ne "main") {
                & git -C $ProjectRoot merge-base --is-ancestor $current.branch origin/main 2>$null
                $merged = $LASTEXITCODE -eq 0
            }
            $records += [pscustomobject]@{
                path = $path
                branch = $current.branch
                dirtyCount = $dirty
                mergedIntoOriginMain = $merged
            }
            $current = $null
        }
    }
    return $records
}

function Get-Health {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
        return [pscustomobject]@{ url = $Url; reachable = $true; statusCode = [int]$response.StatusCode }
    }
    catch {
        return [pscustomobject]@{ url = $Url; reachable = $false; statusCode = $null }
    }
}

$retiredPaths = @(
    "C:\ProgramData\CodexProfileRename",
    "C:\ProgramData\SkincosMiniPc",
    "C:\CodexShared\Backups",
    "C:\CodexShared\Projetos\_bootstrap\n8n-top-level-legacy-20260703T181656",
    "C:\CodexRuntime\recovery\atendimento-legacy"
)

$backupRoot = Join-Path $RuntimeRoot "backups"
$backupFiles = if (Test-Path -LiteralPath $backupRoot) {
    @(Get-ChildItem -LiteralPath $backupRoot -File -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending)
} else { @() }
$latestBackup = if ($backupFiles.Count -gt 0) { $backupFiles[0] } else { $null }
$orphanTask = Get-ScheduledTask -TaskName "Orb Stack WSL Supervisor" -ErrorAction SilentlyContinue
$gitFsck = & git -C $ProjectRoot fsck --no-dangling 2>$null
$gitFsckOk = $LASTEXITCODE -eq 0
$drive = Get-PSDrive -Name C

$result = [pscustomobject]@{
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    project = [pscustomobject]@{
        path = $ProjectRoot
        branch = (@(Get-GitOutput -Arguments @("branch", "--show-current")) | Select-Object -First 1)
        dirtyCount = @(Get-GitOutput -Arguments @("status", "--porcelain")).Count
        fsckOk = $gitFsckOk
    }
    footprints = @(
        Get-DirectoryFootprint -Path $ProjectRoot
        Get-DirectoryFootprint -Path $WorktreeRoot
        Get-DirectoryFootprint -Path $RuntimeRoot
    )
    worktrees = @(Get-WorktreeAudit)
    retiredPaths = @($retiredPaths | ForEach-Object { [pscustomobject]@{ path = $_; exists = Test-Path -LiteralPath $_ } })
    orphanScheduledTaskPresent = $null -ne $orphanTask
    latestN8nBackup = if ($latestBackup) {
        [pscustomobject]@{ path = $latestBackup.FullName; bytes = [int64]$latestBackup.Length; ageHours = [math]::Round(((Get-Date).ToUniversalTime() - $latestBackup.LastWriteTimeUtc).TotalHours, 2) }
    } else { $null }
    cDrive = [pscustomobject]@{ freeBytes = [int64]$drive.Free; usedBytes = [int64]$drive.Used }
    health = @(
        Get-Health -Url "http://127.0.0.1:5678/healthz"
        Get-Health -Url "https://orb.skincos.com.br/healthz"
        Get-Health -Url "https://crm.skincos.com.br"
    )
}

$result | ConvertTo-Json -Depth 6

if ($FailOnDrift) {
    $retiredPresent = @($result.retiredPaths | Where-Object exists).Count -gt 0
    if ($retiredPresent -or $result.orphanScheduledTaskPresent -or -not $result.project.fsckOk) {
        exit 1
    }
}
