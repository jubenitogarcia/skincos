$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script = Join-Path (Split-Path -Parent $PSScriptRoot) 'skincos-storage-governance.ps1'
$policy = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'ops\codex\storage-retention-policy.json'
$installer = Join-Path (Split-Path -Parent $PSScriptRoot) 'install-skincos-storage-governance-task.ps1'
$dedupe = Join-Path (Split-Path -Parent $PSScriptRoot) 'dedupe-source-tars.ps1'
$ciSmoke = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.github\workflows\ci-smoke.yml'
if (-not (Test-Path -LiteralPath $script)) { throw 'governance script missing' }
if (-not (Test-Path -LiteralPath $policy)) { throw 'governance policy missing' }
if (-not (Test-Path -LiteralPath $installer)) { throw 'governance task installer missing' }
if (-not (Test-Path -LiteralPath $dedupe)) { throw 'source archive dedupe script missing' }
if (-not (Test-Path -LiteralPath $ciSmoke)) { throw 'CI smoke workflow missing' }

$result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Mode audit -PolicyPath $policy
$document = ($result -join "`n") | ConvertFrom-Json
if ($document.schema_version -ne 1) { throw 'unexpected schema version' }
if ($document.drive.device -ne 'C:') { throw 'drive snapshot missing' }
if ($document.threshold_state -notin @('healthy','warning','high','critical','emergency')) { throw 'invalid threshold state' }
if ($document.limitations.Count -lt 3) { throw 'safety limitations missing' }
$policyDocument = Get-Content -LiteralPath $policy -Raw | ConvertFrom-Json
$requiredFocalRoots = @('native-source-release', 'livia-reel-frame-contract', 'mcp-readonly-gateway')
foreach ($root in $requiredFocalRoots) {
    if ($policyDocument.protectedArtifactDirectories -notcontains $root) { throw "focal artifact root missing from policy: $root" }
}
if ($policyDocument.protectedNamePatterns -notcontains '*.tar.gz') { throw 'compressed source archives must stay protected by policy' }
$taskPreview = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -RepositoryRoot (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) -ScriptPath $script | Out-String) | ConvertFrom-Json
if ($taskPreview.action -ne 'dry-run' -or $taskPreview.include_worktree_status) { throw 'scheduled audit must default to quick mode' }
if (-not $taskPreview.include_focal_artifacts -or $taskPreview.arguments -notmatch '-IncludeFocalArtifacts') { throw 'scheduled audit must include focal artifact scan' }
$ciSmokeText = Get-Content -LiteralPath $ciSmoke -Raw
foreach ($requiredContract in @('storage_governance: ${{ steps.scope.outputs.storage_governance }}', 'ops/codex/storage-retention-policy.json', 'Verify storage governance contracts', 'test-skincos-storage-governance.ps1')) {
    if (-not $ciSmokeText.Contains($requiredContract)) { throw "storage governance CI contract missing: $requiredContract" }
}
if ($ciSmokeText -match '(?m)^\s+- "ops/codex/\*\*"$') { throw 'storage governance policy must not be excluded from CI triggers' }

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("skincos-source-archive-test-" + [guid]::NewGuid().ToString('N'))
try {
    $fixtureRuntime = Join-Path $fixtureRoot 'runtime'
    $fixtureArtifacts = Join-Path $fixtureRuntime 'operator\admin\skincos\native-releases\fixture'
    New-Item -ItemType Directory -Force -Path $fixtureArtifacts | Out-Null
    $plainArchive = Join-Path $fixtureArtifacts 'source.tar'
    $compressedArchive = Join-Path $fixtureArtifacts 'source.tar.gz'
    [IO.File]::WriteAllBytes($plainArchive, [byte[]](1, 2, 3, 4))
    [IO.File]::WriteAllBytes($compressedArchive, [byte[]](1, 2, 3, 4))
    $oldEnough = [datetime]::UtcNow.AddDays(-2)
    [IO.File]::SetLastWriteTimeUtc($plainArchive, $oldEnough)
    [IO.File]::SetLastWriteTimeUtc($compressedArchive, $oldEnough)

    $fixturePolicy = Get-Content -LiteralPath $policy -Raw | ConvertFrom-Json
    $fixturePolicy.paths.projectRoot = $fixtureRoot
    $fixturePolicy.paths.worktreeRoot = Join-Path $fixtureRoot 'worktrees'
    $fixturePolicy.paths.runtimeRoot = $fixtureRuntime
    $fixturePolicy.paths.codexHome = Join-Path $fixtureRoot 'codex'
    $fixturePolicy.paths.privateStateRoot = Join-Path $fixtureRoot 'state'
    $fixturePolicyPath = Join-Path $fixtureRoot 'storage-policy.json'
    $fixtureOutput = Join-Path $fixtureRoot 'storage-report.json'
    $fixturePolicy | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $fixturePolicyPath -Encoding UTF8
    $fixtureResult = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Mode audit -PolicyPath $fixturePolicyPath -OutputPath $fixtureOutput -IncludeFocalArtifacts
    $fixtureDocument = ($fixtureResult -join "`n") | ConvertFrom-Json
    $fixtureNames = @($fixtureDocument.source_tars | ForEach-Object { [IO.Path]::GetFileName($_.path) })
    if ($fixtureNames -notcontains 'source.tar' -or $fixtureNames -notcontains 'source.tar.gz') { throw 'focal storage inventory must include plain and compressed source archives' }

    $dedupeOutput = Join-Path $fixtureRoot 'dedupe-report.json'
    $dedupeResult = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dedupe -RuntimeRoot $fixtureRuntime -StateRoot (Join-Path $fixtureRoot 'dedupe-state') -MinimumAgeDays 1 -IncludeInventory -OutputPath $dedupeOutput
    $dedupeDocument = ($dedupeResult -join "`n") | ConvertFrom-Json
    $dedupeNames = @($dedupeDocument.source_tars | ForEach-Object { [IO.Path]::GetFileName($_.path) })
    if (-not $dedupeDocument.source_tar_inventory_included -or $dedupeDocument.source_tar_count -ne 2 -or $dedupeDocument.duplicate_groups -ne 1 -or $dedupeNames -notcontains 'source.tar.gz') { throw 'source archive dedupe must include compressed archives in an explicit inventory' }
} finally {
    if (Test-Path -LiteralPath $fixtureRoot -PathType Container) {
        $resolvedFixtureRoot = [IO.Path]::GetFullPath($fixtureRoot)
        $resolvedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if (-not $resolvedFixtureRoot.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'refusing to remove fixture outside the temporary directory' }
        Remove-Item -LiteralPath $resolvedFixtureRoot -Recurse -Force
    }
}
Write-Output 'PASS: storage governance audit emits a versioned, fail-closed report.'
