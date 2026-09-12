$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $scriptRoot
$coordinator = Join-Path $repositoryRoot 'scripts\manage-canonical-worktrees.ps1'
$topologySource = Join-Path $repositoryRoot 'ops\codex\worktree-topology.json'
$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) "skincos-canonical-topology-$PID"
$fixtureRepo = Join-Path $fixtureRoot 'repo'
$fixtureWorktrees = Join-Path $fixtureRoot 'worktrees'
$fixtureRegistry = Join-Path $fixtureRoot 'registry'
$fixtureTopology = Join-Path $fixtureRoot 'topology.json'

function Invoke-GitFixture {
    param([string[]]$Arguments)
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & git @Arguments 2>$null | Out-Null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference
    if ($exitCode -ne 0) { throw "Fixture git failed: git $($Arguments -join ' ')" }
}

function Invoke-Coordinator {
    param([hashtable]$Parameters)
    $arguments = @{
        ProjectRoot = $fixtureRepo
        WorktreeRoot = $fixtureWorktrees
        TopologyPath = $fixtureTopology
        RuntimeRegistryRoot = $fixtureRegistry
        SkipGitHub = $true
    }
    foreach ($key in $Parameters.Keys) { $arguments[$key] = $Parameters[$key] }
    $output = @(& $coordinator @arguments 2>&1 | ForEach-Object { [string]$_ })
    if ($LASTEXITCODE -ne 0) { throw "Coordinator failed: $($output -join ' ')" }
    return ($output -join "`n" | ConvertFrom-Json)
}

try {
    New-Item -ItemType Directory -Path $fixtureRepo, $fixtureWorktrees, $fixtureRegistry -Force | Out-Null
    Invoke-GitFixture @('-C', $fixtureRepo, 'init', '--quiet')
    Invoke-GitFixture @('-C', $fixtureRepo, 'config', 'user.email', 'fixture@example.invalid')
    Invoke-GitFixture @('-C', $fixtureRepo, 'config', 'user.name', 'Fixture')
    Set-Content -LiteralPath (Join-Path $fixtureRepo 'README.md') -Value "fixture`n" -Encoding utf8
    foreach ($requiredPath in @('ops/codex/worktree-topology.json', 'scripts/resolve-codex-thread-worktree.ps1', '.codex/hooks.json', '.codex/environments/environment.toml')) {
        $requiredFile = Join-Path $fixtureRepo ($requiredPath -replace '/', '\')
        New-Item -ItemType Directory -Path (Split-Path -Parent $requiredFile) -Force | Out-Null
        Set-Content -LiteralPath $requiredFile -Value "fixture $requiredPath`n" -Encoding utf8
    }
    Set-Content -LiteralPath (Join-Path $fixtureRepo 'scripts/invoke-skincos-wsl.ps1') -Value "exit 1`n" -Encoding utf8
    Invoke-GitFixture @('-C', $fixtureRepo, 'add', '.')
    Invoke-GitFixture @('-C', $fixtureRepo, 'commit', '--quiet', '-m', 'fixture')
    $target = (& git -C $fixtureRepo rev-parse HEAD).Trim()

    $topology = [ordered]@{
        schemaVersion = 1
        topologyId = 'skincos-canonical-worktrees'
        worktree = [ordered]@{ canonicalRelativeRoot = 'admin\canonical'; pathTemplate = 'admin\canonical\{surfaceType}\{surfaceId}' }
        crm = [ordered]@{
            pilot = @('users')
            surfaces = @([ordered]@{ id = 'users'; label = 'Usuários'; route = '/?module=users'; source = 'fixture' })
        }
        orb = [ordered]@{ pilot = @(); families = @() }
    }
    $topology | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $fixtureTopology -Encoding utf8

    $common = @('-ProjectRoot', $fixtureRepo, '-WorktreeRoot', $fixtureWorktrees, '-TopologyPath', $fixtureTopology, '-RuntimeRegistryRoot', $fixtureRegistry, '-SkipGitHub')
    $initial = Invoke-Coordinator @{ Action = 'inventory' }
    if ($initial.missingCount -ne 1 -or $initial.presentCount -ne 0) { throw 'Initial inventory did not report one missing canonical slot.' }

    $plan = Invoke-Coordinator @{ Action = 'plan' }
    if ($plan.actions[0].action -ne 'ensure-canonical' -or $plan.actions[0].mutation -notmatch 'Apply') { throw 'Read-only plan did not require explicit ensure apply.' }

    $created = Invoke-Coordinator @{ Action = 'ensure-canonical'; SurfaceType = 'crm-module'; SurfaceId = 'users'; TargetCommit = $target; Apply = $true }
    if ($created.action -ne 'created' -or $created.targetCommit -ne $target) { throw 'Canonical slot was not created at the explicit target SHA.' }

    $ready = Invoke-Coordinator @{ Action = 'inventory' }
    if ($ready.surfaces[0].status -ne 'ready' -or $ready.presentCount -ne 1 -or -not $ready.surfaces[0].worktrees[0].detached) { throw 'Created canonical slot was not reported ready and detached.' }
    $canonicalPath = Join-Path $fixtureWorktrees 'admin\canonical\crm\users'

    $registryPath = Join-Path $fixtureRegistry 'canonical-registry.json'
    $registry = Get-Content -Raw -LiteralPath $registryPath | ConvertFrom-Json
    $registry.surfaces[0].targetCommit = ('0' * 40)
    $registry | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $registryPath -Encoding utf8
    $mismatch = Invoke-Coordinator @{ Action = 'inventory' }
    if ($mismatch.surfaces[0].status -ne 'registry_mismatch' -or -not $mismatch.surfaces[0].registryMismatch) { throw 'Registry/SHA mismatch was not reported.' }
    $repaired = Invoke-Coordinator @{ Action = 'ensure-canonical'; SurfaceType = 'crm-module'; SurfaceId = 'users'; TargetCommit = $target; Apply = $true }
    if ($repaired.action -ne 'reused') { throw 'Existing canonical slot was not safely reused after registry repair.' }

    Add-Content -LiteralPath (Join-Path $fixtureRepo 'README.md') -Value "requalified`n"
    Invoke-GitFixture @('-C', $fixtureRepo, 'add', 'README.md')
    Invoke-GitFixture @('-C', $fixtureRepo, 'commit', '--quiet', '-m', 'fixture requalification')
    $targetRefresh = (& git -C $fixtureRepo rev-parse HEAD).Trim()
    $refreshed = Invoke-Coordinator @{ Action = 'ensure-canonical'; SurfaceType = 'crm-module'; SurfaceId = 'users'; TargetCommit = $targetRefresh; Apply = $true; RefreshExisting = $true }
    if ($refreshed.action -ne 'refreshed' -or $refreshed.targetCommit -ne $targetRefresh -or $refreshed.baseCommit -ne $target) { throw 'Canonical slot was not requalified at the explicit routing SHA.' }
    $readyAfterRefresh = Invoke-Coordinator @{ Action = 'inventory' }
    if ($readyAfterRefresh.surfaces[0].worktrees[0].head -ne $targetRefresh) { throw 'Requalified canonical slot did not publish the new SHA.' }

    $claimed = Invoke-Coordinator @{ Action = 'claim'; SurfaceType = 'crm-module'; SurfaceId = 'users'; Owner = 'fixture-owner'; Apply = $true }
    if ($claimed.action -ne 'claimed' -or [string]::IsNullOrWhiteSpace($claimed.token)) { throw 'Canonical claim did not create a lease token.' }

    $secondClaimParameters = @{
        Action = 'claim'
        SurfaceType = 'crm-module'
        SurfaceId = 'users'
        Owner = 'other-owner'
        Apply = $true
        ProjectRoot = $fixtureRepo
        WorktreeRoot = $fixtureWorktrees
        TopologyPath = $fixtureTopology
        RuntimeRegistryRoot = $fixtureRegistry
        SkipGitHub = $true
    }
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $secondClaimExitCode = 0
    $secondClaim = @()
    try {
        $secondClaim = @(& $coordinator @secondClaimParameters 2>&1)
        $secondClaimExitCode = $LASTEXITCODE
    }
    catch {
        $secondClaimExitCode = 1
        $secondClaim += [string]$_.Exception.Message
    }
    $ErrorActionPreference = $oldPreference
    if ($secondClaimExitCode -eq 0 -or (($secondClaim -join ' ') -notmatch 'já possui lease|lease')) { throw 'Duplicate canonical claim was not rejected.' }

    $released = Invoke-Coordinator @{ Action = 'release'; SurfaceType = 'crm-module'; SurfaceId = 'users'; Owner = 'fixture-owner'; LeaseToken = $claimed.token; Apply = $true }
    if ($released.action -ne 'released') { throw 'Canonical release did not remove the lease.' }

    Add-Content -LiteralPath (Join-Path $canonicalPath 'README.md') -Value "dirty`n"
    $dirty = Invoke-Coordinator @{ Action = 'inventory' }
    if ($dirty.surfaces[0].status -ne 'blocked_dirty') { throw 'Dirty canonical slot was not preserved as blocked.' }

    Write-Output 'Canonical worktree topology fixture tests: PASS'
}
finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
