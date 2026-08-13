$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('skincos-thread-routing-bridge-' + [guid]::NewGuid().ToString('N'))
$implementationRoot = Join-Path $fixtureRoot 'implementation'
$contextRoot = Join-Path $fixtureRoot 'context'
$otherRoot = Join-Path $fixtureRoot 'other'
$worktreeRoot = Join-Path $fixtureRoot 'worktrees'
$managedRoot = Join-Path $worktreeRoot 'admin\managed'
$registryRoot = Join-Path $fixtureRoot 'registry'
$bridgeRoot = Join-Path $fixtureRoot 'bridge-runtime'
$globalHooksPath = Join-Path $fixtureRoot 'hooks.json'
$createdWorktrees = @()

function Assert-Equal {
    param([object]$Actual, [object]$Expected, [string]$Message)
    if ($Actual -ne $Expected) {
        throw "$Message. Expected '$Expected', got '$Actual'."
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Match {
    param([string]$Value, [string]$Pattern, [string]$Message)
    if ($Value -notmatch $Pattern) { throw "$Message. Pattern '$Pattern' was not found." }
}

function Assert-NotMatch {
    param([string]$Value, [string]$Pattern, [string]$Message)
    if ($Value -match $Pattern) { throw "$Message. Pattern '$Pattern' must not be present." }
}

function Invoke-FixtureGit {
    param([string]$Repository, [string[]]$Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& git -C $Repository @Arguments 2>&1 | ForEach-Object { [string]$_ })
        if ($LASTEXITCODE -ne 0) {
            throw "Git fixture command failed: git -C $Repository $($Arguments -join ' ')`n$($output -join "`n")"
        }
        return $output
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Copy-SourceFile {
    param([string]$Relative)

    $destination = Join-Path $implementationRoot $Relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot $Relative) -Destination $destination -Force
}

function Invoke-JsonScript {
    param(
        [string]$ScriptPath,
        [hashtable]$Parameters,
        [string]$InputJson
    )

    $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath)
    foreach ($entry in $Parameters.GetEnumerator()) {
        if ($null -eq $entry.Value) { continue }
        if ($entry.Value -is [bool]) {
            if ([bool]$entry.Value) { $arguments += ('-{0}' -f $entry.Key) }
            continue
        }
        $arguments += ('-{0}' -f $entry.Key)
        $arguments += [string]$entry.Value
    }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = @(if ($PSBoundParameters.ContainsKey('InputJson')) {
                $InputJson | & powershell.exe @arguments 2>&1 | ForEach-Object { [string]$_ }
            }
            else {
                & powershell.exe @arguments 2>&1 | ForEach-Object { [string]$_ }
            })
        if ($LASTEXITCODE -ne 0) {
            throw "Fixture script failed: $ScriptPath`n$($raw -join "`n")"
        }
        if ($raw.Count -eq 0) { return $null }
        return (($raw -join "`n") | ConvertFrom-Json)
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-BridgeHook {
    param([string]$EventName, [object]$Payload, [string]$LoaderPath, [string]$LoaderHash)

    return Invoke-JsonScript -ScriptPath $LoaderPath -Parameters @{
        Event = $EventName
        BridgeRoot = $bridgeRoot
        ExpectedBridgeHash = $LoaderHash
        RuntimeRegistryRoot = $registryRoot
        WorktreeRoot = $worktreeRoot
        CodexManagedWorktreeRoot = $managedRoot
        Repository = 'jubenitogarcia/skincos'
    } -InputJson ($Payload | ConvertTo-Json -Depth 24 -Compress)
}

try {
    New-Item -ItemType Directory -Path $implementationRoot, $contextRoot, $otherRoot, $managedRoot, $registryRoot -Force | Out-Null
    foreach ($relative in @(
            '.codex\hooks\invoke-codex-thread-routing.ps1',
            '.codex\hooks\invoke-codex-thread-routing-guard.ps1',
            'scripts\resolve-codex-thread-worktree.ps1',
            'scripts\codex-thread-routing-state.ps1',
            'scripts\invoke-codex-thread-routing-bridge.ps1',
            'scripts\manage-codex-thread-routing-bridge.ps1',
            'ops\codex\worktree-topology.json'
        )) {
        Copy-SourceFile -Relative $relative
    }
    $fixtureHooks = [ordered]@{
        hooks = [ordered]@{
            UserPromptSubmit = @([ordered]@{ hooks = @([ordered]@{ type = 'command'; command = 'fixture-prompt' }) })
            PreToolUse = @([ordered]@{ matcher = '*'; hooks = @([ordered]@{ type = 'command'; command = 'fixture-guard' }) })
        }
    }
    New-Item -ItemType Directory -Path (Join-Path $implementationRoot '.codex') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $implementationRoot '.codex\hooks.json'), (($fixtureHooks | ConvertTo-Json -Depth 12) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))

    foreach ($repository in @($implementationRoot, $contextRoot, $otherRoot)) {
        & git init -q -b main $repository
        & git -C $repository config user.email 'codex-fixture@example.invalid'
        & git -C $repository config user.name 'Codex Fixture'
        [IO.File]::WriteAllText((Join-Path $repository 'README.md'), "fixture`n", (New-Object Text.UTF8Encoding($false)))
        Invoke-FixtureGit -Repository $repository -Arguments @('add', '.') | Out-Null
        Invoke-FixtureGit -Repository $repository -Arguments @('commit', '-m', 'fixture') | Out-Null
    }
    foreach ($repository in @($implementationRoot, $contextRoot)) {
        Invoke-FixtureGit -Repository $repository -Arguments @('remote', 'add', 'origin', 'https://github.com/jubenitogarcia/skincos.git') | Out-Null
        $head = (Invoke-FixtureGit -Repository $repository -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1).Trim()
        Invoke-FixtureGit -Repository $repository -Arguments @('update-ref', 'refs/remotes/origin/main', $head) | Out-Null
    }
    Invoke-FixtureGit -Repository $otherRoot -Arguments @('remote', 'add', 'origin', 'https://github.com/example/not-skincos.git') | Out-Null

    $initialGlobalHooks = [ordered]@{
        hooks = [ordered]@{
            Stop = @([ordered]@{
                    hooks = @([ordered]@{ type = 'command'; command = 'keep-stop'; statusMessage = 'existing stop' })
                })
        }
    }
    [IO.File]::WriteAllText($globalHooksPath, (($initialGlobalHooks | ConvertTo-Json -Depth 12) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))

    $manager = Join-Path $implementationRoot 'scripts\manage-codex-thread-routing-bridge.ps1'
    $withoutApply = Invoke-JsonScript -ScriptPath $manager -Parameters @{
        Action = 'install-candidate'
        ProjectRoot = $implementationRoot
        ActivationCheckout = $contextRoot
        RuntimeRoot = $bridgeRoot
        GlobalHooksPath = $globalHooksPath
        RuntimeRegistryRoot = $registryRoot
        WorktreeRoot = $worktreeRoot
        CodexManagedWorktreeRoot = $managedRoot
        CandidateTtlSeconds = 120
        ActivationNonce = ('b' * 32)
    }
    Assert-Equal -Actual $withoutApply.state -Expected 'blocked' -Message 'candidate installation must require explicit Apply'
    $globalBeforeApply = Get-Content -LiteralPath $globalHooksPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $globalBeforeApply.hooks.Stop[0].hooks[0].command -Expected 'keep-stop' -Message 'a non-applied bridge command must preserve Stop'
    Assert-True -Condition ($null -eq $globalBeforeApply.hooks.PSObject.Properties['UserPromptSubmit']) -Message 'a non-applied bridge command must not add a prompt hook'

    $candidate = Invoke-JsonScript -ScriptPath $manager -Parameters @{
        Action = 'install-candidate'
        ProjectRoot = $implementationRoot
        ActivationCheckout = $contextRoot
        RuntimeRoot = $bridgeRoot
        GlobalHooksPath = $globalHooksPath
        RuntimeRegistryRoot = $registryRoot
        WorktreeRoot = $worktreeRoot
        CodexManagedWorktreeRoot = $managedRoot
        CandidateTtlSeconds = 120
        ActivationNonce = ('a' * 32)
        Apply = $true
    }
    if ($candidate.state -ne 'ready') {
        throw "Candidate bundle should install: $($candidate | ConvertTo-Json -Depth 12 -Compress)"
    }
    Assert-Match -Value $candidate.activationMarker -Pattern '^\[\[SKINCOS_BRIDGE_TEST_V1 activation=a{32}\]\]$' -Message 'candidate should return a private activation marker'
    $globalAfterInstall = Get-Content -LiteralPath $globalHooksPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $globalAfterInstall.hooks.Stop[0].hooks[0].command -Expected 'keep-stop' -Message 'existing Stop hook must be preserved'
    Assert-Equal -Actual @($globalAfterInstall.hooks.UserPromptSubmit).Count -Expected 1 -Message 'one global prompt bridge should be installed'
    Assert-Equal -Actual @($globalAfterInstall.hooks.PreToolUse).Count -Expected 1 -Message 'one global guard bridge should be installed'

    $loaderPath = [string]$candidate.loaderPath
    $loaderHash = [string]$candidate.loaderHash
    $directResolver = Invoke-JsonScript -ScriptPath (Join-Path $candidate.bundlePath 'scripts\resolve-codex-thread-worktree.ps1') -Parameters @{
        ProjectRoot = $contextRoot
        TaskBrief = 'corrigir users'
        Intent = 'edit'
        WorktreeRoot = $worktreeRoot
        CodexManagedWorktreeRoot = $managedRoot
        Apply = $true
        RuntimeRegistryRoot = $registryRoot
        TopologyPath = (Join-Path $candidate.bundlePath 'ops\codex\worktree-topology.json')
        RoutingStateScript = (Join-Path $candidate.bundlePath 'scripts\codex-thread-routing-state.ps1')
        SkipGitHub = $true
        SkipProcessScan = $true
    }
    if ($directResolver.state -ne 'replace') {
        throw "The private resolver should resolve users from the bundle topology: $($directResolver | ConvertTo-Json -Depth 12 -Compress)"
    }
    $directBundleHook = Invoke-JsonScript -ScriptPath (Join-Path $candidate.bundlePath '.codex\hooks\invoke-codex-thread-routing.ps1') -Parameters @{
        RuntimeRegistryRoot = $registryRoot
        WorktreeRoot = $worktreeRoot
        CodexManagedWorktreeRoot = $managedRoot
        TopologyPath = (Join-Path $candidate.bundlePath 'ops\codex\worktree-topology.json')
        RoutingStateScript = (Join-Path $candidate.bundlePath 'scripts\codex-thread-routing-state.ps1')
        ImplementationRoot = $candidate.bundlePath
    } -InputJson (([ordered]@{
                hook_event_name = 'UserPromptSubmit'
                cwd = $contextRoot
                prompt = 'corrigir users'
            }) | ConvertTo-Json -Depth 12 -Compress)
    $directBundleContext = [string]$directBundleHook.hookSpecificOutput.additionalContext
    if ($directBundleContext -notmatch 'state=replace') {
        throw "The verified private bundle should resolve the source checkout before global dispatch: $directBundleContext"
    }
    $outside = Invoke-BridgeHook -EventName 'UserPromptSubmit' -LoaderPath $loaderPath -LoaderHash $loaderHash -Payload ([ordered]@{
        hook_event_name = 'UserPromptSubmit'
        cwd = $otherRoot
        prompt = 'qualquer tarefa'
    })
    Assert-Equal -Actual $outside -Expected $null -Message 'the global bridge must have no effect outside SKINCOS'

    $forgedActivation = Invoke-BridgeHook -EventName 'UserPromptSubmit' -LoaderPath $loaderPath -LoaderHash $loaderHash -Payload ([ordered]@{
        hook_event_name = 'UserPromptSubmit'
        cwd = $contextRoot
        prompt = "[[SKINCOS_BRIDGE_TEST_V1 activation=$('f' * 32)]]`ncorrigir users"
    })
    Assert-Equal -Actual $forgedActivation.decision -Expected 'block' -Message 'a forged candidate activation must be rejected'

    $sourceResult = Invoke-BridgeHook -EventName 'UserPromptSubmit' -LoaderPath $loaderPath -LoaderHash $loaderHash -Payload ([ordered]@{
        hook_event_name = 'UserPromptSubmit'
        cwd = $contextRoot
        prompt = "$($candidate.activationMarker)`ncorrigir users"
    })
    Assert-Equal -Actual $sourceResult.hookSpecificOutput.hookEventName -Expected 'UserPromptSubmit' -Message 'candidate source must produce prompt context'
    $sourceContext = [string]$sourceResult.hookSpecificOutput.additionalContext
    if ($sourceContext -notmatch 'state=replace') {
        throw "Context checkout must request replacement: $sourceContext"
    }
    Assert-Match -Value $sourceContext -Pattern 'currentThreadAction=create_replacement_thread' -Message 'replacement action must be explicit'
    $route = [regex]::Match($sourceContext, '\[\[SKINCOS_ROUTE_V1 nonce=(?<nonce>[a-f0-9]{32}) source=(?<source>[a-f0-9]{64})\]\]')
    Assert-True -Condition $route.Success -Message 'candidate source must receive a private route marker'
    Assert-NotMatch -Value $sourceContext -Pattern 'SKINCOS_BRIDGE_TEST_V1' -Message 'the activation marker must not enter routing context'
    $activeAfterConsumption = Get-Content -LiteralPath (Join-Path $bridgeRoot 'active.json') -Raw | ConvertFrom-Json
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$activeAfterConsumption.activation.consumedAtUtc)) -Message 'candidate activation must be consumed exactly once'

    $denied = Invoke-BridgeHook -EventName 'PreToolUse' -LoaderPath $loaderPath -LoaderHash $loaderHash -Payload ([ordered]@{
        hook_event_name = 'PreToolUse'
        cwd = $contextRoot
        tool_name = 'apply_patch'
        tool_input = [ordered]@{ patch = '*** Begin Patch' }
    })
    Assert-Equal -Actual $denied.hookSpecificOutput.permissionDecision -Expected 'deny' -Message 'pending replacement must block source writes through the global bridge'

    $contextHead = (Invoke-FixtureGit -Repository $contextRoot -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1).Trim()
    $managedChild = Join-Path $managedRoot 'bound-child'
    Invoke-FixtureGit -Repository $contextRoot -Arguments @('worktree', 'add', '--detach', $managedChild, $contextHead) | Out-Null
    $createdWorktrees += $managedChild
    $bound = Invoke-BridgeHook -EventName 'UserPromptSubmit' -LoaderPath $loaderPath -LoaderHash $loaderHash -Payload ([ordered]@{
        hook_event_name = 'UserPromptSubmit'
        cwd = $managedChild
        prompt = "[[SKINCOS_ROUTE_V1 nonce=$($route.Groups['nonce'].Value) source=$($route.Groups['source'].Value)]]`ncorrigir users"
    })
    Assert-Match -Value ([string]$bound.hookSpecificOutput.additionalContext) -Pattern 'state=ready' -Message 'a detached managed replacement must bind and become ready'
    Assert-NotMatch -Value ([string]$bound.hookSpecificOutput.additionalContext) -Pattern 'nonce=' -Message 'a consumed route marker must not be echoed'

    $duplicate = Invoke-BridgeHook -EventName 'UserPromptSubmit' -LoaderPath $loaderPath -LoaderHash $loaderHash -Payload ([ordered]@{
        hook_event_name = 'UserPromptSubmit'
        cwd = $implementationRoot
        prompt = 'corrigir users'
    })
    Assert-Equal -Actual $duplicate -Expected $null -Message 'a checkout with complete project hooks must remain the sole routing source'

    $stable = Invoke-JsonScript -ScriptPath $manager -Parameters @{
        Action = 'activate-stable'
        ProjectRoot = $implementationRoot
        RuntimeRoot = $bridgeRoot
        GlobalHooksPath = $globalHooksPath
        Apply = $true
        RuntimeRegistryRoot = $registryRoot
        WorktreeRoot = $worktreeRoot
        CodexManagedWorktreeRoot = $managedRoot
    }
    Assert-Equal -Actual $stable.state -Expected 'ready' -Message 'stable activation should accept the integrated fixture SHA'
    $stableSource = Invoke-BridgeHook -EventName 'UserPromptSubmit' -LoaderPath $loaderPath -LoaderHash $loaderHash -Payload ([ordered]@{
        hook_event_name = 'UserPromptSubmit'
        cwd = $contextRoot
        prompt = 'corrigir users'
    })
    Assert-Match -Value ([string]$stableSource.hookSpecificOutput.additionalContext) -Pattern 'state=replace' -Message 'stable bridge should route an incomplete SKINCOS checkout'

    [IO.File]::AppendAllText((Join-Path $stable.bundlePath 'scripts\resolve-codex-thread-worktree.ps1'), "`n# fixture tamper`n", (New-Object Text.UTF8Encoding($false)))
    $tampered = Invoke-BridgeHook -EventName 'UserPromptSubmit' -LoaderPath $loaderPath -LoaderHash $loaderHash -Payload ([ordered]@{
        hook_event_name = 'UserPromptSubmit'
        cwd = $contextRoot
        prompt = 'corrigir users'
    })
    Assert-Equal -Actual $tampered.decision -Expected 'block' -Message 'a changed private bundle must fail closed before routing'
    Assert-Match -Value ([string]$tampered.hookSpecificOutput.additionalContext) -Pattern 'bundle_file_hash_mismatch' -Message 'a changed private bundle must report its verified failure class'

    $registryContent = (Get-ChildItem -LiteralPath $fixtureRoot -File -Recurse | Where-Object { $_.FullName -notmatch '\\.git\\' } | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n"
    Assert-NotMatch -Value $registryContent -Pattern '(?i)threadId|cookie|authorization' -Message 'bridge runtime and bindings must not persist task ids, cookies, or credentials'

    $deactivated = Invoke-JsonScript -ScriptPath $manager -Parameters @{
        Action = 'deactivate'
        ProjectRoot = $implementationRoot
        RuntimeRoot = $bridgeRoot
        GlobalHooksPath = $globalHooksPath
        Apply = $true
    }
    Assert-Equal -Actual $deactivated.state -Expected 'ready' -Message 'bridge deactivation should remove only its handlers'
    $globalAfterDeactivate = Get-Content -LiteralPath $globalHooksPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $globalAfterDeactivate.hooks.Stop[0].hooks[0].command -Expected 'keep-stop' -Message 'deactivation must preserve the existing Stop hook'
    Assert-True -Condition ($null -eq $globalAfterDeactivate.hooks.PSObject.Properties['UserPromptSubmit']) -Message 'deactivation must remove only the bridge prompt handler'
    Assert-True -Condition ($null -eq $globalAfterDeactivate.hooks.PSObject.Properties['PreToolUse']) -Message 'deactivation must remove only the bridge guard handler'

    Write-Output 'PASS: private global bridge candidate, stable bundle, nonce, guard, and configuration fixtures'
}
finally {
    foreach ($path in @($createdWorktrees | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $path) {
            & git -C $contextRoot worktree remove --force $path 2>$null | Out-Null
        }
    }
    if (Test-Path -LiteralPath $contextRoot) {
        & git -C $contextRoot worktree prune 2>$null | Out-Null
    }
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}
