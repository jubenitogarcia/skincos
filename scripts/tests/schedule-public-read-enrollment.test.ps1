$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# WSL_BOUNDARY_EXCEPTION: pure Windows infrastructure renderer tests; loading
# the dot-source guard never starts WSL, project runtime or a root operation.
function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw ('ASSERTION FAILED: ' + $Message) }
}
function Assert-Throws {
    param([scriptblock]$Action, [string]$Message)
    try { & $Action } catch { return }
    throw ('ASSERTION FAILED: ' + $Message)
}
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$launcher = Join-Path $root 'scripts/bootstrap-schedule-public-read-custody.ps1'
$parseErrors = $null
[void][Management.Automation.Language.Parser]::ParseFile($launcher, [ref]$null, [ref]$parseErrors)
Assert-True ($parseErrors.Count -eq 0) 'launcher must parse'
. $launcher -ApprovedSourceSha ('a' * 40)
Assert-True ((Convert-ScheduleWindowsArguments @('plain', 'C:\with space\', 'a"b', '')) -ceq '"plain" "C:\with space\\" "a\"b" ""') 'Windows CRT quoting preserves literal argv'
$sha = 'a' * 40
$tree = 'b' * 40
$helper = Convert-SchedulePublicSourceBytes ([IO.File]::ReadAllBytes((Join-Path $root 'scripts/runtime/provision-schedule-public-read-custody.py')))
$receiver = Convert-SchedulePublicSourceBytes ([IO.File]::ReadAllBytes((Join-Path $root 'scripts/runtime/enroll-schedule-public-read-custody.py')))
$invocation = New-ScheduleEnrollmentInvocation $sha $tree $helper $receiver
Assert-True (($invocation.Arguments[0..8] -join '|') -ceq '--distribution|Ubuntu-24.04|--user|root|--exec|/usr/bin/python3|-I|-B|-c') 'only fixed isolated root interpreter'
Assert-True ($invocation.Arguments.Count -eq 13) 'no generic root argument'
Assert-True ($invocation.Arguments[11] -ceq $sha -and $invocation.Arguments[12] -ceq $tree) 'source identity crosses literally'
Assert-True ($invocation.Arguments[9].Contains($script:ScheduleReceiverSha256)) 'root entrypoint independently pins receiver'
$parsed = $invocation.InputText | ConvertFrom-Json
Assert-True (@($parsed.PSObject.Properties).Count -eq 4) 'public payload has no secret or root command fields'
Assert-True ((Get-SchedulePublicDigest ([Convert]::FromBase64String($parsed.helperBase64))) -ceq $script:ScheduleHelperSha256) 'immutable helper snapshot matches reviewed source'
$helper[0] = 0
$receiver[0] = 0
Assert-True ($invocation.InputText -ceq ($parsed | ConvertTo-Json -Compress)) 'caller mutation cannot change encoded payload'
Assert-Throws { New-ScheduleEnrollmentInvocation $sha $tree $helper $receiver } 'mutated input is refused before a process can start'
$helper = Convert-SchedulePublicSourceBytes ([IO.File]::ReadAllBytes((Join-Path $root 'scripts/runtime/provision-schedule-public-read-custody.py')))
$receiver = Convert-SchedulePublicSourceBytes ([IO.File]::ReadAllBytes((Join-Path $root 'scripts/runtime/enroll-schedule-public-read-custody.py')))
$receiver[1] = 0
Assert-Throws { New-ScheduleEnrollmentInvocation $sha $tree $helper $receiver } 'tampered receiver is refused'
Assert-Throws { New-ScheduleEnrollmentInvocation ('a' * 39) $tree $helper $receiver } 'source SHA is strict'

$metadata = @{ Head = $sha; Main = $sha; Tree = $tree; Branch = 'main'; Status = ''
    Origin = 'https://github.com/jubenitogarcia/skincos.git' }
Assert-ScheduleEnrollmentSourceMetadata $metadata $sha
foreach ($change in @(
    @{ Main = 'c' * 40 }, @{ Head = 'c' * 40 }, @{ Branch = 'codex/admin/unmerged' },
    @{ Status = '?? unreviewed.py' }, @{ Origin = 'https://github.com/foreign/skincos.git' },
    @{ Tree = 'b' * 39 }
)) {
    $candidate = $metadata.Clone()
    foreach ($name in $change.Keys) { $candidate[$name] = $change[$name] }
    Assert-Throws { Assert-ScheduleEnrollmentSourceMetadata $candidate $sha } 'main/origin/clean source gate'
}
$encoding = [Text.UTF8Encoding]::new($false, $true)
$crlf = $encoding.GetBytes('line1' + [char]13 + [char]10 + 'line2' + [char]13 + [char]10)
$lf = Convert-SchedulePublicSourceBytes $crlf
Assert-True ($encoding.GetString($lf) -ceq ('line1' + [char]10 + 'line2' + [char]10)) 'autocrlf normalizes only to Git LF source'
Assert-Throws { Convert-SchedulePublicSourceBytes ([byte[]]@(0xEF,0xBB,0xBF,0x41)) } 'BOM is refused'
Assert-Throws { Convert-SchedulePublicSourceBytes ([byte[]]@(0xFF)) } 'invalid UTF8 is refused'
Assert-Throws { Convert-SchedulePublicSourceBytes ([byte[]]@(65,13,66)) } 'lone CR is refused'
Assert-Throws { Convert-SchedulePublicSourceBytes ([byte[]]@(65,0,66)) } 'NUL is refused'

# Exercise the real snapshot boundary with synthetic Git metadata/public blobs.
# No WSL process can start: the captured canonical gateway is invoked with an
# executable path that does not exist inside this test's private sandbox.
$sandboxBase = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Codex/skincos'))
$sandbox = Join-Path $sandboxBase ('schedule-enrollment-synthetic-' + [Guid]::NewGuid().ToString('N'))
$savedMetadata = (Get-Item Function:\Get-ScheduleEnrollmentSourceMetadata).ScriptBlock
$savedBlob = (Get-Item Function:\Get-ScheduleApprovedBlob).ScriptBlock
$approvedSourceBlobs = @{}
try {
    foreach ($relative in $script:ScheduleSourceFiles) {
        $approvedSourceBlobs[$relative] = Convert-SchedulePublicSourceBytes ([IO.File]::ReadAllBytes((Join-Path $root $relative)))
        $fixture = Join-Path $sandbox $relative
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($fixture))
        [IO.File]::WriteAllBytes($fixture, $approvedSourceBlobs[$relative])
    }
    function Get-ScheduleEnrollmentSourceMetadata { param([string]$Root); return $metadata }
    function Get-ScheduleApprovedBlob {
        param([string]$Root, [string]$Sha, [string]$Relative)
        return ,([byte[]]$approvedSourceBlobs[$Relative].Clone())
    }
    $captured = Get-ScheduleApprovedSourceSnapshot -Root $sandbox -Sha $sha
    $mutableGateway = Join-Path $sandbox 'scripts/invoke-skincos-wsl.ps1'
    [IO.File]::WriteAllBytes($mutableGateway, $encoding.GetBytes("throw 'schedule_mutable_gateway_executed'"))
    $absentWsl = Join-Path $sandbox 'never-created-wsl.exe'
    Assert-True (-not (Test-Path -LiteralPath $absentWsl)) 'test transport executable must be absent'
    $gatewayError = $null
    try { & $captured.Gateway -ProjectRoot $sandbox -WslExecutable $absentWsl -Executable /usr/bin/id -Argument @('-un') }
    catch { $gatewayError = $_.Exception.Message }
    Assert-True ($null -ne $gatewayError -and $gatewayError.StartsWith('WSL is unavailable:')) 'approved captured gateway executes after checkout replacement, without starting WSL'
    Assert-True ($gatewayError -cne 'schedule_mutable_gateway_executed') 'replacement gateway bytes never execute'
    # Even a future approved blob must keep the reviewed self-contained gateway
    # pin; repository approval alone cannot silently add path/source dependencies.
    $approvedSourceBlobs['scripts/invoke-skincos-wsl.ps1'] = [IO.File]::ReadAllBytes($mutableGateway)
    Assert-Throws { Get-ScheduleApprovedSourceSnapshot -Root $sandbox -Sha $sha } 'changed gateway pin is refused'
} finally {
    Set-Item Function:\Get-ScheduleEnrollmentSourceMetadata -Value $savedMetadata
    Set-Item Function:\Get-ScheduleApprovedBlob -Value $savedBlob
    if (Test-Path -LiteralPath $sandbox) {
        $resolvedSandbox = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $sandbox).Path)
        if (-not $resolvedSandbox.StartsWith($sandboxBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'synthetic_cleanup_path_rejected'
        }
        Remove-Item -LiteralPath $resolvedSandbox -Recurse -Force
    }
}
$parameters = (Get-Command $launcher).Parameters
Assert-True ($script:ScheduleSourceFiles -ccontains 'scripts/invoke-skincos-wsl.ps1') 'gateway is in the approved source closure'
$sourceText = [IO.File]::ReadAllText($launcher)
Assert-True (-not $sourceText.Contains('. $gateway')) 'mutable checkout gateway is never dot-sourced'
Assert-True (-not $sourceText.Contains('& $gateway ')) 'mutable checkout gateway is never invoked by path'
Assert-True ($sourceText.Contains('& $snapshot.Gateway ')) 'only the approved in-memory gateway is invoked'
foreach ($forbidden in @('User', 'Executable', 'Argument', 'ScriptPath', 'StandardInputText', 'EnvVar', 'WslExecutable',
    'SkipBootstrapCheck', 'SkipNodeCheck', 'SkipNpmCheck', 'SkipGitCheck', 'SkipRepoCheck')) {
    Assert-True (-not $parameters.ContainsKey($forbidden)) ('no generic override: ' + $forbidden)
}
Write-Output 'Schedule enrollment infrastructure focal passed; no WSL or privileged execution.'
