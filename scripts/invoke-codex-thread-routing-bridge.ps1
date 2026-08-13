[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('UserPromptSubmit', 'PreToolUse')]
    [string]$Event,
    [string]$BridgeRoot = 'C:\CodexRuntime\operator\admin\skincos\thread-routing-bridge',
    [string]$ExpectedBridgeHash,
    [string]$RuntimeRegistryRoot = 'C:\CodexRuntime\operator\admin\skincos\worktree-registry',
    [string]$WorktreeRoot = 'C:\CodexShared\Worktrees\skincos',
    [string]$CodexManagedWorktreeRoot = 'C:\CodexShared\Worktrees\skincos\admin\managed',
    [string]$Repository = 'jubenitogarcia/skincos'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:HookRawInput = try { [Console]::In.ReadToEnd() } catch { '' }

function Normalize-PathString {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ''
    }
    try {
        return ([IO.Path]::GetFullPath($Path)).Replace('/', '\').TrimEnd([char[]]'\').ToLowerInvariant()
    }
    catch {
        return $Path.Replace('/', '\').TrimEnd([char[]]'\').ToLowerInvariant()
    }
}

function Test-PathEqual {
    param([string]$Left, [string]$Right)
    return (Normalize-PathString -Path $Left) -eq (Normalize-PathString -Path $Right)
}

function Test-PathWithinRoot {
    param([string]$Path, [string]$Root)

    $normalizedPath = Normalize-PathString -Path $Path
    $normalizedRoot = Normalize-PathString -Path $Root
    return -not [string]::IsNullOrWhiteSpace($normalizedPath) -and
        -not [string]::IsNullOrWhiteSpace($normalizedRoot) -and
        ($normalizedPath -eq $normalizedRoot -or $normalizedPath.StartsWith("$normalizedRoot\"))
}

function Get-Sha256File {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
}

function Read-JsonOrNull {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }
    try {
        return (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop)
    }
    catch {
        return $null
    }
}

function Read-HookPayload {
    if ([string]::IsNullOrWhiteSpace($script:HookRawInput)) {
        return $null
    }
    return ($script:HookRawInput | ConvertFrom-Json -ErrorAction Stop)
}

function Resolve-HookRepositoryRoot {
    param([object]$Payload)

    $hasCwd = $null -ne $Payload -and $null -ne $Payload.PSObject.Properties['cwd']
    $candidate = if ($hasCwd) { [string]$Payload.cwd } else { (Get-Location).Path }
    if ([string]::IsNullOrWhiteSpace($candidate) -or -not (Test-Path -LiteralPath $candidate -PathType Container)) {
        return $null
    }
    $output = @(& git -C $candidate rev-parse --show-toplevel 2>$null | ForEach-Object { [string]$_ })
    if ($LASTEXITCODE -ne 0) {
        return $null
    }
    $root = @($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
    if ($root.Count -ne 1 -or -not (Test-Path -LiteralPath $root[0] -PathType Container)) {
        return $null
    }
    return (Resolve-Path -LiteralPath $root[0] -ErrorAction Stop).Path
}

function Get-GitValue {
    param([string]$Root, [string[]]$Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& git -C $Root @Arguments 2>$null | ForEach-Object { [string]$_ })
        if ($LASTEXITCODE -ne 0) {
            return $null
        }
        return ($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Test-SkincosRepository {
    param([string]$Root, [string]$ExpectedRepository)

    $origin = Get-GitValue -Root $Root -Arguments @('remote', 'get-url', 'origin')
    if ([string]::IsNullOrWhiteSpace($origin)) {
        return $false
    }
    $normalized = $origin.Trim().Replace('\', '/')
    $normalized = $normalized -replace '^(?i:https?://github\.com/)', ''
    $normalized = $normalized -replace '^(?i:ssh://git@github\.com/)', ''
    $normalized = $normalized -replace '^(?i:git@github\.com:)', ''
    $normalized = $normalized.TrimEnd('/')
    if ($normalized.EndsWith('.git', [StringComparison]::OrdinalIgnoreCase)) {
        $normalized = $normalized.Substring(0, $normalized.Length - 4)
    }
    return $normalized.Equals($ExpectedRepository, [StringComparison]::OrdinalIgnoreCase)
}

function Test-CompleteProjectRoutingImplementation {
    param([string]$Root)

    foreach ($relative in @(
            '.codex\hooks.json',
            '.codex\hooks\invoke-codex-thread-routing.ps1',
            '.codex\hooks\invoke-codex-thread-routing-guard.ps1',
            'scripts\resolve-codex-thread-worktree.ps1',
            'scripts\codex-thread-routing-state.ps1',
            'ops\codex\worktree-topology.json'
        )) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root $relative) -PathType Leaf)) {
            return $false
        }
    }
    $hooks = Read-JsonOrNull -Path (Join-Path $Root '.codex\hooks.json')
    return $null -ne $hooks -and $null -ne $hooks.PSObject.Properties['hooks'] -and
        $null -ne $hooks.hooks.PSObject.Properties['UserPromptSubmit'] -and
        $null -ne $hooks.hooks.PSObject.Properties['PreToolUse']
}

function Write-HookContext {
    param(
        [Parameter(Mandatory = $true)][string]$EventName,
        [Parameter(Mandatory = $true)][string]$Context,
        [switch]$Block,
        [string]$Reason
    )

    $result = [ordered]@{
        hookSpecificOutput = [ordered]@{
            hookEventName = $EventName
            additionalContext = $Context
        }
    }
    if ($Block) {
        $result.decision = 'block'
        $result.reason = $Reason
    }
    $result | ConvertTo-Json -Compress
}

function Write-PreToolDeny {
    param([string]$Reason)

    [ordered]@{
        hookSpecificOutput = [ordered]@{
            hookEventName = 'PreToolUse'
            permissionDecision = 'deny'
            permissionDecisionReason = $Reason
        }
    } | ConvertTo-Json -Compress
}

function Write-FailClosed {
    param([string]$Reason)

    if ($Event -eq 'UserPromptSubmit') {
        Write-HookContext -EventName $Event -Context "SKINCOS global thread routing failed closed ($Reason). Do not edit files in this checkout; recover the verified private routing bundle before continuing." -Block -Reason 'Global thread routing unavailable.'
    }
    else {
        Write-PreToolDeny -Reason "SKINCOS global thread routing failed closed ($Reason). Writes are denied until the verified private routing bundle is restored."
    }
}

function Get-RouteMarker {
    param([string]$Prompt)

    if ([string]::IsNullOrWhiteSpace($Prompt)) {
        return $null
    }
    $match = [regex]::Match($Prompt, '(?im)^\s*\[\[SKINCOS_ROUTE_V1 nonce=(?<nonce>[a-f0-9]{32}) source=(?<source>[a-f0-9]{64})\]\]\s*$')
    if (-not $match.Success) {
        return $null
    }
    return [pscustomobject]@{
        nonce = $match.Groups['nonce'].Value
        sourceKey = $match.Groups['source'].Value
    }
}

function Get-CandidateActivationMarker {
    param([string]$Prompt)

    if ([string]::IsNullOrWhiteSpace($Prompt)) {
        return $null
    }
    $match = [regex]::Match($Prompt, '(?im)^\s*\[\[SKINCOS_BRIDGE_TEST_V1 activation=(?<nonce>[a-f0-9]{32})\]\]\s*$')
    if (-not $match.Success) {
        return $null
    }
    return $match.Groups['nonce'].Value
}

function Remove-CandidateActivationMarker {
    param([string]$Prompt)
    return ($Prompt -replace '(?im)^\s*\[\[SKINCOS_BRIDGE_TEST_V1 activation=[a-f0-9]{32}\]\]\s*(?:\r?\n)?', '')
}

function Test-Expired {
    param([object]$Record)

    if ($null -eq $Record -or $null -eq $Record.PSObject.Properties['expiresAtUtc']) {
        return $true
    }
    try {
        return ([datetime]::Parse([string]$Record.expiresAtUtc).ToUniversalTime() -le [datetime]::UtcNow)
    }
    catch {
        return $true
    }
}

function Read-VerifiedActiveBundle {
    $activePath = Join-Path $BridgeRoot 'active.json'
    $active = Read-JsonOrNull -Path $activePath
    if ($null -eq $active -or [int]$active.schemaVersion -ne 1 -or [string]$active.kind -ne 'skincos-thread-routing-bridge') {
        return [pscustomobject]@{ state = 'invalid'; reason = 'active_manifest_missing_or_invalid'; active = $null; bundle = $null }
    }
    if ([string]$active.mode -notin @('candidate', 'stable') -or [string]::IsNullOrWhiteSpace([string]$active.bundlePath)) {
        return [pscustomobject]@{ state = 'invalid'; reason = 'active_manifest_mode_or_path_invalid'; active = $active; bundle = $null }
    }
    $bundlePath = [IO.Path]::GetFullPath([string]$active.bundlePath)
    $bundleRoot = Join-Path $BridgeRoot 'bundles'
    if (-not (Test-PathWithinRoot -Path $bundlePath -Root $bundleRoot) -or -not (Test-Path -LiteralPath $bundlePath -PathType Container)) {
        return [pscustomobject]@{ state = 'invalid'; reason = 'active_bundle_outside_private_root'; active = $active; bundle = $null }
    }
    $manifest = Read-JsonOrNull -Path (Join-Path $bundlePath 'manifest.json')
    if ($null -eq $manifest -or [int]$manifest.schemaVersion -ne 1 -or [string]$manifest.kind -ne 'skincos-thread-routing-bundle') {
        return [pscustomobject]@{ state = 'invalid'; reason = 'bundle_manifest_missing_or_invalid'; active = $active; bundle = $null }
    }
    if ([string]$manifest.sourceCommit -ne [string]$active.sourceCommit -or [string]$manifest.bundleKey -ne [string]$active.bundleKey) {
        return [pscustomobject]@{ state = 'invalid'; reason = 'bundle_manifest_identity_mismatch'; active = $active; bundle = $null }
    }
    $required = @(
        '.codex\hooks\invoke-codex-thread-routing.ps1',
        '.codex\hooks\invoke-codex-thread-routing-guard.ps1',
        'scripts\resolve-codex-thread-worktree.ps1',
        'scripts\codex-thread-routing-state.ps1',
        'ops\codex\worktree-topology.json'
    )
    $entries = @($manifest.files)
    foreach ($relative in $required) {
        $entry = @($entries | Where-Object { [string]$_.relativePath -eq $relative })
        if ($entry.Count -ne 1) {
            return [pscustomobject]@{ state = 'invalid'; reason = 'bundle_required_file_missing'; active = $active; bundle = $null }
        }
        $path = Join-Path $bundlePath $relative
        if (-not (Test-PathWithinRoot -Path $path -Root $bundlePath) -or -not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Sha256File -Path $path) -ne ([string]$entry[0].sha256).ToLowerInvariant()) {
            return [pscustomobject]@{ state = 'invalid'; reason = 'bundle_file_hash_mismatch'; active = $active; bundle = $null }
        }
    }
    return [pscustomobject]@{ state = 'ready'; reason = 'verified_private_bundle'; active = $active; bundle = [pscustomobject]@{ path = $bundlePath; manifest = $manifest } }
}

function Invoke-PrivateHook {
    param(
        [Parameter(Mandatory = $true)][object]$Payload,
        [Parameter(Mandatory = $true)][object]$Bundle,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [string]$PromptOverride
    )

    $relative = if ($Event -eq 'UserPromptSubmit') {
        '.codex\hooks\invoke-codex-thread-routing.ps1'
    }
    else {
        '.codex\hooks\invoke-codex-thread-routing-guard.ps1'
    }
    $scriptPath = Join-Path $Bundle.path $relative
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        return $null
    }
    if ($PSBoundParameters.ContainsKey('PromptOverride') -and $null -ne $Payload.PSObject.Properties['prompt']) {
        $Payload.prompt = $PromptOverride
    }
    $inputJson = $Payload | ConvertTo-Json -Depth 24 -Compress
    $arguments = @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', $scriptPath,
        '-RuntimeRegistryRoot', $RuntimeRegistryRoot,
        '-WorktreeRoot', $WorktreeRoot,
        '-CodexManagedWorktreeRoot', $CodexManagedWorktreeRoot,
        '-RoutingStateScript', (Join-Path $Bundle.path 'scripts\codex-thread-routing-state.ps1'),
        '-ImplementationRoot', $Bundle.path
    )
    if ($Event -eq 'UserPromptSubmit') {
        $arguments += @('-TopologyPath', (Join-Path $Bundle.path 'ops\codex\worktree-topology.json'))
    }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = @($inputJson | & powershell.exe @arguments 2>&1 | ForEach-Object { [string]$_ })
        if ($LASTEXITCODE -ne 0 -or $raw.Count -eq 0) {
            return $null
        }
        return (($raw -join "`n") | ConvertFrom-Json -ErrorAction Stop)
    }
    catch {
        return $null
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Test-CandidateSource {
    param([object]$Activation, [string]$Root)

    if ($null -eq $Activation -or -not (Test-PathEqual -Left ([string]$Activation.sourceCheckout) -Right $Root)) {
        return $false
    }
    $head = Get-GitValue -Root $Root -Arguments @('rev-parse', '--verify', 'HEAD^{commit}')
    return -not [string]::IsNullOrWhiteSpace($head) -and $head.Equals([string]$Activation.sourceCommit, [StringComparison]::OrdinalIgnoreCase)
}

function Consume-CandidateActivation {
    param([object]$Active, [string]$Nonce, [string]$Root)

    $activePath = Join-Path $BridgeRoot 'active.json'
    $lockPath = Join-Path $BridgeRoot 'active.lock'
    $lock = $null
    try {
        $lock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    }
    catch {
        return $false
    }
    try {
        $current = Read-JsonOrNull -Path $activePath
        if ($null -eq $current -or [string]$current.bundleKey -ne [string]$Active.bundleKey -or [string]$current.mode -ne 'candidate') {
            return $false
        }
        $activation = $current.activation
        if ($null -eq $activation -or [string]$activation.nonce -ne $Nonce -or -not [string]::IsNullOrWhiteSpace([string]$activation.consumedAtUtc) -or (Test-Expired -Record $activation) -or -not (Test-CandidateSource -Activation $activation -Root $Root)) {
            return $false
        }
        $activation | Add-Member -NotePropertyName consumedAtUtc -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o')) -Force
        $activation | Add-Member -NotePropertyName consumedCheckout -NotePropertyValue $Root -Force
        $temporary = Join-Path $BridgeRoot ('.active.{0}.tmp' -f [guid]::NewGuid().ToString('N'))
        [IO.File]::WriteAllText($temporary, (($current | ConvertTo-Json -Depth 24) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination $activePath -Force
        return $true
    }
    finally {
        if ($null -ne $lock) { $lock.Dispose() }
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }
}

try {
    $payload = Read-HookPayload
    $payloadEvent = if ($null -ne $payload -and $null -ne $payload.PSObject.Properties['hook_event_name']) { [string]$payload.hook_event_name } else { '' }
    if ($payloadEvent -ne $Event) {
        exit 0
    }
    $root = Resolve-HookRepositoryRoot -Payload $payload
    if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-SkincosRepository -Root $root -ExpectedRepository $Repository)) {
        exit 0
    }
    if (Test-CompleteProjectRoutingImplementation -Root $root) {
        exit 0
    }
    if ([string]::IsNullOrWhiteSpace($ExpectedBridgeHash) -or (Get-Sha256File -Path $PSCommandPath) -ne $ExpectedBridgeHash.ToLowerInvariant()) {
        Write-FailClosed -Reason 'bridge_loader_hash_mismatch'
        exit 0
    }
    $verified = Read-VerifiedActiveBundle
    if ($verified.state -ne 'ready') {
        Write-FailClosed -Reason $verified.reason
        exit 0
    }

    $active = $verified.active
    $prompt = if ($null -ne $payload.PSObject.Properties['prompt']) { [string]$payload.prompt } else { '' }
    if ([string]$active.mode -eq 'candidate') {
        $activation = $active.activation
        $routeMarker = Get-RouteMarker -Prompt $prompt
        if ($Event -eq 'UserPromptSubmit') {
            if ($null -ne $routeMarker) {
                $result = Invoke-PrivateHook -Payload $payload -Bundle $verified.bundle -RepositoryRoot $root
                if ($null -eq $result) { Write-FailClosed -Reason 'candidate_route_marker_hook_failed' } else { $result | ConvertTo-Json -Depth 24 -Compress }
                exit 0
            }
            $candidateNonce = Get-CandidateActivationMarker -Prompt $prompt
            if (-not [string]::IsNullOrWhiteSpace($candidateNonce)) {
                if ($null -eq $activation -or [string]$activation.nonce -ne $candidateNonce -or -not (Test-CandidateSource -Activation $activation -Root $root) -or (Test-Expired -Record $activation)) {
                    Write-HookContext -EventName $Event -Context 'SKINCOS bridge candidate activation was rejected. Do not edit files in this checkout.' -Block -Reason 'Bridge candidate activation rejected.'
                    exit 0
                }
                if (-not (Consume-CandidateActivation -Active $active -Nonce $candidateNonce -Root $root)) {
                    Write-HookContext -EventName $Event -Context 'SKINCOS bridge candidate activation could not be consumed safely. Do not edit files in this checkout.' -Block -Reason 'Bridge candidate activation could not be reserved.'
                    exit 0
                }
                $result = Invoke-PrivateHook -Payload $payload -Bundle $verified.bundle -RepositoryRoot $root -PromptOverride (Remove-CandidateActivationMarker -Prompt $prompt)
                if ($null -eq $result) { Write-FailClosed -Reason 'candidate_activation_hook_failed' } else { $result | ConvertTo-Json -Depth 24 -Compress }
                exit 0
            }
            if ($null -ne $activation -and -not [string]::IsNullOrWhiteSpace([string]$activation.consumedAtUtc) -and (Test-CandidateSource -Activation $activation -Root $root)) {
                Write-HookContext -EventName $Event -Context 'SKINCOS bridge candidate was already consumed for this source checkout. This task must not edit files; complete or recover the replacement task first.' -Block -Reason 'Replacement task is pending.'
            }
            exit 0
        }
        if ($null -ne $activation -and -not [string]::IsNullOrWhiteSpace([string]$activation.consumedAtUtc) -and (Test-CandidateSource -Activation $activation -Root $root)) {
            $result = Invoke-PrivateHook -Payload $payload -Bundle $verified.bundle -RepositoryRoot $root
            if ($null -eq $result) { Write-FailClosed -Reason 'candidate_guard_hook_failed' } else { $result | ConvertTo-Json -Depth 24 -Compress }
        }
        exit 0
    }

    $result = Invoke-PrivateHook -Payload $payload -Bundle $verified.bundle -RepositoryRoot $root
    if ($null -eq $result) {
        Write-FailClosed -Reason 'stable_private_hook_failed'
    }
    else {
        $result | ConvertTo-Json -Depth 24 -Compress
    }
}
catch {
    Write-FailClosed -Reason 'bridge_unhandled_error'
}
