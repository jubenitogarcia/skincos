$ErrorActionPreference = 'Stop'

$resolver = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\resolve-codex-thread-worktree.ps1')).Path
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('skincos-thread-router-' + [guid]::NewGuid().ToString('N'))
$repositoryRoot = Join-Path $tempRoot 'repository'
$worktreeRoot = Join-Path $tempRoot 'worktrees'
$runtimeRegistryRoot = Join-Path $tempRoot 'registry'
$topologyPath = Join-Path $tempRoot 'worktree-topology.json'
$createdWorktrees = @()

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

function Assert-Equal {
    param(
        [object]$Actual,
        [object]$Expected,
        [string]$Message
    )
    if ($Actual -ne $Expected) {
        throw "$Message. Expected '$Expected', got '$Actual'."
    }
}

function Assert-Contains {
    param(
        [object]$Collection,
        [string]$Expected,
        [string]$Message
    )
    if (@($Collection) -notcontains $Expected) {
        throw "$Message. Missing '$Expected'."
    }
}

function Normalize-FixturePath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ''
    }
    return ([IO.Path]::GetFullPath($Path)).TrimEnd([char[]]'/\\') -replace '/', '\\'
}

function Assert-PathEqual {
    param(
        [string]$Actual,
        [string]$Expected,
        [string]$Message
    )
    if ((Normalize-FixturePath $Actual) -ne (Normalize-FixturePath $Expected)) {
        throw "$Message. Expected '$Expected', got '$Actual'."
    }
}

function Invoke-ResolverFixture {
    param(
        [string]$ProjectRoot,
        [string]$TaskBrief,
        [string]$TaskSlug,
        [ValidateSet('edit', 'preview', 'qualify')]
        [string]$Intent,
        [switch]$NativeProjectRegistered
    )

    $arguments = @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', $resolver,
        '-ProjectRoot', $ProjectRoot,
        '-WorktreeRoot', $worktreeRoot,
        '-RuntimeRegistryRoot', $runtimeRegistryRoot,
        '-TopologyPath', $topologyPath,
        '-Intent', $Intent,
        '-SkipGitHub',
        '-SkipProcessScan'
    )
    if (-not [string]::IsNullOrWhiteSpace($TaskBrief)) {
        $arguments += @('-TaskBrief', $TaskBrief)
    }
    if (-not [string]::IsNullOrWhiteSpace($TaskSlug)) {
        $arguments += @('-TaskSlug', $TaskSlug)
    }
    if ($NativeProjectRegistered) {
        $arguments += '-NativeProjectRegistered'
    }
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $raw = @(& powershell.exe @arguments 2>&1 | ForEach-Object { [string]$_ })
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference
    if ($exitCode -ne 0) {
        throw "Resolver fixture failed: $($raw -join "`n")"
    }
    try {
        return ($raw -join "`n") | ConvertFrom-Json
    }
    catch {
        throw "Resolver did not return JSON: $($raw -join "`n")"
    }
}

try {
    New-Item -ItemType Directory -Path $repositoryRoot, $worktreeRoot, $runtimeRegistryRoot -Force | Out-Null
    & git init -q -b main $repositoryRoot
    & git -C $repositoryRoot config user.email 'codex-fixture@example.invalid'
    & git -C $repositoryRoot config user.name 'Codex Fixture'
    Set-Content -LiteralPath (Join-Path $repositoryRoot 'README.md') -Value 'fixture' -Encoding utf8
    Invoke-FixtureGit -Arguments @('add', 'README.md') | Out-Null
    Invoke-FixtureGit -Arguments @('commit', '-m', 'fixture') | Out-Null
    $head = (Invoke-FixtureGit -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1).Trim()
    Invoke-FixtureGit -Arguments @('update-ref', 'refs/remotes/origin/main', $head) | Out-Null

    $topology = [ordered]@{
        schemaVersion = 1
        topologyId = 'skincos-canonical-worktrees'
        worktree = [ordered]@{ canonicalRelativeRoot = 'admin\canonical' }
        crm = [ordered]@{
            surfaces = @(
                [ordered]@{ id = 'users'; label = 'Usuários'; route = '/?module=users'; source = 'fixture' },
                [ordered]@{ id = 'clientes'; label = 'Clientes'; route = '/?module=clientes'; source = 'fixture' }
            )
        }
        orb = [ordered]@{ families = @() }
    }
    $topology | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $topologyPath -Encoding utf8

    $taskPath = Join-Path $worktreeRoot 'admin\users-routing'
    $otherPath = Join-Path $worktreeRoot 'admin\other-routing'
    $outsideOperatorPath = Join-Path $worktreeRoot 'admin-alt\users-routing'
    $canonicalPath = Join-Path $worktreeRoot 'admin\canonical\crm\users'
    New-Item -ItemType Directory -Path (Split-Path -Parent $taskPath), (Split-Path -Parent $otherPath), (Split-Path -Parent $outsideOperatorPath), (Split-Path -Parent $canonicalPath) -Force | Out-Null
    Invoke-FixtureGit -Arguments @('worktree', 'add', '-b', 'codex/admin/users-routing', $taskPath, 'HEAD') | Out-Null
    $createdWorktrees += $taskPath
    Invoke-FixtureGit -Arguments @('worktree', 'add', '-b', 'codex/admin/other-routing', $otherPath, 'HEAD') | Out-Null
    $createdWorktrees += $otherPath
    Invoke-FixtureGit -Arguments @('worktree', 'add', '--detach', $canonicalPath, 'HEAD') | Out-Null
    $createdWorktrees += $canonicalPath

    $registry = [ordered]@{
        schemaVersion = 1
        surfaces = @([ordered]@{
            surfaceType = 'crm-module'
            surfaceId = 'users'
            path = $canonicalPath
            targetCommit = $head
        })
    }
    New-Item -ItemType Directory -Path $runtimeRegistryRoot -Force | Out-Null
    $registry | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $runtimeRegistryRoot 'canonical-registry.json') -Encoding utf8

    $ready = Invoke-ResolverFixture -ProjectRoot $taskPath -TaskBrief 'corrigir usuários' -TaskSlug 'users-routing' -Intent edit
    Assert-Equal -Actual $ready.state -Expected 'ready' -Message 'matching task worktree should be ready'
    Assert-Equal -Actual $ready.surfaceId -Expected 'users' -Message 'task surface should resolve'

    $handoff = Invoke-ResolverFixture -ProjectRoot $otherPath -TaskBrief 'corrigir usuários' -TaskSlug 'users-routing' -Intent edit
    Assert-Equal -Actual $handoff.state -Expected 'replace' -Message 'wrong task worktree should require replacement'
    Assert-Equal -Actual $handoff.nativeAction -Expected 'handoff_thread' -Message 'matching task worktree should use handoff'
    Assert-PathEqual -Actual $handoff.recommendedCheckout -Expected $taskPath -Message 'handoff should target the exact task worktree'

    Invoke-FixtureGit -Arguments @('worktree', 'add', '-b', 'codex/admin/users-routing-alt', $outsideOperatorPath, 'HEAD') | Out-Null
    $createdWorktrees += $outsideOperatorPath
    $outsideOperator = Invoke-ResolverFixture -ProjectRoot $otherPath -TaskBrief 'corrigir usuários' -TaskSlug 'users-routing' -Intent edit
    Assert-Equal -Actual $outsideOperator.state -Expected 'replace' -Message 'a worktree outside the registered operator root must not become a candidate'
    Assert-Equal -Actual $outsideOperator.nativeAction -Expected 'handoff_thread' -Message 'the registered operator worktree remains the only candidate'
    Assert-Equal -Actual @($outsideOperator.candidates).Count -Expected 1 -Message 'the outside-operator worktree must be ignored'

    $surfaceAmbiguous = Invoke-ResolverFixture -ProjectRoot $otherPath -TaskBrief 'corrigir usuários e clientes' -TaskSlug '' -Intent edit
    Assert-Equal -Actual $surfaceAmbiguous.state -Expected 'ambiguous' -Message 'multiple catalog surfaces should remain fail-closed'
    Assert-Contains -Collection $surfaceAmbiguous.reasonCodes -Expected 'multiple_surfaces_match_task_brief' -Message 'surface ambiguity should be explained'

    $noTaskIdentity = Invoke-ResolverFixture -ProjectRoot $repositoryRoot -TaskBrief 'corrigir usuários' -TaskSlug '' -Intent edit
    Assert-Equal -Actual $noTaskIdentity.state -Expected 'replace' -Message 'missing task identity should create a fresh safe thread'
    Assert-Equal -Actual $noTaskIdentity.nativeAction -Expected 'create_thread' -Message 'missing task identity must not guess an existing worktree'
    Assert-Equal -Actual @($noTaskIdentity.candidates).Count -Expected 0 -Message 'missing task identity must not use surface-name heuristics'

    $canonicalManual = Invoke-ResolverFixture -ProjectRoot $otherPath -TaskBrief 'validar usuários' -TaskSlug 'users-preview' -Intent preview
    Assert-Equal -Actual $canonicalManual.state -Expected 'manual_registration_required' -Message 'canonical preview should require App project registration'
    Assert-Equal -Actual $canonicalManual.nativeAction -Expected 'manual_open_project' -Message 'unregistered canonical preview should not guess a project'

    $canonicalReady = Invoke-ResolverFixture -ProjectRoot $canonicalPath -TaskBrief 'validar usuários' -TaskSlug 'users-preview' -Intent preview -NativeProjectRegistered
    Assert-Equal -Actual $canonicalReady.state -Expected 'ready' -Message 'registered canonical preview should be ready'
    Assert-Equal -Actual $canonicalReady.candidateType -Expected 'canonical' -Message 'preview should use canonical candidate'
    Assert-Equal -Actual $canonicalReady.canonical.detached -Expected $true -Message 'canonical fixture should remain detached'

    $ambiguous = Invoke-ResolverFixture -ProjectRoot $otherPath -TaskBrief '' -TaskSlug '' -Intent edit
    Assert-Equal -Actual $ambiguous.state -Expected 'ambiguous' -Message 'missing task brief should be ambiguous'
    Assert-Contains -Collection $ambiguous.reasonCodes -Expected 'task_brief_required_to_resolve_surface' -Message 'ambiguous result should explain missing task brief'

    $leasePath = Join-Path $runtimeRegistryRoot 'leases\crm-module--users'
    New-Item -ItemType Directory -Path $leasePath -Force | Out-Null
    [ordered]@{ owner = 'fixture'; token = 'fixture-token' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $leasePath 'owner.json') -Encoding utf8
    $leased = Invoke-ResolverFixture -ProjectRoot $canonicalPath -TaskBrief 'validar usuários' -TaskSlug 'users-preview' -Intent preview -NativeProjectRegistered
    Assert-Equal -Actual $leased.state -Expected 'blocked' -Message 'active canonical lease should block replacement'
    Assert-Contains -Collection $leased.preservationReasons -Expected 'canonical_active_lease_preserved' -Message 'lease protection should be visible'
    Remove-Item -LiteralPath $leasePath -Recurse -Force

    Set-Content -LiteralPath (Join-Path $canonicalPath 'dirty.txt') -Value 'dirty' -Encoding utf8
    $dirty = Invoke-ResolverFixture -ProjectRoot $canonicalPath -TaskBrief 'validar usuários' -TaskSlug 'users-preview' -Intent preview -NativeProjectRegistered
    Assert-Equal -Actual $dirty.state -Expected 'blocked' -Message 'dirty canonical slot should block replacement'
    Assert-Contains -Collection $dirty.preservationReasons -Expected 'canonical_dirty_preserved' -Message 'dirty protection should be visible'
    Remove-Item -LiteralPath (Join-Path $canonicalPath 'dirty.txt') -Force

    $manifestRoot = Join-Path $tempRoot 'runtime\crm-local\users'
    New-Item -ItemType Directory -Path $manifestRoot -Force | Out-Null
    [ordered]@{ worktree = $canonicalPath; sourceOrigin = $canonicalPath } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $manifestRoot 'current.json') -Encoding utf8
    $manifest = Invoke-ResolverFixture -ProjectRoot $canonicalPath -TaskBrief 'validar usuários' -TaskSlug 'users-preview' -Intent preview
    Assert-Contains -Collection $manifest.preservationReasons -Expected 'canonical_manifest_reference_preserved' -Message 'manifest reference should be preserved'

    $outside = Join-Path $tempRoot 'not-a-repository'
    New-Item -ItemType Directory -Path $outside -Force | Out-Null
    $blocked = Invoke-ResolverFixture -ProjectRoot $outside -TaskBrief 'corrigir usuários' -TaskSlug 'users-routing' -Intent edit
    Assert-Equal -Actual $blocked.state -Expected 'blocked' -Message 'non-Git checkout should fail closed'
    Assert-Contains -Collection $blocked.reasonCodes -Expected 'resolver_error' -Message 'non-Git result should expose resolver error'

    Write-Output 'PASS: resolver fixture scenarios'
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
