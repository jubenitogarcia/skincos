[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$RuntimeRoot = 'C:\CodexRuntime',
    [string]$StateRoot = 'C:\CodexRuntime\operator\admin\skincos\storage-governance\source-tars',
    [int]$MinimumAgeDays = 2,
    [switch]$Apply,
    [switch]$AllowHardlinkDeduplication,
    [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$RuntimeRoot = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($RuntimeRoot))
$StateRoot = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($StateRoot))
$root = Join-Path $RuntimeRoot 'operator\admin\skincos'
$now = [datetime]::UtcNow
$cutoff = $now.AddDays(-$MinimumAgeDays)
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null

function Test-SameFileSecurity([string]$First, [string]$Second) {
    try {
        $a = Get-Acl -LiteralPath $First -ErrorAction Stop
        $b = Get-Acl -LiteralPath $Second -ErrorAction Stop
        return [string]$a.Sddl -eq [string]$b.Sddl
    } catch { return $false }
}

function Get-LinkNames([string]$Path) {
    try {
        $driveRoot = [IO.Path]::GetPathRoot($Path)
        return @(& fsutil hardlink list $Path 2>$null | ForEach-Object {
            $line = ([string]$_).Trim()
            if ([string]::IsNullOrWhiteSpace($line)) { return }
            if ($line -match '^[A-Za-z]:\\') { return [IO.Path]::GetFullPath($line) }
            if ($line.StartsWith('\')) { return [IO.Path]::GetFullPath($driveRoot + $line.TrimStart('\')) }
            return $line
        })
    } catch { return @() }
}

function Test-SourceArchiveName([string]$Name) {
    return $Name -match 'source.*\.tar(?:\.gz)?$'
}

$files = @(Get-ChildItem -LiteralPath $root -Force -File -Filter '*source*.tar*' -ErrorAction SilentlyContinue | Where-Object {
    (Test-SourceArchiveName $_.Name) -and $_.LastWriteTimeUtc -lt $cutoff -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
})
foreach ($name in @('native-releases', 'native-promotions', 'releases', 'checkpoints', 'native-source-release', 'livia-reel-frame-contract', 'livia-1dee4fc2', 'livia-c525f5e1', 'mcp-readonly-gateway')) {
    $candidateRoot = Join-Path $root $name
    if (Test-Path -LiteralPath $candidateRoot -PathType Container) { $files += @(Get-ChildItem -LiteralPath $candidateRoot -Depth 2 -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object {
        (Test-SourceArchiveName $_.Name) -and $_.LastWriteTimeUtc -lt $cutoff -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
    }) }
}
$rows = foreach ($file in $files) {
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToUpperInvariant()
    [pscustomobject]@{ path = $file.FullName; bytes = [int64]$file.Length; sha256 = $hash; last_write_utc = $file.LastWriteTimeUtc.ToString('o'); security_checked = $false; hardlink_names = @() }
}
$groups = @($rows | Group-Object sha256, bytes | Where-Object Count -gt 1)
$operations = @()
$quarantineRoot = Join-Path $StateRoot 'quarantine'

foreach ($group in $groups) {
    $members = @($group.Group | Sort-Object @{Expression={ if ($_.path -match '\\(native-releases|native-promotions)\\') { 0 } elseif ($_.path -match '\\releases\\') { 1 } else { 2 } }}, last_write_utc, path)
    $canonical = $members[0]
    foreach ($duplicate in @($members | Select-Object -Skip 1)) {
        $row = [ordered]@{
            sha256 = $canonical.sha256
            bytes = $canonical.bytes
            canonical = $canonical.path
            duplicate = $duplicate.path
            action = 'dry-run'
            reason = 'exact-sha256-and-size-duplicate'
            quarantine = $null
            hardlink_names = @()
        }
        $existingLinks = @(Get-LinkNames -Path $duplicate.path)
        if ($existingLinks -contains ([IO.Path]::GetFullPath($canonical.path))) {
            $row.action = 'already-hardlinked'
            $row.reason = 'exact-duplicate-already-shares-the-canonical-file'
            $row.hardlink_names = $existingLinks
            $operations += [pscustomobject]$row
            continue
        }
        if (-not (Test-SameFileSecurity -First $canonical.path -Second $duplicate.path)) {
            $row.action = 'blocked'
            $row.reason = 'file-security-descriptors-differ-or-unreadable'
            $operations += [pscustomobject]$row
            continue
        }
        $duplicateRoot = [IO.Path]::GetPathRoot($duplicate.path)
        if ($duplicateRoot -ne [IO.Path]::GetPathRoot($canonical.path)) {
            $row.action = 'blocked'
            $row.reason = 'different-volume'
            $operations += [pscustomobject]$row
            continue
        }
        if (-not $Apply -or -not $AllowHardlinkDeduplication) {
            $row.reason = if (-not $AllowHardlinkDeduplication) { 'explicit-hardlink-flag-required' } else { 'dry-run' }
            $operations += [pscustomobject]$row
            continue
        }
        if ($PSCmdlet.ShouldProcess($duplicate.path, "Replace exact duplicate with hardlink to $($canonical.path)")) {
            $quarantine = Join-Path (Join-Path $quarantineRoot $canonical.sha256) ("{0}.{1}.quarantine" -f ([IO.Path]::GetFileName($duplicate.path)), ([guid]::NewGuid().ToString('N')))
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $quarantine) | Out-Null
            $row.quarantine = $quarantine
            try {
                Move-Item -LiteralPath $duplicate.path -Destination $quarantine -ErrorAction Stop
                & fsutil hardlink create $duplicate.path $canonical.path | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'fsutil hardlink create failed' }
                $afterHash = (Get-FileHash -LiteralPath $duplicate.path -Algorithm SHA256).Hash.ToUpperInvariant()
                $links = @(Get-LinkNames -Path $duplicate.path)
                if ($afterHash -ne $canonical.sha256 -or -not ($links -contains $canonical.path)) { throw 'hardlink verification failed' }
                Remove-Item -LiteralPath $quarantine -Force -ErrorAction Stop
                $row.action = 'hardlink-deduplicated'
                $row.hardlink_names = $links
            } catch {
                try {
                    if (Test-Path -LiteralPath $duplicate.path) { Remove-Item -LiteralPath $duplicate.path -Force -ErrorAction SilentlyContinue }
                    if (Test-Path -LiteralPath $quarantine) { Move-Item -LiteralPath $quarantine -Destination $duplicate.path -ErrorAction SilentlyContinue }
                } catch {}
                $row.action = 'rollback-or-error'
                $row.reason = $_.Exception.Message
            }
        } else { $row.action = 'what-if' }
        $operations += [pscustomobject]$row
    }
}

$document = [ordered]@{
    schema_version = 1
    generated_at_utc = $now.ToString('o')
    runtime_root = $root
    minimum_age_days = $MinimumAgeDays
    applied = [bool]$Apply
    hardlink_deduplication_allowed = [bool]$AllowHardlinkDeduplication
    source_tar_count = $rows.Count
    source_tar_bytes = [int64](($rows | Measure-Object bytes -Sum).Sum)
    duplicate_groups = $groups.Count
    operations = $operations
    safety = @(
        'Only exact SHA-256 and byte-size duplicates are considered.',
        'The original path is preserved as a hardlink, so manifests and rollback references remain valid.',
        'The original duplicate is quarantined transactionally and removed only after hardlink/hash verification.',
        'Different ACLs, volumes, recent files and reparse points are blocked.'
    )
}
$latest = Join-Path $StateRoot 'latest.json'
$history = Join-Path $StateRoot 'history.jsonl'
$document | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $latest -Encoding UTF8
Add-Content -LiteralPath $history -Value (($document | ConvertTo-Json -Depth 30 -Compress)) -Encoding UTF8
if (-not [string]::IsNullOrWhiteSpace($OutputPath)) { $document | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $OutputPath -Encoding UTF8 }
$document | ConvertTo-Json -Depth 30
