[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('issue', 'consume', 'get-binding', 'get-pending', 'register-native-project', 'get-native-project-registration', 'clear-expired')]
    [string]$Action,
    [string]$RuntimeRegistryRoot = 'C:\CodexRuntime\operator\admin\skincos\worktree-registry',
    [string]$SourceCheckout,
    [string]$Checkout,
    [string]$CodexManagedWorktreeRoot = 'C:\CodexShared\Worktrees\skincos\admin\managed',
    [ValidateSet('crm-module', 'orb-workflow-family')]
    [string]$SurfaceType,
    [string]$SurfaceId,
    [ValidateSet('edit', 'preview', 'qualify')]
    [string]$Intent = 'edit',
    [string]$TargetCommit,
    [string]$TaskSlug,
    [string]$Nonce,
    [string]$SourceKey,
    [string]$NativeProjectPath,
    [int]$TtlSeconds = 600
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Normalize-PathString {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ''
    }

    try {
        $value = [IO.Path]::GetFullPath($Path)
    }
    catch {
        $value = $Path
    }

    return $value.Replace('/', '\').TrimEnd([char[]]'\').ToLowerInvariant()
}

function Test-PathEqual {
    param([string]$Left, [string]$Right)
    return (Normalize-PathString -Path $Left) -eq (Normalize-PathString -Path $Right)
}

function Test-PathStrictlyWithinRoot {
    param([string]$Path, [string]$Root)

    $normalizedPath = Normalize-PathString -Path $Path
    $normalizedRoot = Normalize-PathString -Path $Root
    return -not [string]::IsNullOrWhiteSpace($normalizedPath) -and
        -not [string]::IsNullOrWhiteSpace($normalizedRoot) -and
        $normalizedPath.StartsWith("$normalizedRoot\")
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Value)

    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $algorithm.Dispose()
    }
}

function Invoke-GitValue {
    param([string]$RepoPath, [string[]]$Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& git -C $RepoPath @Arguments 2>$null | ForEach-Object { [string]$_ })
        if ($LASTEXITCODE -ne 0) {
            return $null
        }
        return ($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Get-CheckoutIdentity {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return [pscustomobject]@{ state = 'missing'; checkout = $null; head = $null; registered = $false; detached = $false }
    }

    $topLevel = Invoke-GitValue -RepoPath $Path -Arguments @('rev-parse', '--show-toplevel')
    if ([string]::IsNullOrWhiteSpace($topLevel) -or -not (Test-Path -LiteralPath $topLevel -PathType Container)) {
        return [pscustomobject]@{ state = 'not_git'; checkout = $null; head = $null; registered = $false; detached = $false }
    }

    $checkout = (Resolve-Path -LiteralPath $topLevel -ErrorAction Stop).Path
    $head = Invoke-GitValue -RepoPath $checkout -Arguments @('rev-parse', '--verify', 'HEAD^{commit}')
    $branch = Invoke-GitValue -RepoPath $checkout -Arguments @('symbolic-ref', '--quiet', '--short', 'HEAD')
    $records = @(& git -C $checkout worktree list --porcelain 2>$null)
    $registered = $false
    foreach ($line in $records) {
        if ($line -like 'worktree *' -and (Test-PathEqual -Left $line.Substring(9) -Right $checkout)) {
            $registered = $true
            break
        }
    }

    return [pscustomobject]@{
        state = if ($registered -and -not [string]::IsNullOrWhiteSpace($head)) { 'ready' } else { 'unregistered' }
        checkout = $checkout
        head = $head
        registered = $registered
        detached = [string]::IsNullOrWhiteSpace($branch)
    }
}

function Get-StateRoot {
    return Join-Path $RuntimeRegistryRoot 'thread-routing'
}

function Ensure-StateDirectories {
    foreach ($relative in @('pending', 'pending-locks', 'bindings', 'consumed', 'native-projects')) {
        New-Item -ItemType Directory -Path (Join-Path (Get-StateRoot) $relative) -Force | Out-Null
    }
}

function Get-PendingPath {
    param([Parameter(Mandatory = $true)][string]$Key)
    return Join-Path (Join-Path (Get-StateRoot) 'pending') "$Key.json"
}

function Get-PendingLockPath {
    param([Parameter(Mandatory = $true)][string]$Key)
    return Join-Path (Join-Path (Get-StateRoot) 'pending-locks') "$Key.lock"
}

function Get-BindingPath {
    param([Parameter(Mandatory = $true)][string]$Key)
    return Join-Path (Join-Path (Get-StateRoot) 'bindings') "$Key.json"
}

function Get-ConsumedPath {
    param([Parameter(Mandatory = $true)][string]$NonceValue)
    return Join-Path (Join-Path (Get-StateRoot) 'consumed') ("{0}.json" -f (Get-Sha256 -Value $NonceValue))
}

function Get-NativeProjectPath {
    param([Parameter(Mandatory = $true)][string]$Key)
    return Join-Path (Join-Path (Get-StateRoot) 'native-projects') "$Key.json"
}

function Read-JsonOrNull {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }
    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Write-NewJson {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )

    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporary = Join-Path $directory (".{0}.{1}.tmp" -f ([IO.Path]::GetFileName($Path)), [guid]::NewGuid().ToString('N'))
    $encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($temporary, (($Value | ConvertTo-Json -Depth 16) + [Environment]::NewLine), $encoding)
    try {
        [IO.File]::Move($temporary, $Path)
        return $true
    }
    catch [IO.IOException] {
        return $false
    }
    finally {
        if (Test-Path -LiteralPath $temporary -PathType Leaf) {
            Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-UtcTimestamp {
    return (Get-Date).ToUniversalTime().ToString('o')
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

function Test-CommitMatches {
    param([string]$Expected, [string]$Actual)
    return -not [string]::IsNullOrWhiteSpace($Expected) -and
        -not [string]::IsNullOrWhiteSpace($Actual) -and
        $Expected.Trim().ToLowerInvariant() -eq $Actual.Trim().ToLowerInvariant()
}

function Acquire-PendingLock {
    param([Parameter(Mandatory = $true)][string]$Key)

    $path = Get-PendingLockPath -Key $Key
    try {
        $stream = New-Object IO.FileStream($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        return [pscustomobject]@{ acquired = $true; path = $path; stream = $stream }
    }
    catch [IO.IOException] {
        return [pscustomobject]@{ acquired = $false; path = $path; stream = $null }
    }
}

function Release-PendingLock {
    param([object]$Lock)

    if ($null -eq $Lock -or -not $Lock.acquired) {
        return
    }
    if ($null -ne $Lock.stream) {
        $Lock.stream.Dispose()
    }
    if (Test-Path -LiteralPath $Lock.path -PathType Leaf) {
        Remove-Item -LiteralPath $Lock.path -Force -ErrorAction SilentlyContinue
    }
}

function Get-PendingStatus {
    param([Parameter(Mandatory = $true)][string]$Key)

    $path = Get-PendingPath -Key $Key
    $record = Read-JsonOrNull -Path $path
    if ($null -eq $record -or [int]$record.schemaVersion -ne 1 -or [string]$record.kind -ne 'pending-route') {
        return [pscustomobject]@{ state = 'missing'; path = $path; record = $null }
    }
    if (Test-Expired -Record $record) {
        return [pscustomobject]@{ state = 'expired'; path = $path; record = $record }
    }
    $consumedPath = Get-ConsumedPath -NonceValue ([string]$record.nonce)
    if (Test-Path -LiteralPath $consumedPath -PathType Leaf) {
        return [pscustomobject]@{ state = 'consumed'; path = $path; record = $record }
    }
    return [pscustomobject]@{ state = 'active'; path = $path; record = $record }
}

function New-Result {
    param(
        [string]$State,
        [string[]]$ReasonCodes = @(),
        [object]$Record = $null,
        [object]$Binding = $null
    )

    return [pscustomobject]@{
        schemaVersion = 1
        action = $Action
        state = $State
        generatedAtUtc = Get-UtcTimestamp
        reasonCodes = @($ReasonCodes)
        record = $Record
        binding = $Binding
    }
}

function Emit-Result {
    param([object]$Value)
    $Value | ConvertTo-Json -Depth 20
}

try {
    Ensure-StateDirectories

    switch ($Action) {
        'issue' {
            $source = Get-CheckoutIdentity -Path $SourceCheckout
            if ($source.state -ne 'ready') {
                Emit-Result (New-Result -State 'blocked' -ReasonCodes @('source_checkout_not_registered_git_worktree'))
                break
            }
            if ([string]::IsNullOrWhiteSpace($SurfaceType) -or [string]::IsNullOrWhiteSpace($SurfaceId) -or [string]::IsNullOrWhiteSpace($TargetCommit)) {
                Emit-Result (New-Result -State 'blocked' -ReasonCodes @('route_surface_and_target_commit_required'))
                break
            }
            $resolvedTarget = Invoke-GitValue -RepoPath $source.checkout -Arguments @('rev-parse', '--verify', "$TargetCommit^{commit}")
            if (-not (Test-CommitMatches -Expected $TargetCommit -Actual $resolvedTarget)) {
                Emit-Result (New-Result -State 'blocked' -ReasonCodes @('route_target_commit_not_available_from_source'))
                break
            }

            $sourceKeyValue = Get-Sha256 -Value (Normalize-PathString -Path $source.checkout)
            $lock = Acquire-PendingLock -Key $sourceKeyValue
            if (-not $lock.acquired) {
                Emit-Result (New-Result -State 'blocked' -ReasonCodes @('route_pending_lock_contended'))
                break
            }
            try {
                $pending = Get-PendingStatus -Key $sourceKeyValue
                if ($pending.state -eq 'active') {
                    $sameRoute = [string]$pending.record.surfaceType -eq $SurfaceType -and
                        [string]$pending.record.surfaceId -eq $SurfaceId -and
                        (Test-CommitMatches -Expected ([string]$pending.record.targetCommit) -Actual $resolvedTarget) -and
                        [string]$pending.record.intent -eq $Intent
                    if ($sameRoute) {
                        $result = New-Result -State 'reused' -ReasonCodes @('existing_pending_route_reused') -Record $pending.record
                        $result | Add-Member -NotePropertyName sourceKey -NotePropertyValue $sourceKeyValue
                        Emit-Result $result
                    }
                    else {
                        Emit-Result (New-Result -State 'blocked' -ReasonCodes @('different_pending_route_preserved') -Record $pending.record)
                    }
                    break
                }
                if ($pending.state -eq 'expired') {
                    Remove-Item -LiteralPath $pending.path -Force -ErrorAction Stop
                }
                if ($pending.state -eq 'consumed') {
                    Remove-Item -LiteralPath $pending.path -Force -ErrorAction Stop
                }

                $record = [ordered]@{
                    schemaVersion = 1
                    kind = 'pending-route'
                    sourceCheckout = $source.checkout
                    sourceCheckoutKey = $sourceKeyValue
                    sourceCommit = $source.head
                    surfaceType = $SurfaceType
                    surfaceId = $SurfaceId
                    intent = $Intent
                    targetCommit = $resolvedTarget
                    taskSlug = $TaskSlug
                    nonce = [guid]::NewGuid().ToString('N')
                    issuedAtUtc = Get-UtcTimestamp
                    expiresAtUtc = ([datetime]::UtcNow.AddSeconds($TtlSeconds)).ToString('o')
                }
                if (-not (Write-NewJson -Path (Get-PendingPath -Key $sourceKeyValue) -Value $record)) {
                    Emit-Result (New-Result -State 'blocked' -ReasonCodes @('route_pending_compare_and_swap_failed'))
                    break
                }
                $result = New-Result -State 'issued' -ReasonCodes @('pending_route_issued') -Record ([pscustomobject]$record)
                $result | Add-Member -NotePropertyName sourceKey -NotePropertyValue $sourceKeyValue
                Emit-Result $result
            }
            finally {
                Release-PendingLock -Lock $lock
            }
            break
        }

        'consume' {
            if ([string]::IsNullOrWhiteSpace($SourceKey) -or $SourceKey -notmatch '^[a-f0-9]{64}$' -or [string]::IsNullOrWhiteSpace($Nonce)) {
                Emit-Result (New-Result -State 'blocked' -ReasonCodes @('route_marker_invalid'))
                break
            }
            $child = Get-CheckoutIdentity -Path $Checkout
            if ($child.state -ne 'ready' -or -not (Test-PathStrictlyWithinRoot -Path $child.checkout -Root $CodexManagedWorktreeRoot)) {
                Emit-Result (New-Result -State 'blocked' -ReasonCodes @('managed_checkout_not_registered_under_configured_root'))
                break
            }

            $checkoutKey = Get-Sha256 -Value (Normalize-PathString -Path $child.checkout)
            $bindingPath = Get-BindingPath -Key $checkoutKey
            $existing = Read-JsonOrNull -Path $bindingPath
            $nonceDigest = Get-Sha256 -Value $Nonce
            $pending = Get-PendingStatus -Key $SourceKey

            # The App may retry the initial prompt after it has already been
            # accepted. Permit only the same checkout at the same immutable SHA;
            # a copied marker never authorizes a second checkout.
            if ($pending.state -eq 'consumed') {
                $consumed = Read-JsonOrNull -Path (Get-ConsumedPath -NonceValue $Nonce)
                $sameConsumedRoute = $null -ne $consumed -and
                    [int]$consumed.schemaVersion -eq 1 -and
                    [string]$consumed.kind -eq 'consumed-route-nonce' -and
                    [string]$consumed.nonceDigest -eq $nonceDigest -and
                    [string]$consumed.sourceCheckoutKey -eq $SourceKey -and
                    [string]$consumed.checkoutKey -eq $checkoutKey
                $sameBinding = $null -ne $existing -and
                    [int]$existing.schemaVersion -eq 1 -and
                    [string]$existing.kind -eq 'managed-worktree-binding' -and
                    (Test-PathEqual -Left ([string]$existing.checkout) -Right $child.checkout) -and
                    [string]$existing.nonceDigest -eq $nonceDigest -and
                    (Test-CommitMatches -Expected ([string]$existing.targetCommit) -Actual $child.head)
                if ($sameConsumedRoute -and $sameBinding) {
                    Emit-Result (New-Result -State 'ready' -ReasonCodes @('managed_worktree_binding_reused') -Binding $existing)
                }
                else {
                    Emit-Result (New-Result -State 'blocked' -ReasonCodes @('route_marker_consumed_for_another_checkout_or_sha'))
                }
                break
            }

            if ($pending.state -ne 'active') {
                Emit-Result (New-Result -State 'blocked' -ReasonCodes @("route_marker_$($pending.state)"))
                break
            }
            if ([string]$pending.record.nonce -cne $Nonce) {
                Emit-Result (New-Result -State 'blocked' -ReasonCodes @('route_marker_nonce_mismatch'))
                break
            }
            if (-not (Test-CommitMatches -Expected ([string]$pending.record.targetCommit) -Actual $child.head)) {
                Emit-Result (New-Result -State 'blocked' -ReasonCodes @('managed_checkout_target_commit_mismatch'))
                break
            }

            if ($null -ne $existing) {
                $sameBinding = [int]$existing.schemaVersion -eq 1 -and [string]$existing.kind -eq 'managed-worktree-binding' -and
                    (Test-PathEqual -Left ([string]$existing.checkout) -Right $child.checkout) -and
                    [string]$existing.nonceDigest -eq $nonceDigest
                if ($sameBinding) {
                    Emit-Result (New-Result -State 'ready' -ReasonCodes @('managed_worktree_binding_reused') -Binding $existing)
                }
                else {
                    Emit-Result (New-Result -State 'blocked' -ReasonCodes @('managed_worktree_binding_conflict_preserved') -Binding $existing)
                }
                break
            }

            $consumed = [ordered]@{
                schemaVersion = 1
                kind = 'consumed-route-nonce'
                nonceDigest = $nonceDigest
                sourceCheckoutKey = $SourceKey
                checkoutKey = $checkoutKey
                consumedAtUtc = Get-UtcTimestamp
            }
            if (-not (Write-NewJson -Path (Get-ConsumedPath -NonceValue $Nonce) -Value $consumed)) {
                Emit-Result (New-Result -State 'blocked' -ReasonCodes @('route_marker_already_consumed'))
                break
            }

            $binding = [ordered]@{
                schemaVersion = 1
                kind = 'managed-worktree-binding'
                checkout = $child.checkout
                checkoutKey = $checkoutKey
                surfaceType = [string]$pending.record.surfaceType
                surfaceId = [string]$pending.record.surfaceId
                intent = [string]$pending.record.intent
                targetCommit = [string]$pending.record.targetCommit
                taskSlug = [string]$pending.record.taskSlug
                sourceCheckoutKey = $SourceKey
                nonceDigest = $nonceDigest
                boundAtUtc = Get-UtcTimestamp
            }
            if (-not (Write-NewJson -Path $bindingPath -Value $binding)) {
                Emit-Result (New-Result -State 'blocked' -ReasonCodes @('managed_worktree_binding_compare_and_swap_failed'))
                break
            }
            Emit-Result (New-Result -State 'ready' -ReasonCodes @('managed_worktree_binding_created') -Binding ([pscustomobject]$binding))
            break
        }

        'get-binding' {
            $identity = Get-CheckoutIdentity -Path $Checkout
            if ([string]::IsNullOrWhiteSpace($identity.checkout)) {
                Emit-Result (New-Result -State 'missing' -ReasonCodes @('checkout_identity_unavailable'))
                break
            }
            $key = Get-Sha256 -Value (Normalize-PathString -Path $identity.checkout)
            $binding = Read-JsonOrNull -Path (Get-BindingPath -Key $key)
            if ($null -eq $binding -or [int]$binding.schemaVersion -ne 1 -or [string]$binding.kind -ne 'managed-worktree-binding' -or -not (Test-PathEqual -Left ([string]$binding.checkout) -Right $identity.checkout)) {
                Emit-Result (New-Result -State 'missing' -ReasonCodes @('managed_worktree_binding_missing'))
                break
            }
            Emit-Result (New-Result -State 'ready' -ReasonCodes @('managed_worktree_binding_found') -Binding $binding)
            break
        }

        'get-pending' {
            $identity = Get-CheckoutIdentity -Path $SourceCheckout
            if ([string]::IsNullOrWhiteSpace($identity.checkout)) {
                Emit-Result (New-Result -State 'missing' -ReasonCodes @('source_checkout_identity_unavailable'))
                break
            }
            $key = Get-Sha256 -Value (Normalize-PathString -Path $identity.checkout)
            $pending = Get-PendingStatus -Key $key
            Emit-Result (New-Result -State $pending.state -ReasonCodes @("pending_route_$($pending.state)") -Record $pending.record)
            break
        }

        'register-native-project' {
            $identity = Get-CheckoutIdentity -Path $NativeProjectPath
            if ($identity.state -ne 'ready') {
                Emit-Result (New-Result -State 'blocked' -ReasonCodes @('native_project_checkout_not_registered_git_worktree'))
                break
            }
            $key = Get-Sha256 -Value (Normalize-PathString -Path $identity.checkout)
            $record = [ordered]@{
                schemaVersion = 1
                kind = 'native-project-registration'
                checkout = $identity.checkout
                checkoutKey = $key
                registeredAtUtc = Get-UtcTimestamp
            }
            $path = Get-NativeProjectPath -Key $key
            if (Test-Path -LiteralPath $path -PathType Leaf) {
                $existing = Read-JsonOrNull -Path $path
                if ($null -ne $existing -and (Test-PathEqual -Left ([string]$existing.checkout) -Right $identity.checkout)) {
                    Emit-Result (New-Result -State 'ready' -ReasonCodes @('native_project_registration_reused') -Record $existing)
                }
                else {
                    Emit-Result (New-Result -State 'blocked' -ReasonCodes @('native_project_registration_conflict_preserved') -Record $existing)
                }
                break
            }
            if (-not (Write-NewJson -Path $path -Value $record)) {
                Emit-Result (New-Result -State 'blocked' -ReasonCodes @('native_project_registration_compare_and_swap_failed'))
                break
            }
            Emit-Result (New-Result -State 'ready' -ReasonCodes @('native_project_registered') -Record ([pscustomobject]$record))
            break
        }

        'get-native-project-registration' {
            $identity = Get-CheckoutIdentity -Path $NativeProjectPath
            if ([string]::IsNullOrWhiteSpace($identity.checkout)) {
                Emit-Result (New-Result -State 'missing' -ReasonCodes @('native_project_checkout_identity_unavailable'))
                break
            }
            $key = Get-Sha256 -Value (Normalize-PathString -Path $identity.checkout)
            $record = Read-JsonOrNull -Path (Get-NativeProjectPath -Key $key)
            if ($null -eq $record -or [int]$record.schemaVersion -ne 1 -or [string]$record.kind -ne 'native-project-registration' -or -not (Test-PathEqual -Left ([string]$record.checkout) -Right $identity.checkout)) {
                Emit-Result (New-Result -State 'missing' -ReasonCodes @('native_project_registration_missing'))
                break
            }
            Emit-Result (New-Result -State 'ready' -ReasonCodes @('native_project_registration_found') -Record $record)
            break
        }

        'clear-expired' {
            $removed = 0
            foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path (Get-StateRoot) 'pending') -Filter '*.json' -File -ErrorAction SilentlyContinue)) {
                $record = Read-JsonOrNull -Path $file.FullName
                if (Test-Expired -Record $record) {
                    Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
                    $removed++
                }
            }
            $result = New-Result -State 'ready' -ReasonCodes @('expired_pending_routes_cleared')
            $result | Add-Member -NotePropertyName removedCount -NotePropertyValue $removed
            Emit-Result $result
            break
        }
    }
}
catch {
    Emit-Result ([pscustomobject]@{
        schemaVersion = 1
        action = $Action
        state = 'blocked'
        generatedAtUtc = Get-UtcTimestamp
        reasonCodes = @('thread_routing_state_error')
        record = $null
        binding = $null
        errorType = $_.Exception.GetType().FullName
    })
}
