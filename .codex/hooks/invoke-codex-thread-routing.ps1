[CmdletBinding()]
param(
    [string]$RuntimeRegistryRoot = 'C:\CodexRuntime\operator\admin\skincos\worktree-registry',
    [string]$WorktreeRoot = 'C:\CodexShared\Worktrees\skincos',
    [string]$CodexManagedWorktreeRoot = 'C:\CodexShared\Worktrees\skincos\admin\managed',
    [string]$TopologyPath,
    [string]$RoutingStateScript
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:HookRawInput = try { [Console]::In.ReadToEnd() } catch { '' }

function Read-HookPayload {
    $raw = $script:HookRawInput
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }
    $value = $raw | ConvertFrom-Json
    return $value
}

function Resolve-HookRepositoryRoot {
    param([object]$Payload)

    $hasCwd = $null -ne $Payload -and $null -ne $Payload.PSObject.Properties['cwd']
    $candidate = if ($hasCwd) { [string]$Payload.cwd } else { (Get-Location).Path }
    if ([string]::IsNullOrWhiteSpace($candidate) -or -not (Test-Path -LiteralPath $candidate -PathType Container)) {
        return $null
    }
    $rootRaw = @(& git -C $candidate rev-parse --show-toplevel 2>$null)
    $gitExitCode = $LASTEXITCODE
    $root = @($rootRaw | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -First 1)
    if ($gitExitCode -ne 0 -or $root.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$root[0])) {
        return $null
    }
    return (Resolve-Path -LiteralPath ([string]$root[0]).Trim() -ErrorAction Stop).Path
}

function Invoke-JsonScript {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][hashtable]$Parameters
    )

    $invocation = @{}
    foreach ($entry in $Parameters.GetEnumerator()) {
        if ($null -eq $entry.Value) {
            continue
        }
        if ($entry.Value -is [string] -and [string]::IsNullOrWhiteSpace([string]$entry.Value)) {
            continue
        }
        $invocation[$entry.Key] = $entry.Value
    }
    $raw = @(& $ScriptPath @invocation 2>$null | ForEach-Object { [string]$_ })
    if ($LASTEXITCODE -ne 0 -or $raw.Count -eq 0) {
        return $null
    }
    try {
        return (($raw -join "`n") | ConvertFrom-Json)
    }
    catch {
        return $null
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

function Get-RouteContext {
    param(
        [object]$Result,
        [string]$Marker = $null
    )

    $lines = @(
        'SKINCOS thread routing verdict (authoritative for this turn):',
        "state=$($Result.state)",
        "currentThreadAction=$($Result.currentThreadAction)",
        "surface=$($Result.surfaceType)/$($Result.surfaceId)",
        "sourceCheckout=$($Result.currentCheckout)",
        "targetCommit=$($Result.targetCommit)",
        "candidateType=$($Result.candidateType)",
        "nativeAction=$($Result.nativeAction)",
        "managedWorktreeRoot=$CodexManagedWorktreeRoot"
    )
    if (-not [string]::IsNullOrWhiteSpace($Marker)) {
        $lines += "routeMarker=$Marker"
    }
    if (@($Result.reasonCodes).Count -gt 0) {
        $lines += ('reasonCodes=' + (@($Result.reasonCodes) -join ','))
    }
    return ($lines -join "`n")
}

try {
    $payload = Read-HookPayload
    $hasEventName = $null -ne $payload -and $null -ne $payload.PSObject.Properties['hook_event_name']
    if (-not $hasEventName -or [string]$payload.hook_event_name -ne 'UserPromptSubmit') {
        exit 0
    }

    $root = Resolve-HookRepositoryRoot -Payload $payload
    if ([string]::IsNullOrWhiteSpace($root)) {
        exit 0
    }
    $resolver = Join-Path $root 'scripts\resolve-codex-thread-worktree.ps1'
    $stateScript = if ([string]::IsNullOrWhiteSpace($RoutingStateScript)) { Join-Path $root 'scripts\codex-thread-routing-state.ps1' } else { $RoutingStateScript }
    if (-not (Test-Path -LiteralPath $resolver -PathType Leaf) -or -not (Test-Path -LiteralPath $stateScript -PathType Leaf)) {
        Write-HookContext -EventName 'UserPromptSubmit' -Context 'SKINCOS thread routing is unavailable in this checkout. Do not edit files; open a registered project containing the current routing implementation.' -Block -Reason 'Routing implementation unavailable.'
        exit 0
    }

    $prompt = [string]$payload.prompt
    $marker = Get-RouteMarker -Prompt $prompt
    if ($null -ne $marker) {
        $consumed = Invoke-JsonScript -ScriptPath $stateScript -Parameters @{
            Action = 'consume'
            RuntimeRegistryRoot = $RuntimeRegistryRoot
            CodexManagedWorktreeRoot = $CodexManagedWorktreeRoot
            SourceKey = $marker.sourceKey
            Nonce = $marker.nonce
            Checkout = $root
        }
        if ($null -eq $consumed -or $consumed.state -ne 'ready') {
            $reasonCodes = if ($null -ne $consumed) { @($consumed.reasonCodes) -join ',' } else { 'routing_state_unavailable' }
            Write-HookContext -EventName 'UserPromptSubmit' -Context "SKINCOS managed-worktree binding was rejected ($reasonCodes). This task must not write files. Start a new replacement from the registered project instead." -Block -Reason 'Managed worktree binding rejected.'
            exit 0
        }

        $binding = $consumed.binding
        $resolved = Invoke-JsonScript -ScriptPath $resolver -Parameters @{
            ProjectRoot = $root
            WorktreeRoot = $WorktreeRoot
            CodexManagedWorktreeRoot = $CodexManagedWorktreeRoot
            RuntimeRegistryRoot = $RuntimeRegistryRoot
            RoutingStateScript = $stateScript
            Intent = 'edit'
            SurfaceType = [string]$binding.surfaceType
            SurfaceId = [string]$binding.surfaceId
            TaskSlug = [string]$binding.taskSlug
            SkipGitHub = $true
        }
        if ($null -eq $resolved -or $resolved.state -ne 'ready') {
            $reasonCodes = if ($null -ne $resolved) { @($resolved.reasonCodes) -join ',' } else { 'resolver_unavailable' }
            Write-HookContext -EventName 'UserPromptSubmit' -Context "SKINCOS managed-worktree binding did not resolve to ready ($reasonCodes). This task must not write files." -Block -Reason 'Managed worktree resolver rejected the checkout.'
            exit 0
        }

        Write-HookContext -EventName 'UserPromptSubmit' -Context (Get-RouteContext -Result $resolved)
        exit 0
    }

    # Normal prompts always use edit. Preview and qualification are explicit actions,
    # so the hook never classifies intent from the words in the prompt.
    $resolved = Invoke-JsonScript -ScriptPath $resolver -Parameters @{
        ProjectRoot = $root
        WorktreeRoot = $WorktreeRoot
        CodexManagedWorktreeRoot = $CodexManagedWorktreeRoot
        RuntimeRegistryRoot = $RuntimeRegistryRoot
        RoutingStateScript = $stateScript
        Intent = 'edit'
        TaskBrief = $prompt
    }
    if ($null -eq $resolved) {
        Write-HookContext -EventName 'UserPromptSubmit' -Context 'SKINCOS thread routing could not produce a decision. Do not edit files in this checkout.' -Block -Reason 'Routing resolver unavailable.'
        exit 0
    }

    if ($resolved.state -eq 'ready') {
        Write-HookContext -EventName 'UserPromptSubmit' -Context (Get-RouteContext -Result $resolved)
        exit 0
    }

    if ($resolved.state -eq 'replace' -and $resolved.currentThreadAction -eq 'create_replacement_thread') {
        $issued = Invoke-JsonScript -ScriptPath $stateScript -Parameters @{
            Action = 'issue'
            RuntimeRegistryRoot = $RuntimeRegistryRoot
            CodexManagedWorktreeRoot = $CodexManagedWorktreeRoot
            SourceCheckout = $root
            SurfaceType = [string]$resolved.surfaceType
            SurfaceId = [string]$resolved.surfaceId
            Intent = 'edit'
            TargetCommit = [string]$resolved.targetCommit
            TaskSlug = [string]$resolved.currentTaskSlug
        }
        if ($null -eq $issued -or $issued.state -notin @('issued', 'reused')) {
            $reasonCodes = if ($null -ne $issued) { @($issued.reasonCodes) -join ',' } else { 'routing_state_unavailable' }
            Write-HookContext -EventName 'UserPromptSubmit' -Context "SKINCOS could not reserve a safe replacement route ($reasonCodes). Do not edit files in this checkout." -Block -Reason 'Replacement route was not reserved.'
            exit 0
        }

        $routeMarker = "[[SKINCOS_ROUTE_V1 nonce=$($issued.record.nonce) source=$($issued.sourceKey)]]"
        $context = Get-RouteContext -Result $resolved -Marker $routeMarker
        $context += "`nThis task is the wrong checkout. Do not edit it. Confirm a saved project whose primary folder is exactly sourceCheckout, then create a replacement task in a Codex-managed worktree from origin/main only after that ref equals targetCommit. Put routeMarker on its own first line in the replacement initial instruction, followed by the original objective. Wait for ready, navigate to the replacement, and archive this original task only after the replacement is ready. Never hand off this task to itself and never use the dirty working tree as a starting state."
        Write-HookContext -EventName 'UserPromptSubmit' -Context $context
        exit 0
    }

    if ($resolved.state -eq 'replace' -and $resolved.currentThreadAction -eq 'handoff_other_thread') {
        $issued = Invoke-JsonScript -ScriptPath $stateScript -Parameters @{
            Action = 'issue'
            RuntimeRegistryRoot = $RuntimeRegistryRoot
            CodexManagedWorktreeRoot = $CodexManagedWorktreeRoot
            SourceCheckout = $root
            SurfaceType = [string]$resolved.surfaceType
            SurfaceId = [string]$resolved.surfaceId
            Intent = 'edit'
            TargetCommit = [string]$resolved.targetCommit
            TaskSlug = [string]$resolved.currentTaskSlug
        }
        $context = Get-RouteContext -Result $resolved
        $context += "`nDo not edit this checkout. Handoff is allowed only if a different, already identified Codex task owns recommendedCheckout exactly. This task must never hand off itself. If that proof is unavailable, preserve both checkouts and do not choose a fallback automatically."
        Write-HookContext -EventName 'UserPromptSubmit' -Context $context
        exit 0
    }

    $context = Get-RouteContext -Result $resolved
    $context += "`nThis is a fail-closed routing state. Do not choose another checkout, create a fallback, or edit files until the listed registration or preservation condition is resolved."
    Write-HookContext -EventName 'UserPromptSubmit' -Context $context
    exit 0
}
catch {
    Write-HookContext -EventName 'UserPromptSubmit' -Context 'SKINCOS thread routing failed closed. Do not edit files in this checkout.' -Block -Reason 'Routing hook error.'
    exit 0
}
