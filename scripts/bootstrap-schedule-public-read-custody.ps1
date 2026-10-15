[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-f0-9]{40}$')]
    [string]$ApprovedSourceSha,
    [string]$ProjectRoot = 'C:\CodexShared\Projetos\skincos',
    [switch]$Apply
)

# WSL_BOUNDARY_EXCEPTION: fixed Windows VM enrollment infrastructure, derived
# from the approved Ubuntu/operator bootstrap. All project runtime and auth
# remain in the unmodified typed admin gateway. This exposes no root command,
# user, target, environment, script, secret, or generic argument parameter.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:ScheduleHelperSha256 = '15c7b3c9b2914c68a72ca37b71914fe68be7339a455b00024a3c5985bf22de12'
$script:ScheduleReceiverSha256 = '5245bdb85c5b714841a6b3d479c6b9048cc6e09d59d59399165debe0949fe9bd'
$script:ScheduleGatewaySha256 = 'a3e7a61d7d96514d7cb2140b613be937603e5f761e24d7e8d5db17a74e0ff103'
$script:ScheduleSourceFiles = @(
    'scripts/bootstrap-schedule-public-read-custody.ps1',
    'scripts/runtime/enroll-schedule-public-read-custody.py',
    'scripts/runtime/provision-schedule-public-read-custody.py',
    'scripts/invoke-skincos-wsl.ps1'
)
$script:ScheduleWslExecutable = 'C:\Windows\System32\wsl.exe'

function Get-SchedulePublicDigest {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hasher.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}

function Convert-ScheduleWindowsArguments {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string[]]$Values)
    $rendered = foreach ($value in $Values) {
        if ($null -eq $value -or $value.Contains([char]0)) { throw 'schedule_native_enrollment_rejected' }
        # Windows CRT argv quoting, including backslashes before quotes and
        # before the closing delimiter. No shell interprets these arguments.
        $builder = [Text.StringBuilder]::new()
        [void]$builder.Append([char]34)
        $slashes = 0
        foreach ($character in $value.ToCharArray()) {
            if ($character -eq [char]92) { $slashes++; continue }
            if ($character -eq [char]34) {
                [void]$builder.Append([string]('\' * (2 * $slashes + 1)))
            } else {
                [void]$builder.Append([string]('\' * $slashes))
            }
            [void]$builder.Append($character)
            $slashes = 0
        }
        [void]$builder.Append([string]('\' * (2 * $slashes)))
        [void]$builder.Append([char]34)
        $builder.ToString()
    }
    return ($rendered -join ' ')
}

function Convert-SchedulePublicSourceBytes {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)
    if ($Bytes.Length -lt 1 -or $Bytes.Length -gt 65536) { throw 'schedule_native_enrollment_rejected' }
    $utf8 = [Text.UTF8Encoding]::new($false, $true)
    $text = $utf8.GetString($Bytes)
    if ($text.Contains([char]0) -or $text[0] -eq [char]0xFEFF) { throw 'schedule_native_enrollment_rejected' }
    $text = $text.Replace(([string][char]13 + [char]10), [string][char]10)
    if ($text.Contains([char]13)) { throw 'schedule_native_enrollment_rejected' }
    return ,$utf8.GetBytes($text)
}

function Assert-ScheduleEnrollmentSourceMetadata {
    param([Parameter(Mandatory = $true)]$Metadata, [Parameter(Mandatory = $true)][string]$ExpectedSha)
    if ($ExpectedSha -cnotmatch '^[a-f0-9]{40}$' -or
        $Metadata.Head -cne $ExpectedSha -or $Metadata.Main -cne $ExpectedSha -or
        $Metadata.Tree -cnotmatch '^[a-f0-9]{40}$' -or
        $Metadata.Branch -cnotin @('main', '') -or $Metadata.Status -cne '' -or
        $Metadata.Origin -cnotin @('https://github.com/jubenitogarcia/skincos.git',
            'https://github.com/jubenitogarcia/skincos', 'git@github.com:jubenitogarcia/skincos.git')) {
        throw 'schedule_native_enrollment_rejected'
    }
}

function Invoke-SchedulePublicGit {
    param([string]$Root, [string[]]$Values)
    $git = Get-Command git -CommandType Application -ErrorAction Stop
    $result = & $git.Source -C $Root @Values 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'schedule_native_enrollment_rejected' }
    return (@($result) -join [char]10)
}

function Get-ScheduleEnrollmentSourceMetadata {
    param([string]$Root)
    return [pscustomobject]@{
        Head = Invoke-SchedulePublicGit -Root $Root -Values @('rev-parse', 'HEAD')
        Main = Invoke-SchedulePublicGit -Root $Root -Values @('rev-parse', 'refs/remotes/origin/main')
        Tree = Invoke-SchedulePublicGit -Root $Root -Values @('rev-parse', 'HEAD^{tree}')
        Branch = Invoke-SchedulePublicGit -Root $Root -Values @('branch', '--show-current')
        Status = Invoke-SchedulePublicGit -Root $Root -Values @('status', '--porcelain=v1', '--untracked-files=all')
        Origin = Invoke-SchedulePublicGit -Root $Root -Values @('remote', 'get-url', 'origin')
    }
}

function Get-ScheduleApprovedBlob {
    param([string]$Root, [string]$Sha, [string]$Relative)
    if ($Sha -cnotmatch '^[a-f0-9]{40}$' -or $Relative -cnotin $script:ScheduleSourceFiles) {
        throw 'schedule_native_enrollment_rejected'
    }
    $git = Get-Command git -CommandType Application -ErrorAction Stop
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $git.Source
    $info.Arguments = Convert-ScheduleWindowsArguments -Values @('-C', $Root, 'cat-file', 'blob', ($Sha + ':' + $Relative))
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    $bytes = [IO.MemoryStream]::new()
    try {
        if (-not $process.Start()) { throw 'schedule_native_enrollment_rejected' }
        $errorTask = $process.StandardError.ReadToEndAsync()
        $process.StandardOutput.BaseStream.CopyTo($bytes)
        $process.WaitForExit()
        if ($process.ExitCode -ne 0 -or $errorTask.Result.Length -ne 0 -or $bytes.Length -lt 1 -or $bytes.Length -gt 65536) {
            throw 'schedule_native_enrollment_rejected'
        }
        return ,$bytes.ToArray()
    } finally { $bytes.Dispose(); $process.Dispose() }
}

function Get-ScheduleApprovedSourceSnapshot {
    param([string]$Root, [string]$Sha)
    $ancestor = Get-Item -LiteralPath $Root -Force -ErrorAction Stop
    while ($null -ne $ancestor) {
        if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'schedule_native_enrollment_rejected' }
        $ancestor = $ancestor.Parent
    }
    $metadata = Get-ScheduleEnrollmentSourceMetadata -Root $Root
    Assert-ScheduleEnrollmentSourceMetadata -Metadata $metadata -ExpectedSha $Sha
    $copies = @{}
    foreach ($relative in $script:ScheduleSourceFiles) {
        $part = $Root
        foreach ($segment in $relative.Split('/')) {
            $part = Join-Path $part $segment
            $item = Get-Item -LiteralPath $part -Force -ErrorAction Stop
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'schedule_native_enrollment_rejected' }
        }
        $blob = Get-ScheduleApprovedBlob -Root $Root -Sha $Sha -Relative $relative
        if ($item.PSIsContainer -or $item.Length -lt 1 -or $item.Length -gt 65536) { throw 'schedule_native_enrollment_rejected' }
        $current = Convert-SchedulePublicSourceBytes -Bytes ([IO.File]::ReadAllBytes($part))
        # Git's exact LF blob is the approved source. Windows autocrlf is
        # normalized only for comparison, never to approve arbitrary edits.
        if ((Get-SchedulePublicDigest -Bytes $blob) -cne (Get-SchedulePublicDigest -Bytes $current)) {
            throw 'schedule_native_enrollment_rejected'
        }
        $copies[$relative] = [byte[]]$blob.Clone()
    }
    # The reviewed gateway is self-contained: it resolves repo/worktree paths
    # only from ProjectRoot/RepoRoot, without PSScriptRoot or source imports.
    # Pin and compile its immutable Git bytes, never reopen the checkout path.
    $gatewayBytes = $copies['scripts/invoke-skincos-wsl.ps1']
    if ((Get-SchedulePublicDigest -Bytes $gatewayBytes) -cne $script:ScheduleGatewaySha256) {
        throw 'schedule_native_enrollment_rejected'
    }
    $gatewayText = [Text.UTF8Encoding]::new($false, $true).GetString($gatewayBytes)
    return [pscustomobject]@{ SourceSha = $Sha; SourceTree = [string]$metadata.Tree
        Gateway = [scriptblock]::Create($gatewayText)
        Helper = $copies['scripts/runtime/provision-schedule-public-read-custody.py']
        Receiver = $copies['scripts/runtime/enroll-schedule-public-read-custody.py'] }
}

function New-ScheduleEnrollmentInvocation {
    param([string]$SourceSha, [string]$SourceTree, [byte[]]$HelperBytes, [byte[]]$ReceiverBytes)
    if ($SourceSha -cnotmatch '^[a-f0-9]{40}$' -or $SourceTree -cnotmatch '^[a-f0-9]{40}$' -or
        $null -eq $HelperBytes -or $null -eq $ReceiverBytes) { throw 'schedule_native_enrollment_rejected' }
    $helper = [byte[]]$HelperBytes.Clone()
    $receiver = [byte[]]$ReceiverBytes.Clone()
    if ($helper.Length -gt 16384 -or $receiver.Length -gt 16384 -or
        (Get-SchedulePublicDigest -Bytes $helper) -cne $script:ScheduleHelperSha256 -or
        (Get-SchedulePublicDigest -Bytes $receiver) -cne $script:ScheduleReceiverSha256) {
        throw 'schedule_native_enrollment_rejected'
    }
    # The root interpreter independently checks the reviewed receiver digest.
    # Only inert public base64, source IDs and this fixed program enter argv.
    $program = @'
import base64,hashlib,sys
b=base64.b64decode(sys.argv[1],validate=True)
if hashlib.sha256(b).hexdigest() != '5245bdb85c5b714841a6b3d479c6b9048cc6e09d59d59399165debe0949fe9bd': raise SystemExit(78)
sys.argv=['/verified-source/enroll-schedule-public-read-custody.py','enroll',sys.argv[2],sys.argv[3]]
exec(compile(b,sys.argv[0],'exec'),{'__name__':'__main__'})
'@
    return [pscustomobject]@{
        Arguments = [string[]]@('--distribution', 'Ubuntu-24.04', '--user', 'root',
            '--exec', '/usr/bin/python3', '-I', '-B', '-c', $program,
            [Convert]::ToBase64String($receiver), $SourceSha, $SourceTree)
        InputText = (@{ contract = 'schedule-native-custody-enrollment/v1'; sourceSha = $SourceSha
            sourceTree = $SourceTree; helperBase64 = [Convert]::ToBase64String($helper) } | ConvertTo-Json -Compress)
    }
}

function Invoke-ScheduleEnrollmentRoot {
    param([string]$SourceSha, [string]$SourceTree, [byte[]]$HelperBytes, [byte[]]$ReceiverBytes)
    $invocation = New-ScheduleEnrollmentInvocation @PSBoundParameters
    $wsl = Get-Command -Name $script:ScheduleWslExecutable -CommandType Application -ErrorAction Stop
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $wsl.Source
    $info.Arguments = Convert-ScheduleWindowsArguments -Values $invocation.Arguments
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    # Do not forward WSLENV, loader/Python injection, platform auth or caller
    # project variables into the fixed root infrastructure process.
    $info.EnvironmentVariables.Clear()
    foreach ($name in @('SystemRoot', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if ($null -ne $value) { $info.EnvironmentVariables[$name] = $value }
    }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { throw 'schedule_native_enrollment_rejected' }
        $outputTask = $process.StandardOutput.ReadToEndAsync()
        $errorTask = $process.StandardError.ReadToEndAsync()
        $publicInput = [Text.UTF8Encoding]::new($false).GetBytes($invocation.InputText)
        try {
            $process.StandardInput.BaseStream.Write($publicInput, 0, $publicInput.Length)
            $process.StandardInput.BaseStream.Flush()
        } finally { $process.StandardInput.Close() }
        if (-not $process.WaitForExit(60000)) {
            $process.Kill()
            throw 'schedule_native_enrollment_uncertain_do_not_retry'
        }
        $output = $outputTask.Result
        $errors = $errorTask.Result
        if ($process.ExitCode -ne 0 -or $errors.Length -ne 0 -or $output.Length -gt 4096) {
            throw 'schedule_native_enrollment_rejected_do_not_retry'
        }
        $result = $output | ConvertFrom-Json -ErrorAction Stop
        if (@($result.PSObject.Properties).Count -ne 10 -or
            $result.contract -cne 'schedule-native-custody-enrollment/v1' -or $result.status -cne 'created' -or
            $result.sourceSha -cne $SourceSha -or $result.sourceTree -cne $SourceTree -or
            $result.path -cne '/etc/skincos/schedule-public-read/native-capabilities.json' -or
            $result.operatorGroup -cne 'skincos-operator-admin' -or $result.memoryLocked -ne $true -or
            $result.capabilityCount -ne 3 -or $result.mode -cne '0640' -or $result.parentMode -cne '0750') {
            throw 'schedule_native_enrollment_uncertain_do_not_retry'
        }
        # Reconstruct public metadata. Never forward raw process output.
        return [pscustomobject]@{ contract = 'schedule-native-custody-enrollment/v1'; status = 'created'
            sourceSha = $SourceSha; sourceTree = $SourceTree
            path = '/etc/skincos/schedule-public-read/native-capabilities.json'
            operatorGroup = 'skincos-operator-admin'; memoryLocked = $true
            capabilityCount = 3; mode = '0640'; parentMode = '0750' }
    } finally { $process.Dispose() }
}

# The infrastructure unit test dot-sources only the pure validators/renderer.
if ($MyInvocation.InvocationName -eq '.') { return }

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot -ErrorAction Stop).Path
if ([IO.Path]::GetFullPath($PSCommandPath) -cne
    [IO.Path]::GetFullPath((Join-Path $ProjectRoot $script:ScheduleSourceFiles[0]))) {
    throw 'schedule_native_enrollment_rejected'
}
$snapshot = Get-ScheduleApprovedSourceSnapshot -Root $ProjectRoot -Sha $ApprovedSourceSha
# Pin both immutable copies even in plan-only mode.
[void](New-ScheduleEnrollmentInvocation -SourceSha $snapshot.SourceSha -SourceTree $snapshot.SourceTree -HelperBytes $snapshot.Helper -ReceiverBytes $snapshot.Receiver)
if (-not $Apply) {
    [pscustomobject]@{ contract = 'schedule-native-custody-enrollment/v1'; status = 'source-verified-plan'
        sourceSha = $snapshot.SourceSha; sourceTree = $snapshot.SourceTree
        target = '/etc/skincos/schedule-public-read/native-capabilities.json'; privilegedExecuted = $false }
    return
}
# All existing typed gateway operator/repo/toolchain checks run as admin.
# There are no Skip parameters, root project preflights or root auth commands.
& $snapshot.Gateway -ProjectRoot $ProjectRoot -WslExecutable $script:ScheduleWslExecutable -Executable /usr/bin/id -Argument @('-un')
if ($LASTEXITCODE -ne 0) { throw 'schedule_native_enrollment_rejected' }
$last = Get-ScheduleEnrollmentSourceMetadata -Root $ProjectRoot
Assert-ScheduleEnrollmentSourceMetadata -Metadata $last -ExpectedSha $ApprovedSourceSha
if ($last.Tree -cne $snapshot.SourceTree) { throw 'schedule_native_enrollment_rejected' }
Invoke-ScheduleEnrollmentRoot -SourceSha $snapshot.SourceSha -SourceTree $snapshot.SourceTree -HelperBytes $snapshot.Helper -ReceiverBytes $snapshot.Receiver
