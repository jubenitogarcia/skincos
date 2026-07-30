[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('Status', 'Disable', 'Enable', 'RemoveRegistration', 'RestoreRegistration')]
  [string]$Action,
  [string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
  $RepositoryRoot = Split-Path -Parent $PSScriptRoot
}
$root = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$codexRoot = Join-Path $root '.codex'
$registration = Join-Path $codexRoot 'hooks.json'
$runtimeRoot = Join-Path $codexRoot 'runtime\supervisor'
$controlPath = Join-Path $runtimeRoot 'control.json'
$rollbackRoot = Join-Path $runtimeRoot 'rollback'
$registrationBackup = Join-Path $rollbackRoot 'hooks.json.disabled'

function Write-Control([bool]$Enabled, [string]$Reason) {
  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  $json = @{
    schema_version = 1
    enabled = $Enabled
    changed_at = [DateTimeOffset]::UtcNow.ToString('o')
    reason = $Reason
  } | ConvertTo-Json
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($controlPath, $json + [Environment]::NewLine, $utf8NoBom)
}

switch ($Action) {
  'Disable' {
    Write-Control -Enabled $false -Reason 'operator rollback'
  }
  'Enable' {
    Write-Control -Enabled $true -Reason 'operator activation'
  }
  'RemoveRegistration' {
    Write-Control -Enabled $false -Reason 'registration rollback'
    New-Item -ItemType Directory -Path $rollbackRoot -Force | Out-Null
    if (-not (Test-Path -LiteralPath $registration)) {
      throw "Hook registration is already absent: $registration"
    }
    if (Test-Path -LiteralPath $registrationBackup) {
      throw "Refusing to overwrite the preserved hook registration: $registrationBackup"
    }
    Move-Item -LiteralPath $registration -Destination $registrationBackup
  }
  'RestoreRegistration' {
    if (Test-Path -LiteralPath $registration) {
      throw "Refusing to overwrite an existing hook registration: $registration"
    }
    if (-not (Test-Path -LiteralPath $registrationBackup)) {
      throw "Preserved hook registration was not found: $registrationBackup"
    }
    Move-Item -LiteralPath $registrationBackup -Destination $registration
    Write-Control -Enabled $true -Reason 'registration restored'
  }
}

$control = if (Test-Path -LiteralPath $controlPath) {
  Get-Content -LiteralPath $controlPath -Raw | ConvertFrom-Json
} else {
  $null
}

[pscustomobject]@{
  action = $Action
  repository_root = $root
  registration_present = Test-Path -LiteralPath $registration
  registration_backup_present = Test-Path -LiteralPath $registrationBackup
  enabled = if ($control) { [bool]$control.enabled } else { $true }
  runtime_state_preserved = Test-Path -LiteralPath $runtimeRoot
} | ConvertTo-Json -Compress
