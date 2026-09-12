[CmdletBinding()]
param(
    [string]$RuntimeRegistryRoot = 'C:\CodexRuntime\operator\admin\skincos\worktree-registry',
    [string]$WorktreeRoot = 'C:\CodexShared\Worktrees\skincos',
    [string]$CodexManagedWorktreeRoot = 'C:\CodexShared\Worktrees\skincos\admin\managed',
    [string]$RoutingStateScript,
    [string]$ImplementationRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:HookRawInput = try { [Console]::In.ReadToEnd() } catch { '' }

function Read-HookPayload {
    $raw = $script:HookRawInput
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }
    return $raw | ConvertFrom-Json
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

function Invoke-RouteState {
    param([string]$ScriptPath, [string]$Root)

    $raw = @(& $ScriptPath -Action 'get-pending' -RuntimeRegistryRoot $RuntimeRegistryRoot -CodexManagedWorktreeRoot $CodexManagedWorktreeRoot -SourceCheckout $Root 2>$null | ForEach-Object { [string]$_ })
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

function Test-ReadOnlyShellCommand {
    param([string]$Command)

    if ([string]::IsNullOrWhiteSpace($Command)) {
        return $false
    }
    $writePattern = '(?i)(^|[\s;|&])(?:set-content|add-content|clear-content|out-file|new-item|remove-item|move-item|copy-item|rename-item|apply_patch|git\s+(?:add|commit|am|apply|cherry-pick|clean|merge|rebase|reset|restore|stash|switch|checkout|worktree\s+(?:add|remove|move|prune))|rm|del|erase|mv|cp|mkdir|touch|tee|npm\s+(?:install|ci|run\s+[^\s]*(?:deploy|publish|migrate|seed|write))|wrangler\s+(?:deploy|pages\s+deploy))\b'
    if ($Command -match $writePattern) {
        return $false
    }
    if ($Command -match '(?<!\d)>{1,2}|\+\+|--force') {
        return $false
    }
    return $true
}

function Test-AllowedTool {
    param([object]$Payload)

    $name = [string]$Payload.tool_name
    if ($name -in @(
            'codex_app__list_projects',
            'codex_app__create_thread',
            'codex_app__wait_threads',
            'codex_app__navigate_to_codex_page',
            'codex_app__set_thread_archived',
            'codex_app__read_thread_terminal',
            'update_plan'
        )) {
        return $true
    }
    if ($name -in @('Bash', 'shell_command', 'exec_command')) {
        $command = if ($null -ne $Payload.tool_input -and $null -ne $Payload.tool_input.PSObject.Properties['command']) { [string]$Payload.tool_input.command } else { '' }
        return Test-ReadOnlyShellCommand -Command $command
    }
    if ($name -match '(?i)(read|list|search|find|view|status|inspect|get)') {
        return $true
    }
    return $false
}

function Write-Deny {
    param([string]$Reason)

    [pscustomobject]@{
        hookSpecificOutput = [pscustomobject]@{
            hookEventName = 'PreToolUse'
            permissionDecision = 'deny'
            permissionDecisionReason = $Reason
        }
    } | ConvertTo-Json -Compress
}

try {
    $payload = Read-HookPayload
    $hasEventName = $null -ne $payload -and $null -ne $payload.PSObject.Properties['hook_event_name']
    if (-not $hasEventName -or [string]$payload.hook_event_name -ne 'PreToolUse') {
        exit 0
    }
    $root = Resolve-HookRepositoryRoot -Payload $payload
    if ([string]::IsNullOrWhiteSpace($root)) {
        exit 0
    }
    $implementationRoot = if ([string]::IsNullOrWhiteSpace($ImplementationRoot)) {
        $root
    }
    else {
        (Resolve-Path -LiteralPath $ImplementationRoot -ErrorAction Stop).Path
    }
    $stateScript = if ([string]::IsNullOrWhiteSpace($RoutingStateScript)) { Join-Path $implementationRoot 'scripts\codex-thread-routing-state.ps1' } else { $RoutingStateScript }
    if (-not (Test-Path -LiteralPath $stateScript -PathType Leaf)) {
        exit 0
    }
    $pending = Invoke-RouteState -ScriptPath $stateScript -Root $root
    if ($null -eq $pending -or $pending.state -ne 'active') {
        exit 0
    }
    if (-not (Test-AllowedTool -Payload $payload)) {
        Write-Deny -Reason 'This checkout has a pending replacement route. File writes and unsafe tools are blocked until the replacement task is ready or the private route expires.'
    }
    exit 0
}
catch {
    # A guard failure must not turn into an implicit approval.
    Write-Deny -Reason 'The pending replacement-route guard could not be evaluated safely.'
    exit 0
}
