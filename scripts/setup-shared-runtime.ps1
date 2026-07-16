param(
    [string]$RuntimeRoot = "C:\CodexRuntime"
)

$ErrorActionPreference = "Stop"
$resolved = [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\')
if ($resolved -ne 'C:\CodexRuntime') {
    throw "RuntimeRoot must remain C:\CodexRuntime. Received: $resolved"
}

$privateDirs = @(
    (Join-Path $resolved 'backups\orb\daily'),
    (Join-Path $resolved 'operator\admin\skincos'),
    (Join-Path $resolved 'tmp')
)
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach ($directory in $privateDirs) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    & icacls.exe $directory /inheritance:r /grant:r "${identity}:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to apply private ACLs to $directory"
    }
}

[pscustomobject]@{
    runtimeRoot = $resolved
    windowsOwnedDirectories = $privateDirs
    nativeStateRoot = '/var/lib/skincos-runtime'
    nativeConfigRoot = '/etc/skincos'
    nativeLogRoot = '/var/log/skincos'
    note = 'Mutable services are prepared by scripts/runtime/prepare-lifecycle-layout.sh inside WSL.'
} | ConvertTo-Json -Depth 4
