$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('skincos-thread-routing-hook-' + [guid]::NewGuid().ToString('N'))
$repositoryRoot = Join-Path $tempRoot 'repository'
$worktreeRoot = Join-Path $tempRoot 'worktrees'
$managedRoot = Join-Path $worktreeRoot 'admin\managed'
$registryRoot = Join-Path $tempRoot 'registry'
$createdWorktrees = @()

function Assert-Equal {
    param([object]$Actual, [object]$Expected, [string]$Message)
    if ($Actual -ne $Expected) {
        throw "$Message. Expected '$Expected', got '$Actual'."
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Match {
    param([string]$Value, [string]$Pattern, [string]$Message)
    if ($Value -notmatch $Pattern) {
        throw "$Message. Pattern '$Pattern' was not found."
    }
}

function Assert-NotMatch {
    param([string]$Value, [string]$Pattern, [string]$Message)
    if ($Value -match $Pattern) {
        throw "$Message. Pattern '$Pattern' must not be present."
    }
}

function Invoke-FixtureGit {
    param([string[]]$Arguments)

    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = @(& git -C $repositoryRoot @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference
    if ($exitCode -ne 0) {
        throw "Git fixture command failed: git -C $repositoryRoot $($Arguments -join ' ')`n$($output -join "`n")"
    }
    return $output
}

function Invoke-FixtureJsonScript {
    param(
        [string]$ScriptPath,
        [hashtable]$Parameters,
        [string]$InputJson
    )

    $processArguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath)
    foreach ($entry in $Parameters.GetEnumerator()) {
        if ($null -eq $entry.Value) {
            continue
        }
        if ($entry.Value -is [bool]) {
            if ([bool]$entry.Value) {
                $processArguments += ('-{0}' -f $entry.Key)
            }
            continue
        }
        $processArguments += ('-{0}' -f $entry.Key)
        $processArguments += [string]$entry.Value
    }
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    if ($PSBoundParameters.ContainsKey('InputJson')) {
        $raw = @($InputJson | & powershell.exe @processArguments 2>&1 | ForEach-Object { [string]$_ })
    }
    else {
        $raw = @(& powershell.exe @processArguments 2>&1 | ForEach-Object { [string]$_ })
    }
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference
    if ($exitCode -ne 0) {
        $renderedParameters = @($Parameters.GetEnumerator() | ForEach-Object { '-{0} {1}' -f $_.Key, $_.Value }) -join ' '
        throw "Fixture script failed: $ScriptPath $renderedParameters`n$($raw -join "`n")"
    }
    try {
        return (($raw -join "`n") | ConvertFrom-Json)
    }
    catch {
        throw "Fixture script did not return JSON: $ScriptPath`n$($raw -join "`n")"
    }
}

function Invoke-RoutingState {
    param([string[]]$Arguments)

    $stateParameters = @{
        RuntimeRegistryRoot = $registryRoot
        CodexManagedWorktreeRoot = $managedRoot
    }
    for ($index = 0; $index -lt $Arguments.Count; $index += 2) {
        $name = ([string]$Arguments[$index]).TrimStart('-')
        $stateParameters[$name] = $Arguments[$index + 1]
    }
    return Invoke-FixtureJsonScript -ScriptPath (Join-Path $repositoryRoot 'scripts\codex-thread-routing-state.ps1') -Parameters $stateParameters
}

function Invoke-RoutingHook {
    param(
        [string]$HookName,
        [object]$Payload
    )

    $scriptPath = Join-Path $repositoryRoot ('.codex\hooks\' + $HookName)
    return Invoke-FixtureJsonScript -ScriptPath $scriptPath -Parameters @{
        RuntimeRegistryRoot = $registryRoot
        WorktreeRoot = $worktreeRoot
        CodexManagedWorktreeRoot = $managedRoot
    } -InputJson ($Payload | ConvertTo-Json -Depth 12 -Compress)
}

function Invoke-FixtureResolver {
    param(
        [string]$ProjectRoot,
        [string]$SurfaceId = 'users'
    )

    return Invoke-FixtureJsonScript -ScriptPath (Join-Path $repositoryRoot 'scripts\resolve-codex-thread-worktree.ps1') -Parameters @{
        ProjectRoot = $ProjectRoot
        WorktreeRoot = $worktreeRoot
        CodexManagedWorktreeRoot = $managedRoot
        RuntimeRegistryRoot = $registryRoot
        Intent = 'edit'
        SurfaceType = 'crm-module'
        SurfaceId = $SurfaceId
        SkipGitHub = $true
        SkipProcessScan = $true
    }
}

try {
    New-Item -ItemType Directory -Path $repositoryRoot, $worktreeRoot, $managedRoot, $registryRoot -Force | Out-Null
    foreach ($relative in @(
            'scripts\resolve-codex-thread-worktree.ps1',
            'scripts\codex-thread-routing-state.ps1',
            '.codex\hooks\invoke-codex-thread-routing.ps1',
            '.codex\hooks\invoke-codex-thread-routing-guard.ps1'
        )) {
        $destination = Join-Path $repositoryRoot $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $sourceRoot $relative) -Destination $destination -Force
    }
    $topologyPath = Join-Path $repositoryRoot 'ops\codex\worktree-topology.json'
    New-Item -ItemType Directory -Path (Split-Path -Parent $topologyPath) -Force | Out-Null
    [ordered]@{
        schemaVersion = 1
        topologyId = 'skincos-canonical-worktrees'
        worktree = [ordered]@{ canonicalRelativeRoot = 'admin\canonical' }
        crm = [ordered]@{ surfaces = @([ordered]@{ id = 'users'; label = 'Usuários'; route = '/?module=users'; source = 'fixture' }) }
        # `relatedWorkflowIds` is optional in the real topology. Keep a family
        # without it here because the hook runs the resolver under StrictMode.
        orb = [ordered]@{ families = @([ordered]@{
                    id = 'livia'
                    label = 'Livia'
                    mainWorkflowIds = @('WGXr4vYkv9UoJ8zc')
                    subworkflowIds = @()
                }) }
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $topologyPath -Encoding utf8

    & git init -q -b main $repositoryRoot
    & git -C $repositoryRoot config user.email 'codex-fixture@example.invalid'
    & git -C $repositoryRoot config user.name 'Codex Fixture'
    Set-Content -LiteralPath (Join-Path $repositoryRoot 'README.md') -Value 'fixture' -Encoding utf8
    Invoke-FixtureGit -Arguments @('add', '.') | Out-Null
    Invoke-FixtureGit -Arguments @('commit', '-m', 'fixture') | Out-Null
    $head = (Invoke-FixtureGit -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1).Trim()
    Invoke-FixtureGit -Arguments @('update-ref', 'refs/remotes/origin/main', $head) | Out-Null

    $sourcePayload = [ordered]@{
        hook_event_name = 'UserPromptSubmit'
        cwd = $repositoryRoot
        prompt = 'corrigir users'
        permission_mode = 'default'
    }
    $sourceHook = Invoke-RoutingHook -HookName 'invoke-codex-thread-routing.ps1' -Payload $sourcePayload
    if ($null -eq $sourceHook.PSObject.Properties['hookSpecificOutput']) {
        throw "Prompt hook returned an unexpected payload: $($sourceHook | ConvertTo-Json -Depth 20 -Compress)"
    }
    Assert-Equal -Actual $sourceHook.hookSpecificOutput.hookEventName -Expected 'UserPromptSubmit' -Message 'prompt hook should emit UserPromptSubmit context'
    $sourceContext = [string]$sourceHook.hookSpecificOutput.additionalContext
    if ($sourceContext -notmatch 'state=replace') {
        throw "Prompt hook context did not request replacement: $sourceContext"
    }
    Assert-Match -Value $sourceContext -Pattern 'state=replace' -Message 'wrong checkout should request replacement'
    Assert-Match -Value $sourceContext -Pattern 'currentThreadAction=create_replacement_thread' -Message 'replacement must be explicit'
    Assert-NotMatch -Value $sourceContext -Pattern 'corrigir users' -Message 'the hook must not copy the original prompt into developer context'
    $markerMatch = [regex]::Match($sourceContext, '\[\[SKINCOS_ROUTE_V1 nonce=(?<nonce>[a-f0-9]{32}) source=(?<source>[a-f0-9]{64})\]\]')
    Assert-True -Condition $markerMatch.Success -Message 'replacement context should carry one signed route marker'
    $nonce = $markerMatch.Groups['nonce'].Value
    $sourceKey = $markerMatch.Groups['source'].Value

    $reused = Invoke-RoutingState -Arguments @(
        '-Action', 'issue',
        '-SourceCheckout', $repositoryRoot,
        '-SurfaceType', 'crm-module',
        '-SurfaceId', 'users',
        '-Intent', 'edit',
        '-TargetCommit', $head
    )
    Assert-Equal -Actual $reused.state -Expected 'reused' -Message 'the same source route should be idempotent'
    Assert-Equal -Actual $reused.record.nonce -Expected $nonce -Message 'idempotent routing should retain the nonce'

    $guardDenied = Invoke-RoutingHook -HookName 'invoke-codex-thread-routing-guard.ps1' -Payload ([ordered]@{
        hook_event_name = 'PreToolUse'
        cwd = $repositoryRoot
        tool_name = 'apply_patch'
        tool_input = [ordered]@{ patch = '*** Begin Patch' }
    })
    Assert-Equal -Actual $guardDenied.hookSpecificOutput.permissionDecision -Expected 'deny' -Message 'pending replacement must block source edits'
    $guardAllowedPayload = [ordered]@{
        hook_event_name = 'PreToolUse'
        cwd = $repositoryRoot
        tool_name = 'codex_app__create_thread'
        tool_input = [ordered]@{}
    }
    $guardAllowedInput = $guardAllowedPayload | ConvertTo-Json -Depth 8 -Compress
    $guardAllowedRaw = @($guardAllowedInput | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $repositoryRoot '.codex\hooks\invoke-codex-thread-routing-guard.ps1') -RuntimeRegistryRoot $registryRoot -CodexManagedWorktreeRoot $managedRoot 2>&1)
    Assert-Equal -Actual $guardAllowedRaw.Count -Expected 0 -Message 'the guard should allow the native replacement action'

    $managedChild = Join-Path $managedRoot 'bound-child'
    Invoke-FixtureGit -Arguments @('worktree', 'add', '--detach', $managedChild, $head) | Out-Null
    $createdWorktrees += $managedChild
    $boundHook = Invoke-RoutingHook -HookName 'invoke-codex-thread-routing.ps1' -Payload ([ordered]@{
        hook_event_name = 'UserPromptSubmit'
        cwd = $managedChild
        prompt = "[[SKINCOS_ROUTE_V1 nonce=$nonce source=$sourceKey]]`ncorrigir users"
        permission_mode = 'default'
    })
    $boundContext = [string]$boundHook.hookSpecificOutput.additionalContext
    Assert-Match -Value $boundContext -Pattern 'state=ready' -Message 'a bound detached managed worktree should be ready'
    Assert-NotMatch -Value $boundContext -Pattern 'nonce=' -Message 'the nonce must not be echoed after consumption'
    $boundResolver = Invoke-FixtureResolver -ProjectRoot $managedChild
    Assert-Equal -Actual $boundResolver.state -Expected 'ready' -Message 'resolver should trust only the consumed managed binding'
    Assert-Equal -Actual $boundResolver.candidateType -Expected 'codex-managed' -Message 'bound child should report managed candidate type'
    Assert-Equal -Actual $boundResolver.targetCommit -Expected $head -Message 'bound child target should equal its HEAD'
    Assert-Equal -Actual $boundResolver.currentDetached -Expected $true -Message 'managed child is expected to be detached'

    $replayedBoundHook = Invoke-RoutingHook -HookName 'invoke-codex-thread-routing.ps1' -Payload ([ordered]@{
        hook_event_name = 'UserPromptSubmit'
        cwd = $managedChild
        prompt = "[[SKINCOS_ROUTE_V1 nonce=$nonce source=$sourceKey]]`ncorrigir users"
    })
    Assert-Match -Value ([string]$replayedBoundHook.hookSpecificOutput.additionalContext) -Pattern 'state=ready' -Message 'a retried first prompt must reuse only its own managed binding'

    $forgedChild = Join-Path $managedRoot 'forged-child'
    Invoke-FixtureGit -Arguments @('worktree', 'add', '--detach', $forgedChild, $head) | Out-Null
    $createdWorktrees += $forgedChild
    $forged = Invoke-RoutingHook -HookName 'invoke-codex-thread-routing.ps1' -Payload ([ordered]@{
        hook_event_name = 'UserPromptSubmit'
        cwd = $forgedChild
        prompt = "[[SKINCOS_ROUTE_V1 nonce=$('f' * 32) source=$sourceKey]]`ncorrigir users"
    })
    Assert-Equal -Actual $forged.decision -Expected 'block' -Message 'forged route markers must be rejected'
    $forgedResolver = Invoke-FixtureResolver -ProjectRoot $forgedChild
    Assert-Equal -Actual $forgedResolver.state -Expected 'blocked' -Message 'unbound managed worktrees remain fail-closed'

    $expired = Invoke-RoutingState -Arguments @(
        '-Action', 'issue',
        '-SourceCheckout', $repositoryRoot,
        '-SurfaceType', 'crm-module',
        '-SurfaceId', 'users',
        '-Intent', 'edit',
        '-TargetCommit', $head,
        '-TtlSeconds', '-1'
    )
    Assert-Equal -Actual $expired.state -Expected 'issued' -Message 'expired nonce fixture should be issued before its first use'
    $expiredChild = Join-Path $managedRoot 'expired-child'
    Invoke-FixtureGit -Arguments @('worktree', 'add', '--detach', $expiredChild, $head) | Out-Null
    $createdWorktrees += $expiredChild
    $expiredMarker = "[[SKINCOS_ROUTE_V1 nonce=$($expired.record.nonce) source=$($expired.sourceKey)]]"
    $expiredHook = Invoke-RoutingHook -HookName 'invoke-codex-thread-routing.ps1' -Payload ([ordered]@{
        hook_event_name = 'UserPromptSubmit'
        cwd = $expiredChild
        prompt = "$expiredMarker`ncorrigir users"
    })
    Assert-Equal -Actual $expiredHook.decision -Expected 'block' -Message 'expired route markers must be rejected'

    $mismatchRoute = Invoke-RoutingState -Arguments @(
        '-Action', 'issue',
        '-SourceCheckout', $repositoryRoot,
        '-SurfaceType', 'crm-module',
        '-SurfaceId', 'users',
        '-Intent', 'edit',
        '-TargetCommit', $head
    )
    Assert-Equal -Actual $mismatchRoute.state -Expected 'issued' -Message 'mismatch fixture should reserve a fresh route'
    Set-Content -LiteralPath (Join-Path $repositoryRoot 'mismatch.txt') -Value 'new commit' -Encoding utf8
    Invoke-FixtureGit -Arguments @('add', 'mismatch.txt') | Out-Null
    Invoke-FixtureGit -Arguments @('commit', '-m', 'mismatch') | Out-Null
    $mismatchHead = (Invoke-FixtureGit -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1).Trim()
    $mismatchChild = Join-Path $managedRoot 'mismatch-child'
    Invoke-FixtureGit -Arguments @('worktree', 'add', '--detach', $mismatchChild, $mismatchHead) | Out-Null
    $createdWorktrees += $mismatchChild
    $mismatchMarker = "[[SKINCOS_ROUTE_V1 nonce=$($mismatchRoute.record.nonce) source=$($mismatchRoute.sourceKey)]]"
    $mismatchHook = Invoke-RoutingHook -HookName 'invoke-codex-thread-routing.ps1' -Payload ([ordered]@{
        hook_event_name = 'UserPromptSubmit'
        cwd = $mismatchChild
        prompt = "$mismatchMarker`ncorrigir users"
    })
    Assert-Equal -Actual $mismatchHook.decision -Expected 'block' -Message 'a managed checkout at another SHA must be rejected'

    $registryContent = (Get-ChildItem -LiteralPath $registryRoot -File -Recurse | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n"
    Assert-NotMatch -Value $registryContent -Pattern '(?i)threadId|cookie|authorization' -Message 'private routing state must not persist task ids, cookies, or credentials'

    Write-Output 'PASS: prompt routing, nonce binding, and write guard fixtures'
}
finally {
    foreach ($path in @($createdWorktrees | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $path) {
            & git -C $repositoryRoot worktree remove --force $path 2>$null | Out-Null
        }
    }
    if (Test-Path -LiteralPath $repositoryRoot) {
        & git -C $repositoryRoot worktree prune 2>$null | Out-Null
    }
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
