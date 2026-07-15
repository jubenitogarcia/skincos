[CmdletBinding()]
param(
    [string]$Distribution = 'Ubuntu-24.04',
    [string]$LinuxUser = 'admin',
    [string]$NativeBackupRoot = '/var/backups/skincos/orb/daily',
    [string]$DestinationRoot = 'C:\CodexRuntime\backups\orb\daily',
    [ValidateRange(1, 30)][int]$RetentionCount = 1,
    [switch]$SkipGenerate
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Assert-AllowedDestination {
    param([string]$Path)

    $allowed = [IO.Path]::GetFullPath('C:\CodexRuntime\backups')
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($allowed + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Backup destination must remain under $allowed."
    }
    return $resolved
}

function Test-BackupPayload {
    param([string]$Path)

    $manifestPath = Join-Path $Path 'manifest.json'
    $databasePath = Join-Path $Path 'n8n_runtime.dump'
    $storagePath = Join-Path $Path 'storage.tar'
    foreach ($required in @($manifestPath, $databasePath, $storagePath)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Required backup artifact is missing: $([IO.Path]::GetFileName($required))"
        }
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.restoreVerified -ne $true) {
        throw 'The native backup has not passed a real PostgreSQL restore.'
    }
    if ($manifest.storageFormat -ne 'tar') {
        throw 'The native backup storage format is not the expected tar archive.'
    }

    $databaseHash = (Get-FileHash -LiteralPath $databasePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($databaseHash -ne [string]$manifest.databaseSha256) {
        throw 'Database checksum mismatch.'
    }
    $storageHash = (Get-FileHash -LiteralPath $storagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($storageHash -ne [string]$manifest.storageArchiveSha256) {
        throw 'Storage checksum mismatch.'
    }

    & tar.exe -tf $storagePath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Storage archive validation failed with exit code $LASTEXITCODE."
    }

    [pscustomobject]@{
        CreatedAt = [string]$manifest.createdAt
        DatabaseSha256 = $databaseHash
        StorageSha256 = $storageHash
        WorkflowCount = [int]$manifest.workflowCount
        ExecutionCount = [int]$manifest.executionCount
    }
}

$DestinationRoot = Assert-AllowedDestination -Path $DestinationRoot
if (-not $SkipGenerate) {
    & wsl.exe -d $Distribution -u $LinuxUser -- sudo -n systemctl start orb-backup.service
    if ($LASTEXITCODE -ne 0) {
        throw "Native Orb backup failed with exit code $LASTEXITCODE."
    }
}

$relativeNativeRoot = $NativeBackupRoot.TrimStart('/').Replace('/', '\')
$sourceRoot = "\\wsl.localhost\$Distribution\$relativeNativeRoot"
if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "Native backup root is unavailable through Windows: $sourceRoot"
}

$source = Get-ChildItem -LiteralPath $sourceRoot -Directory |
    Where-Object Name -Match '^\d{8}T\d{6}Z$' |
    Sort-Object Name -Descending |
    Select-Object -First 1
if (-not $source) {
    throw 'No complete native Orb backup is available for publication.'
}

$sourceEvidence = Test-BackupPayload -Path $source.FullName
New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
$partial = Join-Path $DestinationRoot ".partial-$($source.Name)"
$destination = Join-Path $DestinationRoot $source.Name

if (Test-Path -LiteralPath $destination -PathType Container) {
    $destinationEvidence = Test-BackupPayload -Path $destination
    if ($destinationEvidence.DatabaseSha256 -ne $sourceEvidence.DatabaseSha256 -or
        $destinationEvidence.StorageSha256 -ne $sourceEvidence.StorageSha256) {
        throw 'An existing published backup has the same name but different checksums.'
    }
} else {
    if (Test-Path -LiteralPath $partial) {
        Remove-Item -LiteralPath $partial -Recurse -Force
    }
    & robocopy.exe $source.FullName $partial /E /COPY:DAT /DCOPY:T /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "Windows backup publication failed with robocopy exit code $LASTEXITCODE."
    }
    $copiedEvidence = Test-BackupPayload -Path $partial
    if ($copiedEvidence.DatabaseSha256 -ne $sourceEvidence.DatabaseSha256 -or
        $copiedEvidence.StorageSha256 -ne $sourceEvidence.StorageSha256) {
        throw 'Checksum mismatch after Windows publication.'
    }
    Move-Item -LiteralPath $partial -Destination $destination
}

$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $DestinationRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' "*$($currentSid):(OI)(CI)F" /Q | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Failed to restrict backup root ACLs with exit code $LASTEXITCODE."
}
& icacls.exe $DestinationRoot /grant '*S-1-5-18:F' "*$($currentSid):F" /T /C /Q | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Failed to apply explicit backup payload ACLs with exit code $LASTEXITCODE."
}

$retained = @(Get-ChildItem -LiteralPath $DestinationRoot -Directory |
    Where-Object Name -Match '^\d{8}T\d{6}Z$' |
    Sort-Object Name -Descending)
$retained | Select-Object -Skip $RetentionCount | Remove-Item -Recurse -Force

Write-Output "backup_destination=$destination"
Write-Output "database_sha256=$($sourceEvidence.DatabaseSha256)"
Write-Output "storage_sha256=$($sourceEvidence.StorageSha256)"
Write-Output "workflows=$($sourceEvidence.WorkflowCount) executions=$($sourceEvidence.ExecutionCount)"
Write-Output "retained_backups=$((Get-ChildItem -LiteralPath $DestinationRoot -Directory | Where-Object Name -Match '^\d{8}T\d{6}Z$' | Sort-Object Name -Descending | ForEach-Object Name) -join ',')"
