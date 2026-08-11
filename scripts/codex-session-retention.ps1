[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [ValidateSet('audit', 'cleanup')]
    [string]$Mode = 'audit',
    [string]$CodexHome = "$env:USERPROFILE\.codex",
    [string]$StateRoot = 'C:\CodexRuntime\operator\admin\skincos\storage-governance\codex-sessions',
    [int]$ArchiveAfterDays = 30,
    [int]$DeleteAfterDays = 90,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$CodexHome = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($CodexHome))
$StateRoot = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($StateRoot))
$sessionsRoot = Join-Path $CodexHome 'sessions'
$archivedRoot = Join-Path $CodexHome 'archived_sessions'
$pinsPath = Join-Path $StateRoot 'pins.json'
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null

function Get-SessionId([string]$Name) {
    $match = [regex]::Match($Name, '(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($match.Success) { return $match.Groups['id'].Value.ToLowerInvariant() }
    return $null
}

function Read-Pins {
    if (-not (Test-Path -LiteralPath $pinsPath -PathType Leaf)) { return @() }
    try { return @((Get-Content -Raw -LiteralPath $pinsPath | ConvertFrom-Json).session_ids | ForEach-Object { [string]$_ }) } catch { throw "Invalid Codex session pins file: $pinsPath" }
}

function Read-SessionIndex {
    $index = @{}
    $path = Join-Path $CodexHome 'session_index.jsonl'
    if (-not (Test-Path -LiteralPath $path)) { return $index }
    foreach ($line in Get-Content -LiteralPath $path -ErrorAction SilentlyContinue) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $row = $line | ConvertFrom-Json; if ($row.id) { $index[[string]$row.id] = $row } } catch {}
    }
    return $index
}

function Get-SessionRows([string]$Root, [string]$Class, [hashtable]$Index, [string[]]$Pinned) {
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return @() }
    $rows = foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -Force -File -Filter '*.jsonl' -ErrorAction SilentlyContinue) {
        $id = Get-SessionId $file.Name
        $indexed = if ($id -and $Index.ContainsKey($id)) { $Index[$id] } else { $null }
        $updated = $file.LastWriteTimeUtc
        if ($indexed -and $indexed.updated_at) { try { $updated = ([datetime]$indexed.updated_at).ToUniversalTime() } catch {} }
        [pscustomobject]@{
            id = $id
            path = $file.FullName
            class = $Class
            bytes = [int64]$file.Length
            size_gb = [math]::Round($file.Length / 1GB, 3)
            updated_at_utc = $updated.ToString('o')
            thread_name = if ($indexed) { [string]$indexed.thread_name } else { $null }
            pinned = [bool]($id -and ($Pinned -contains $id))
            active = $Class -eq 'active'
        }
    }
    return @($rows)
}

function Invoke-CodexSessionCommand([string]$Command, [string]$SessionId) {
    $arguments = if ($Command -eq 'delete') { @($Command, $SessionId, '--force') } else { @($Command, $SessionId) }
    $output = @(& codex @arguments 2>&1)
    [pscustomobject]@{ command = $Command; session_id = $SessionId; exit_code = $LASTEXITCODE; output = (@($output) -join "`n") }
}

$now = [datetime]::UtcNow
$pins = @(Read-Pins)
$index = Read-SessionIndex
$active = @(Get-SessionRows -Root $sessionsRoot -Class 'active' -Index $index -Pinned $pins)
$archived = @(Get-SessionRows -Root $archivedRoot -Class 'archived' -Index $index -Pinned $pins)
$activeIds = @($active | Where-Object id | Select-Object -ExpandProperty id)
$archiveCutoff = $now.AddDays(-$ArchiveAfterDays)
$deleteCutoff = $now.AddDays(-$DeleteAfterDays)
$toArchive = @($active | Where-Object { -not $_.pinned -and $_.id -and ([datetime]$_.updated_at_utc) -lt $archiveCutoff })
$toDelete = @($archived | Where-Object { -not $_.pinned -and $_.id -and ([datetime]$_.updated_at_utc) -lt $deleteCutoff -and $activeIds -notcontains $_.id })
$actions = @()

if ($Mode -eq 'cleanup' -and $Apply) {
    foreach ($row in $toArchive) {
        if ($PSCmdlet.ShouldProcess($row.id, 'Archive old Codex session using official CLI')) { $actions += Invoke-CodexSessionCommand -Command 'archive' -SessionId $row.id }
    }
    foreach ($row in $toDelete) {
        if ($PSCmdlet.ShouldProcess($row.id, 'Permanently delete expired archived Codex session using official CLI')) { $actions += Invoke-CodexSessionCommand -Command 'delete' -SessionId $row.id }
    }
}

$document = [ordered]@{
    schema_version = 1
    generated_at_utc = $now.ToString('o')
    mode = $Mode
    applied = [bool]$Apply
    archive_after_days = $ArchiveAfterDays
    delete_after_days = $DeleteAfterDays
    active = $active
    archived = $archived
    archive_candidates = $toArchive
    delete_candidates = $toDelete
    actions = $actions
    safety = @(
        'All currently unarchived sessions are protected from deletion.',
        'Deletion is performed only through the official codex delete --force command.',
        'Pinned IDs are never archived or deleted.',
        'This script never edits session JSONL files or SQLite indexes directly.'
    )
}
$latest = Join-Path $StateRoot 'latest.json'
$history = Join-Path $StateRoot 'history.jsonl'
$document | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $latest -Encoding UTF8
Add-Content -LiteralPath $history -Value (($document | ConvertTo-Json -Depth 30 -Compress)) -Encoding UTF8
$document | ConvertTo-Json -Depth 30
