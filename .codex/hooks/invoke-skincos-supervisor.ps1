[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$payload = [Console]::In.ReadToEnd()
$gate = Join-Path $PSScriptRoot 'skincos-supervisor-gate.py'
$candidates = @()

if ($env:SKINCOS_SUPERVISOR_PYTHON) {
  $candidates += $env:SKINCOS_SUPERVISOR_PYTHON
}
$candidates += (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')

foreach ($name in @('python.exe', 'python3.exe')) {
  $resolved = Get-Command $name -ErrorAction SilentlyContinue
  if ($resolved -and $resolved.Source -notlike '*\WindowsApps\*') {
    $candidates += $resolved.Source
  }
}

$python = $candidates |
  Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
  Select-Object -First 1

if (-not $python) {
  [Console]::Out.WriteLine('{"continue":true,"stopReason":"SKINCOS supervisor: Python runtime is unavailable; automatic continuation is safely disabled"}')
  exit 0
}

try {
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $python
  $start.Arguments = "`"$gate`""
  $start.UseShellExecute = $false
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $start
  if (-not $process.Start()) {
    throw 'Could not start the supervisor gate.'
  }
  $process.StandardInput.Write($payload)
  $process.StandardInput.Close()
  $result = $process.StandardOutput.ReadToEnd()
  $process.StandardError.ReadToEnd() | Out-Null
  $process.WaitForExit()
  if ($process.ExitCode -ne 0 -or -not $result) {
    [Console]::Out.WriteLine('{"continue":true,"stopReason":"SKINCOS supervisor: gate process failed; automatic continuation is safely disabled"}')
    exit 0
  }
  [Console]::Out.Write($result)
} catch {
  [Console]::Out.WriteLine('{"continue":true,"stopReason":"SKINCOS supervisor: gate runner failed; automatic continuation is safely disabled"}')
}
