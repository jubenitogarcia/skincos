param(
    [string]$ProjectRoot,
    [string]$TaskBrief,
    [ValidateSet('edit', 'preview', 'qualify')]
    [string]$Intent = 'edit',
    [ValidateSet('crm-module', 'orb-workflow-family')]
    [string]$SurfaceType,
    [string]$SurfaceId,
    [string]$TaskSlug,
    [string]$WorktreeRoot = 'C:\CodexShared\Worktrees\skincos',
    [string]$CodexManagedWorktreeRoot = 'C:\CodexShared\Worktrees\skincos\admin\managed',
    [string]$RuntimeRegistryRoot = 'C:\CodexRuntime\operator\admin\skincos\worktree-registry',
    [string]$TopologyPath,
    [string]$RoutingStateScript,
    [string]$Repository = 'jubenitogarcia/skincos',
    [switch]$SkipGitHub,
    [switch]$SkipProcessScan,
    [switch]$NativeProjectRegistered,
    [switch]$Interactive
)

$ErrorActionPreference = 'Stop'

if ($Interactive) {
    if ([string]::IsNullOrWhiteSpace($TaskBrief)) {
        $TaskBrief = Read-Host 'Descreva a tarefa ou módulo'
    }
    $promptedIntent = Read-Host 'Intenção (edit, preview ou qualify) [edit]'
    if (-not [string]::IsNullOrWhiteSpace($promptedIntent)) {
        if ($promptedIntent -notin @('edit', 'preview', 'qualify')) {
            throw "Intenção inválida: '$promptedIntent'."
        }
        $Intent = $promptedIntent
    }
}

function Normalize-PathString {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ''
    }

    try {
        $fullPath = [System.IO.Path]::GetFullPath($Path)
    }
    catch {
        $fullPath = $Path
    }

    return $fullPath.Replace('/', '\').TrimEnd([char[]]'\').ToLowerInvariant()
}

function Normalize-SearchText {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ''
    }

    $withoutAccents = $Value.Normalize([System.Text.NormalizationForm]::FormD) -replace '\p{Mn}', ''
    return ($withoutAccents.ToLowerInvariant() -replace '[^a-z0-9]+', ' ').Trim()
}

function Get-ObjectArrayProperty {
    param(
        [object]$Object,
        [string]$Name
    )

    if ($null -eq $Object -or [string]::IsNullOrWhiteSpace($Name)) {
        return @()
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) {
        return @()
    }

    return @($property.Value)
}

function Test-TokenMatch {
    param(
        [string]$Text,
        [string]$Needle
    )

    $normalizedText = Normalize-SearchText -Value $Text
    $normalizedNeedle = Normalize-SearchText -Value $Needle
    if ([string]::IsNullOrWhiteSpace($normalizedText) -or [string]::IsNullOrWhiteSpace($normalizedNeedle)) {
        return $false
    }

    $escaped = [regex]::Escape($normalizedNeedle)
    return $normalizedText -match "(^|\s)$escaped(\s|$)"
}

function Test-PathEqual {
    param(
        [string]$Left,
        [string]$Right
    )

    return (Normalize-PathString -Path $Left) -eq (Normalize-PathString -Path $Right)
}

function Test-PathWithinRoot {
    param(
        [string]$Path,
        [string]$Root
    )

    $normalizedPath = Normalize-PathString -Path $Path
    $normalizedRoot = Normalize-PathString -Path $Root
    return $normalizedPath -eq $normalizedRoot -or $normalizedPath.StartsWith("$normalizedRoot\")
}

function Invoke-GitSafe {
    param(
        [string]$RepoPath,
        [string[]]$Arguments
    )

    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = @()
    $exitCode = 1
    try {
        $output = @(& git -C $RepoPath @Arguments 2>$null | ForEach-Object { [string]$_ })
        $exitCode = $LASTEXITCODE
    }
    catch {
        $output = @()
        $exitCode = 1
    }
    finally {
        $ErrorActionPreference = $oldPreference
    }

    return [pscustomobject]@{
        output = @($output)
        exitCode = $exitCode
    }
}

function Get-GitValue {
    param(
        [string]$RepoPath,
        [string[]]$Arguments
    )

    $result = Invoke-GitSafe -RepoPath $RepoPath -Arguments $Arguments
    if ($result.exitCode -ne 0) {
        return $null
    }
    return ($result.output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
}

function Resolve-RepositoryRoot {
    param([string]$RequestedPath)

    $candidate = $RequestedPath
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        $scriptRoot = $PSScriptRoot
        $candidate = Split-Path -Parent $scriptRoot
    }

    $resolved = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path
    $gitRoot = Get-GitValue -RepoPath $resolved -Arguments @('rev-parse', '--show-toplevel')
    if ([string]::IsNullOrWhiteSpace($gitRoot)) {
        throw "O caminho não é um worktree Git: '$resolved'."
    }

    return (Resolve-Path -LiteralPath $gitRoot.Trim() -ErrorAction Stop).Path
}

function Get-WorktreeRecords {
    param(
        [string]$RepoPath,
        [switch]$IncludeStatus
    )

    $result = Invoke-GitSafe -RepoPath $RepoPath -Arguments @('worktree', 'list', '--porcelain')
    if ($result.exitCode -ne 0) {
        throw 'Não foi possível listar os worktrees Git registrados.'
    }

    $records = @()
    $current = $null
    foreach ($line in @($result.output + '')) {
        if ($line -like 'worktree *') {
            if ($null -ne $current) {
                $records += [pscustomobject]$current
            }
            $current = [ordered]@{
                path = $line.Substring(9)
                head = $null
                branch = $null
                detached = $false
                locked = $false
                lockReason = $null
                prunable = $false
                prunableReason = $null
            }
            continue
        }

        if ($null -eq $current) {
            continue
        }

        if ($line -like 'HEAD *') {
            $current.head = $line.Substring(5)
        }
        elseif ($line -match '^branch refs/heads/(.*)$') {
            $current.branch = $Matches[1]
        }
        elseif ($line -eq 'detached') {
            $current.detached = $true
        }
        elseif ($line -eq 'locked') {
            $current.locked = $true
        }
        elseif ($line -like 'locked *') {
            $current.locked = $true
            $current.lockReason = $line.Substring(7)
        }
        elseif ($line -eq 'prunable') {
            $current.prunable = $true
        }
        elseif ($line -like 'prunable *') {
            $current.prunable = $true
            $current.prunableReason = $line.Substring(9)
        }
    }

    if ($null -ne $current) {
        $records += [pscustomobject]$current
    }

    foreach ($record in $records) {
        $record | Add-Member -NotePropertyName exists -NotePropertyValue (Test-Path -LiteralPath $record.path -PathType Container)
        $dirtyCount = $null
        $dirtySample = @()
        if ($IncludeStatus -and $record.exists) {
            $statusResult = Invoke-GitSafe -RepoPath $record.path -Arguments @('status', '--porcelain=v1')
            $status = @($statusResult.output)
            $dirtyCount = @($status | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
            $dirtySample = @($status | Select-Object -First 10)
        }
        $record | Add-Member -NotePropertyName dirtyCount -NotePropertyValue $dirtyCount
        $record | Add-Member -NotePropertyName dirtySample -NotePropertyValue $dirtySample
    }

    return @($records)
}

function Get-WorktreeStatus {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
        return [pscustomobject]@{ dirtyCount = $null; dirtySample = @(); status = 'missing' }
    }

    $statusResult = Invoke-GitSafe -RepoPath $Path -Arguments @('status', '--porcelain=v1')
    $status = @($statusResult.output)
    return [pscustomobject]@{
        dirtyCount = @($status | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
        dirtySample = @($status | Select-Object -First 10)
        status = 'checked'
    }
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

function Invoke-RoutingState {
    param(
        [Parameter(Mandatory = $true)][string]$StateAction,
        [hashtable]$Arguments = @{}
    )

    if ([string]::IsNullOrWhiteSpace($RoutingStateScript) -or -not (Test-Path -LiteralPath $RoutingStateScript -PathType Leaf)) {
        return [pscustomobject]@{ state = 'missing'; reasonCodes = @('routing_state_script_missing'); record = $null; binding = $null }
    }

    $invocation = @{
        Action = $StateAction
        RuntimeRegistryRoot = $RuntimeRegistryRoot
        CodexManagedWorktreeRoot = $CodexManagedWorktreeRoot
    }
    foreach ($entry in $Arguments.GetEnumerator()) {
        if ($null -eq $entry.Value -or [string]::IsNullOrWhiteSpace([string]$entry.Value)) {
            continue
        }
        $invocation[$entry.Key] = $entry.Value
    }

    try {
        $raw = @(& $RoutingStateScript @invocation 2>$null | ForEach-Object { [string]$_ })
        if ($LASTEXITCODE -ne 0 -or $raw.Count -eq 0) {
            return [pscustomobject]@{ state = 'blocked'; reasonCodes = @('routing_state_lookup_failed'); record = $null; binding = $null }
        }
        return (($raw -join "`n") | ConvertFrom-Json)
    }
    catch {
        return [pscustomobject]@{ state = 'blocked'; reasonCodes = @('routing_state_lookup_failed'); record = $null; binding = $null }
    }
}

function Test-GitCommitAncestor {
    param(
        [string]$RepoPath,
        [string]$Ancestor,
        [string]$Descendant
    )

    if ([string]::IsNullOrWhiteSpace($Ancestor) -or [string]::IsNullOrWhiteSpace($Descendant)) {
        return $false
    }
    $result = Invoke-GitSafe -RepoPath $RepoPath -Arguments @('merge-base', '--is-ancestor', $Ancestor, $Descendant)
    return $result.exitCode -eq 0
}

function Get-TopologyDefinitions {
    param(
        [object]$Topology,
        [string]$Root
    )

    if ($null -eq $Topology -or [int]$Topology.schemaVersion -ne 1 -or [string]$Topology.topologyId -ne 'skincos-canonical-worktrees') {
        throw 'A topologia de worktrees está ausente ou incompatível.'
    }

    $canonicalRoot = Join-Path $WorktreeRoot ([string]$Topology.worktree.canonicalRelativeRoot)
    $definitions = @()
    foreach ($surface in @($Topology.crm.surfaces)) {
        $id = [string]$surface.id
        $definitions += [pscustomobject]@{
            surfaceType = 'crm-module'
            surfaceId = $id
            label = [string]$surface.label
            route = [string]$surface.route
            source = [string]$surface.source
            workflowIds = @()
            expectedPath = Join-Path (Join-Path $canonicalRoot 'crm') $id
        }
    }
    foreach ($family in @($Topology.orb.families)) {
        $id = [string]$family.id
        $definitions += [pscustomobject]@{
            surfaceType = 'orb-workflow-family'
            surfaceId = $id
            label = [string]$family.label
            route = $null
            source = 'workflow-family'
            workflowIds = @(Get-ObjectArrayProperty -Object $family -Name 'mainWorkflowIds') +
                @(Get-ObjectArrayProperty -Object $family -Name 'subworkflowIds') +
                @(Get-ObjectArrayProperty -Object $family -Name 'relatedWorkflowIds')
            expectedPath = Join-Path (Join-Path $canonicalRoot 'orb') $id
        }
    }
    return @($definitions)
}

function Resolve-Surface {
    param(
        [object[]]$Definitions,
        [string]$RequestedType,
        [string]$RequestedId,
        [string]$Brief,
        [string]$CurrentPath
    )

    if (-not [string]::IsNullOrWhiteSpace($RequestedType) -or -not [string]::IsNullOrWhiteSpace($RequestedId)) {
        if ([string]::IsNullOrWhiteSpace($RequestedType) -or [string]::IsNullOrWhiteSpace($RequestedId)) {
            return [pscustomobject]@{ state = 'ambiguous'; reasonCodes = @('surface_type_and_id_must_be_provided_together'); candidates = @() }
        }
        $explicit = @($Definitions | Where-Object { $_.surfaceType -eq $RequestedType -and $_.surfaceId -eq $RequestedId })
        if ($explicit.Count -ne 1) {
            return [pscustomobject]@{ state = 'ambiguous'; reasonCodes = @('surface_not_found'); candidates = @() }
        }
        return [pscustomobject]@{ state = 'resolved'; definition = $explicit[0]; reasonCodes = @('surface_explicit'); candidates = @($explicit[0].surfaceId) }
    }

    $currentDefinition = @($Definitions | Where-Object { Test-PathEqual -Left $_.expectedPath -Right $CurrentPath })
    $normalizedBrief = Normalize-SearchText -Value "$Brief $TaskSlug"
    $matches = @()
    foreach ($definition in $Definitions) {
        $signals = @($definition.surfaceId, $definition.label, $definition.route) + @($definition.workflowIds)
        $matched = $false
        foreach ($signal in $signals) {
            if (Test-TokenMatch -Text $normalizedBrief -Needle ([string]$signal)) {
                $matched = $true
                break
            }
        }
        if ($matched) {
            $matches += $definition
        }
    }

    if ($matches.Count -eq 0 -and $currentDefinition.Count -eq 1 -and [string]::IsNullOrWhiteSpace($Brief)) {
        return [pscustomobject]@{ state = 'resolved'; definition = $currentDefinition[0]; reasonCodes = @('surface_from_current_canonical_path'); candidates = @($currentDefinition[0].surfaceId) }
    }
    if ($matches.Count -eq 1) {
        return [pscustomobject]@{ state = 'resolved'; definition = $matches[0]; reasonCodes = @('surface_from_task_brief'); candidates = @($matches[0].surfaceId) }
    }
    if ($matches.Count -gt 1) {
        return [pscustomobject]@{ state = 'ambiguous'; reasonCodes = @('multiple_surfaces_match_task_brief'); candidates = @($matches | ForEach-Object { $_.surfaceId }) }
    }
    return [pscustomobject]@{ state = 'ambiguous'; reasonCodes = @('task_brief_required_to_resolve_surface'); candidates = @() }
}

function Get-RegistryState {
    $path = Join-Path $RuntimeRegistryRoot 'canonical-registry.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return [pscustomobject]@{ status = 'missing'; path = $path; surfaces = @() }
    }
    $value = Read-JsonOrNull -Path $path
    if ($null -eq $value -or [int]$value.schemaVersion -ne 1) {
        return [pscustomobject]@{ status = 'invalid'; path = $path; surfaces = @() }
    }
    return [pscustomobject]@{ status = 'ok'; path = $path; surfaces = @($value.surfaces) }
}

function Get-LeaseState {
    param(
        [string]$RequestedType,
        [string]$RequestedId
    )

    $leasePath = Join-Path $RuntimeRegistryRoot (Join-Path 'leases' "$RequestedType--$RequestedId")
    $ownerPath = Join-Path $leasePath 'owner.json'
    if (-not (Test-Path -LiteralPath $ownerPath -PathType Leaf)) {
        return [pscustomobject]@{ status = 'free'; path = $leasePath; owner = $null }
    }
    $owner = Read-JsonOrNull -Path $ownerPath
    return [pscustomobject]@{ status = 'claimed'; path = $leasePath; owner = $owner }
}

function Get-ManifestReferences {
    $manifestRoot = [System.IO.Path]::GetFullPath((Join-Path $RuntimeRegistryRoot '..\runtime\crm-local'))
    if (-not (Test-Path -LiteralPath $manifestRoot -PathType Container)) {
        return @()
    }

    $references = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $manifestRoot -Filter 'current.json' -File -Recurse -Force -ErrorAction SilentlyContinue)) {
        $manifest = Read-JsonOrNull -Path $file.FullName
        if ($null -eq $manifest) { continue }
        foreach ($propertyName in @('worktree', 'sourceOrigin')) {
            if ($null -eq $manifest.PSObject.Properties[$propertyName]) { continue }
            $value = [string]$manifest.$propertyName
            if ([string]::IsNullOrWhiteSpace($value)) { continue }
            $references += [pscustomobject]@{ manifestPath = $file.FullName; property = $propertyName; value = $value }
        }
    }
    return @($references)
}

function Get-ProcessReference {
    param([string]$Path)

    if ($SkipProcessScan -or [string]::IsNullOrWhiteSpace($Path)) {
        return [pscustomobject]@{ status = 'skipped'; active = $false; count = 0; pids = @() }
    }

    try {
        $normalized = Normalize-PathString -Path $Path
        $slashVariant = $normalized.Replace('\', '/')
        $processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
        $hits = @($processes | Where-Object {
            $command = ([string]$_.CommandLine).ToLowerInvariant().Replace('/', '\')
            $executable = ([string]$_.ExecutablePath).ToLowerInvariant().Replace('/', '\')
            $command.Contains($normalized) -or $executable.Contains($normalized) -or
                ([string]$_.CommandLine).ToLowerInvariant().Contains($slashVariant) -or
                ([string]$_.ExecutablePath).ToLowerInvariant().Contains($slashVariant)
        })
        return [pscustomobject]@{
            status = 'checked'
            active = $hits.Count -gt 0
            count = $hits.Count
            pids = @($hits | ForEach-Object { [int]$_.ProcessId })
        }
    }
    catch {
        return [pscustomobject]@{ status = 'unavailable'; active = $false; count = 0; pids = @() }
    }
}

function Get-PullRequestState {
    param([string]$Branch)

    if ([string]::IsNullOrWhiteSpace($Branch)) {
        return [pscustomobject]@{ status = 'not_applicable'; open = $false; prs = @() }
    }
    if ($SkipGitHub) {
        return [pscustomobject]@{ status = 'skipped'; open = $null; prs = @() }
    }
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if ($null -eq $gh) {
        return [pscustomobject]@{ status = 'gh_missing'; open = $null; prs = @() }
    }

    try {
        $raw = @(& $gh.Source pr list --repo $Repository --head $Branch --state open --json number,headRefName,url --limit 20 2>$null)
        if ($LASTEXITCODE -ne 0) {
            return [pscustomobject]@{ status = 'unavailable'; open = $null; prs = @() }
        }
        $json = ($raw -join "`n") | ConvertFrom-Json
        $prs = @($json)
        return [pscustomobject]@{ status = 'checked'; open = $prs.Count -gt 0; prs = $prs }
    }
    catch {
        return [pscustomobject]@{ status = 'unavailable'; open = $null; prs = @() }
    }
}

function Get-IdentitySurfaceIds {
    param(
        [object[]]$Definitions,
        [string]$Text
    )

    $normalized = Normalize-SearchText -Value $Text
    $ids = @()
    foreach ($definition in $Definitions) {
        $signals = @($definition.surfaceId, $definition.label) + @($definition.workflowIds)
        foreach ($signal in $signals) {
            if (Test-TokenMatch -Text $normalized -Needle ([string]$signal)) {
                $ids += [string]$definition.surfaceId
                break
            }
        }
    }
    return @($ids | Select-Object -Unique)
}

function Get-WorktreeTaskSlug {
    param(
        [string]$Path,
        [string]$Root
    )

    $normalizedPath = Normalize-PathString -Path $Path
    $normalizedRoot = Normalize-PathString -Path $Root
    if (-not $normalizedPath.StartsWith("$normalizedRoot\")) {
        return $null
    }
    $relative = $normalizedPath.Substring($normalizedRoot.Length).TrimStart([char[]]'\')
    $segments = @($relative.Split([char[]]'\', [StringSplitOptions]::RemoveEmptyEntries))
    if ($segments.Count -ne 2 -or $segments[0].ToLowerInvariant() -ne 'admin') {
        return $null
    }
    return $segments[1]
}

function Get-CanonicalInfo {
    param(
        [object]$Definition,
        [object[]]$Worktrees,
        [object]$Registry,
        [object[]]$ManifestReferences
    )

    $record = @($Worktrees | Where-Object { Test-PathEqual -Left $_.path -Right $Definition.expectedPath })
    $recordStatus = if ($record.Count -eq 1) { Get-WorktreeStatus -Path $record[0].path } else { [pscustomobject]@{ dirtyCount = $null; dirtySample = @(); status = 'missing' } }
    $registryRows = @($Registry.surfaces | Where-Object { $_.surfaceType -eq $Definition.surfaceType -and $_.surfaceId -eq $Definition.surfaceId })
    $lease = Get-LeaseState -RequestedType $Definition.surfaceType -RequestedId $Definition.surfaceId
    $manifestRows = @($ManifestReferences | Where-Object { Test-PathWithinRoot -Path $_.value -Root $Definition.expectedPath })
    $process = Get-ProcessReference -Path $Definition.expectedPath
    $registryMismatch = $false
    if ($record.Count -eq 1 -and $registryRows.Count -eq 1) {
        $target = ([string]$registryRows[0].targetCommit).ToLowerInvariant()
        $registryMismatch = (Normalize-PathString -Path ([string]$registryRows[0].path)) -ne (Normalize-PathString -Path $Definition.expectedPath) -or
            (-not [string]::IsNullOrWhiteSpace($target) -and $target -ne ([string]$record[0].head).ToLowerInvariant())
    }
    return [pscustomobject]@{
        expectedPath = $Definition.expectedPath
        record = if ($record.Count -eq 1) { $record[0] } else { $null }
        recordCount = $record.Count
        recordStatus = $recordStatus
        registryRows = @($registryRows)
        lease = $lease
        manifestReferences = @($manifestRows)
        process = $process
        registryMismatch = $registryMismatch
    }
}

function Get-MatchingTaskCandidates {
    param(
        [object[]]$Definitions,
        [object[]]$Worktrees,
        [object]$RequestedDefinition,
        [string]$Brief,
        [string]$RequestedTaskSlug,
        [object[]]$ManifestReferences
    )

    $taskSlugNeedle = Normalize-SearchText -Value $RequestedTaskSlug
    # A supplied task slug is the only safe identity for an automatic
    # handoff. Surface names alone are useful for review, not ownership.
    if ([string]::IsNullOrWhiteSpace($taskSlugNeedle)) {
        return @()
    }
    $needles = @($taskSlugNeedle)

    $candidates = @()
    foreach ($record in $Worktrees) {
        if (-not $record.exists) { continue }
        $pathTaskSlug = Get-WorktreeTaskSlug -Path $record.path -Root $WorktreeRoot
        if ([string]::IsNullOrWhiteSpace($pathTaskSlug)) { continue }
        $candidateSurfaceIds = @(Get-IdentitySurfaceIds -Definitions $Definitions -Text "$($record.path) $($record.branch)")
        if ($candidateSurfaceIds -notcontains $RequestedDefinition.surfaceId) { continue }
        $branchSegments = ([string]$record.branch).Split([char[]]'/', [StringSplitOptions]::RemoveEmptyEntries)
        $branchTaskSlug = if ($branchSegments.Count -gt 0) { Normalize-SearchText -Value $branchSegments[$branchSegments.Count - 1] } else { '' }
        $pathTaskSlugNeedle = Normalize-SearchText -Value $pathTaskSlug
        $matched = if ($pathTaskSlugNeedle -eq $taskSlugNeedle -or $branchTaskSlug -eq $taskSlugNeedle) {
            @($taskSlugNeedle)
        }
        else {
            @()
        }
        if ($matched.Count -eq 0) { continue }

        $recordStatus = Get-WorktreeStatus -Path $record.path
        $manifestRows = @($ManifestReferences | Where-Object { Test-PathEqual -Left $_.value -Right $record.path })
        $pr = Get-PullRequestState -Branch $record.branch
        $tracking = Get-GitValue -RepoPath $record.path -Arguments @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
        $process = Get-ProcessReference -Path $record.path
        $preservationReasons = @()
        if ($record.detached) { $preservationReasons += 'candidate_detached_preserved' }
        if ($record.locked) { $preservationReasons += 'candidate_locked_preserved' }
        if ($record.prunable) { $preservationReasons += 'candidate_prunable_preserved' }
        if ($recordStatus.dirtyCount -gt 0) { $preservationReasons += 'candidate_dirty_preserved' }
        if ($manifestRows.Count -gt 0) { $preservationReasons += 'candidate_manifest_reference_preserved' }
        if ($process.active) { $preservationReasons += 'candidate_active_process_preserved' }
        $candidates += [pscustomobject]@{
            path = $record.path
            head = $record.head
            branch = $record.branch
            tracking = $tracking
            dirtyCount = $recordStatus.dirtyCount
            detached = [bool]$record.detached
            locked = [bool]$record.locked
            prunable = [bool]$record.prunable
            matchingNeedles = @($matched)
            manifestReferences = @($manifestRows)
            openPullRequest = $pr
            process = $process
            preservationReasons = @($preservationReasons)
            eligible = ($preservationReasons.Count -eq 0)
        }
    }
    return @($candidates)
}

function Emit-Result {
    param([object]$Value)
    $Value | ConvertTo-Json -Depth 20
}

try {
    $root = Resolve-RepositoryRoot -RequestedPath $ProjectRoot
    if ([string]::IsNullOrWhiteSpace($RoutingStateScript)) {
        $RoutingStateScript = Join-Path $root 'scripts\codex-thread-routing-state.ps1'
    }
    if ([string]::IsNullOrWhiteSpace($TopologyPath)) {
        $TopologyPath = Join-Path $root 'ops\codex\worktree-topology.json'
    }
    if (-not (Test-Path -LiteralPath $TopologyPath -PathType Leaf)) {
        throw "Topologia não encontrada em '$TopologyPath'."
    }

    $topology = Read-JsonOrNull -Path $TopologyPath
    $definitions = @(Get-TopologyDefinitions -Topology $topology -Root $root)
    $worktrees = @(Get-WorktreeRecords -RepoPath $root)
    $registry = Get-RegistryState
    $manifestReferences = @(Get-ManifestReferences)
    $currentRecord = @($worktrees | Where-Object { Test-PathEqual -Left $_.path -Right $root })
    $currentSha = Get-GitValue -RepoPath $root -Arguments @('rev-parse', '--verify', 'HEAD^{commit}')
    $currentBranch = Get-GitValue -RepoPath $root -Arguments @('branch', '--show-current')
    $currentTracking = Get-GitValue -RepoPath $root -Arguments @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
    $currentDetached = $currentRecord.Count -eq 1 -and [bool]$currentRecord[0].detached
    $currentStatus = if ($currentRecord.Count -eq 1) { Get-WorktreeStatus -Path $root } else { [pscustomobject]@{ dirtyCount = $null; dirtySample = @(); status = 'missing' } }
    $currentDirtyCount = if ($null -ne $currentStatus.dirtyCount) { [int]$currentStatus.dirtyCount } else { 0 }
    $sharedRoot = if (Test-Path -LiteralPath 'C:\CodexShared\Projetos\skincos') { (Resolve-Path -LiteralPath 'C:\CodexShared\Projetos\skincos').Path } else { $null }
    $currentIsShared = $null -ne $sharedRoot -and (Test-PathEqual -Left $root -Right $sharedRoot)
    $currentUnderManagedWorktreeRoot = Test-PathWithinRoot -Path $root -Root $CodexManagedWorktreeRoot
    $currentBinding = if ($currentUnderManagedWorktreeRoot) {
        Invoke-RoutingState -StateAction 'get-binding' -Arguments @{ Checkout = $root }
    }
    else {
        [pscustomobject]@{ state = 'not_applicable'; reasonCodes = @(); binding = $null }
    }

    $surfaceResults = @(Resolve-Surface -Definitions $definitions -RequestedType $SurfaceType -RequestedId $SurfaceId -Brief $TaskBrief -CurrentPath $root)
    $surface = @($surfaceResults | Where-Object { $null -ne $_ -and $null -ne $_.PSObject.Properties['state'] } | Select-Object -Last 1)
    if ($surface.Count -ne 1) {
        throw 'A resolução da superfície retornou um contrato incompatível.'
    }
    $surface = $surface[0]
    $definition = if ($null -ne $surface.PSObject.Properties['definition']) { $surface.definition } else { $null }
    $surfaceIdResult = if ($null -ne $definition) { [string]$definition.surfaceId } else { $null }
    $surfaceTypeResult = if ($null -ne $definition) { [string]$definition.surfaceType } else { $null }
    $baseResult = [ordered]@{
        schemaVersion = 1
        generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        state = 'ambiguous'
        intent = $Intent
        surfaceType = $surfaceTypeResult
        surfaceId = $surfaceIdResult
        currentCheckout = $root
        currentSha = $currentSha
        currentBranch = $currentBranch
        currentTracking = $currentTracking
        currentTaskSlug = Get-WorktreeTaskSlug -Path $root -Root $WorktreeRoot
        currentRegistered = ($currentRecord.Count -eq 1)
        currentUnderWorktreeRoot = (Test-PathWithinRoot -Path $root -Root $WorktreeRoot)
        currentUnderManagedWorktreeRoot = $currentUnderManagedWorktreeRoot
        currentDetached = $currentDetached
        currentDirtyCount = $currentDirtyCount
        currentBinding = $currentBinding.binding
        recommendedCheckout = $null
        candidateType = $null
        targetCommit = $null
        reasonCodes = @($surface.reasonCodes)
        nativeAction = 'none'
        currentThreadAction = 'none'
        nativeProjectRegistered = [bool]$NativeProjectRegistered
        nativeProjectRegistration = $null
        preservationReasons = @()
        candidates = @()
        canonical = $null
        currentPullRequest = $null
    }

    if ($null -eq $definition) {
        if ($currentIsShared) { $baseResult.preservationReasons += 'shared_clone_preserved_as_context' }
        Emit-Result -Value ([pscustomobject]$baseResult)
        exit 0
    }

    $currentPullRequest = Get-PullRequestState -Branch $currentBranch
    $baseResult.currentPullRequest = $currentPullRequest
    $canonical = Get-CanonicalInfo -Definition $definition -Worktrees $worktrees -Registry $registry -ManifestReferences $manifestReferences
    $nativeProjectRegistration = Invoke-RoutingState -StateAction 'get-native-project-registration' -Arguments @{ NativeProjectPath = $canonical.expectedPath }
    $nativeProjectRegistered = [bool]$NativeProjectRegistered -or $nativeProjectRegistration.state -eq 'ready'
    $baseResult.nativeProjectRegistered = $nativeProjectRegistered
    $baseResult.nativeProjectRegistration = [pscustomobject]@{
        state = [string]$nativeProjectRegistration.state
        reasonCodes = @($nativeProjectRegistration.reasonCodes)
        checkout = if ($null -ne $nativeProjectRegistration.record) { [string]$nativeProjectRegistration.record.checkout } else { $null }
    }
    $baseResult.canonical = [pscustomobject]@{
        expectedPath = $canonical.expectedPath
        recordCount = $canonical.recordCount
        registered = ($canonical.registryRows.Count -eq 1)
        registryMismatch = [bool]$canonical.registryMismatch
        dirtyCount = if ($null -ne $canonical.record) { [int]$canonical.recordStatus.dirtyCount } else { $null }
        detached = if ($null -ne $canonical.record) { [bool]$canonical.record.detached } else { $null }
        lease = $canonical.lease
        manifestReferenceCount = $canonical.manifestReferences.Count
        process = $canonical.process
    }

    $canonicalUsable = $canonical.recordCount -eq 1 -and $canonical.registryRows.Count -eq 1 -and
        -not $canonical.registryMismatch -and $canonical.record.exists -and $canonical.recordStatus.dirtyCount -eq 0 -and
        $canonical.lease.status -ne 'claimed' -and -not $canonical.process.active
    if ($canonical.recordCount -eq 0) { $baseResult.preservationReasons += 'canonical_slot_missing' }
    if ($canonical.recordCount -gt 1) { $baseResult.preservationReasons += 'canonical_slot_duplicate' }
    if ($canonical.recordCount -eq 1 -and $canonical.recordStatus.dirtyCount -gt 0) { $baseResult.preservationReasons += 'canonical_dirty_preserved' }
    if ($canonical.registryRows.Count -eq 0) { $baseResult.preservationReasons += 'canonical_registry_missing' }
    if ($canonical.registryMismatch) { $baseResult.preservationReasons += 'canonical_registry_mismatch' }
    if ($canonical.lease.status -eq 'claimed') { $baseResult.preservationReasons += 'canonical_active_lease_preserved' }
    if ($canonical.manifestReferences.Count -gt 0) { $baseResult.preservationReasons += 'canonical_manifest_reference_preserved' }
    if ($canonical.process.active) { $baseResult.preservationReasons += 'canonical_active_process_preserved' }
    if ($currentIsShared) { $baseResult.preservationReasons += 'shared_clone_preserved_as_context' }
    if ($currentDirtyCount -gt 0) { $baseResult.preservationReasons += 'current_dirty_changes_preserved' }
    if ($currentDetached -and -not (Test-PathEqual -Left $root -Right $definition.expectedPath) -and -not $currentUnderManagedWorktreeRoot) { $baseResult.preservationReasons += 'current_detached_fixture_preserved' }
    if ($currentPullRequest.open -eq $true) { $baseResult.preservationReasons += 'current_open_pr_preserved' }

    if ($Intent -eq 'edit') {
        if ($currentUnderManagedWorktreeRoot) {
            $binding = $currentBinding.binding
            $bindingSurfaceMatches = $null -ne $binding -and
                [string]$binding.surfaceType -eq $definition.surfaceType -and
                [string]$binding.surfaceId -eq $definition.surfaceId -and
                [string]$binding.intent -eq 'edit'
            $bindingLineageMatches = $bindingSurfaceMatches -and
                (Test-GitCommitAncestor -RepoPath $root -Ancestor ([string]$binding.targetCommit) -Descendant $currentSha)
            $managedCurrentReady = $currentRecord.Count -eq 1 -and -not $currentIsShared -and $currentDetached -and
                $currentBinding.state -eq 'ready' -and $bindingSurfaceMatches -and $bindingLineageMatches
            if ($managedCurrentReady) {
                $baseResult.state = 'ready'
                $baseResult.recommendedCheckout = $root
                $baseResult.candidateType = 'codex-managed'
                $baseResult.targetCommit = $currentSha
                $baseResult.nativeAction = 'none'
                $baseResult.currentThreadAction = 'none'
                $baseResult.reasonCodes += 'current_bound_managed_worktree_ready'
                Emit-Result -Value ([pscustomobject]$baseResult)
                exit 0
            }

            $baseResult.state = 'blocked'
            $baseResult.candidateType = 'codex-managed'
            $baseResult.reasonCodes += 'current_managed_worktree_binding_required'
            if ($currentBinding.state -ne 'ready') { $baseResult.reasonCodes += 'current_managed_worktree_binding_missing_or_invalid' }
            if ($null -ne $binding -and -not $bindingSurfaceMatches) { $baseResult.reasonCodes += 'current_managed_worktree_surface_mismatch' }
            if ($null -ne $binding -and -not $bindingLineageMatches) { $baseResult.reasonCodes += 'current_managed_worktree_target_lineage_mismatch' }
            $baseResult.preservationReasons += 'current_managed_worktree_preserved'
            Emit-Result -Value ([pscustomobject]$baseResult)
            exit 0
        }

        $currentIdentitySurfaces = @(Get-IdentitySurfaceIds -Definitions $definitions -Text "$root $currentBranch")
        $currentSurfaceMatches = $currentIdentitySurfaces -contains $definition.surfaceId
        $currentTaskSlug = Get-WorktreeTaskSlug -Path $root -Root $WorktreeRoot
        $taskIdentityMatches = -not [string]::IsNullOrWhiteSpace($currentTaskSlug) -and
            ([string]::IsNullOrWhiteSpace($TaskSlug) -or
                (Normalize-SearchText -Value $currentTaskSlug) -eq (Normalize-SearchText -Value $TaskSlug))
        if (-not $baseResult.currentUnderWorktreeRoot) { $baseResult.reasonCodes += 'current_checkout_outside_operator_worktree_root' }
        if ([string]::IsNullOrWhiteSpace($currentTaskSlug)) { $baseResult.reasonCodes += 'current_checkout_has_no_task_worktree_identity' }
        if (-not $currentSurfaceMatches) { $baseResult.reasonCodes += 'current_checkout_surface_identity_missing_or_mismatched' }
        if (-not $taskIdentityMatches) { $baseResult.reasonCodes += 'current_task_identity_mismatch' }
        $currentPrivateRegistered = $currentRecord.Count -eq 1 -and $baseResult.currentUnderWorktreeRoot -and -not $currentIsShared -and -not $currentDetached -and $currentSurfaceMatches -and $taskIdentityMatches
        if ($currentPrivateRegistered) {
            $baseResult.state = 'ready'
            $baseResult.recommendedCheckout = $root
            $baseResult.candidateType = 'temporary'
            $baseResult.targetCommit = $currentSha
            $baseResult.nativeAction = 'none'
            $baseResult.currentThreadAction = 'none'
            $baseResult.reasonCodes += 'current_registered_task_worktree'
            Emit-Result -Value ([pscustomobject]$baseResult)
            exit 0
        }

        $taskCandidates = @(Get-MatchingTaskCandidates -Definitions $definitions -Worktrees $worktrees -RequestedDefinition $definition -Brief $TaskBrief -RequestedTaskSlug $TaskSlug -ManifestReferences $manifestReferences)
        $baseResult.candidates = @($taskCandidates)
        $eligibleCandidates = @($taskCandidates | Where-Object { $_.eligible -and -not (Test-PathEqual -Left $_.path -Right $root) })
        if ($eligibleCandidates.Count -eq 1) {
            $candidate = $eligibleCandidates[0]
            $baseResult.state = 'replace'
            $baseResult.recommendedCheckout = $candidate.path
            $baseResult.candidateType = 'temporary'
            $baseResult.targetCommit = $candidate.head
            $baseResult.nativeAction = 'handoff_thread'
            $baseResult.currentThreadAction = 'handoff_other_thread'
            $baseResult.reasonCodes += 'matching_task_worktree_requires_verified_other_thread'
            Emit-Result -Value ([pscustomobject]$baseResult)
            exit 0
        }
        if ($eligibleCandidates.Count -gt 1) {
            $baseResult.state = 'ambiguous'
            $baseResult.reasonCodes += 'multiple_matching_task_worktrees'
            Emit-Result -Value ([pscustomobject]$baseResult)
            exit 0
        }

        $baseCommit = Get-GitValue -RepoPath $root -Arguments @('rev-parse', '--verify', 'origin/main^{commit}')
        if ([string]::IsNullOrWhiteSpace($baseCommit)) {
            $baseResult.state = 'blocked'
            $baseResult.reasonCodes += 'origin_main_unavailable_for_codex_worktree'
            Emit-Result -Value ([pscustomobject]$baseResult)
            exit 0
        }
        $baseResult.state = 'replace'
        $baseResult.candidateType = 'codex-managed'
        $baseResult.targetCommit = $baseCommit
        $baseResult.nativeAction = 'create_thread'
        $baseResult.currentThreadAction = 'create_replacement_thread'
        $baseResult.reasonCodes += 'current_checkout_not_eligible_for_edit'
        Emit-Result -Value ([pscustomobject]$baseResult)
        exit 0
    }

    if (-not $canonicalUsable) {
        $protectedCanonical = $canonical.recordCount -gt 1 -or
            ($canonical.recordCount -eq 1 -and $canonical.recordStatus.dirtyCount -gt 0) -or
            $canonical.registryMismatch -or
            $canonical.lease.status -eq 'claimed' -or
            $canonical.process.active
        $baseResult.state = if ($protectedCanonical) { 'blocked' } else { 'manual_registration_required' }
        $baseResult.reasonCodes += 'canonical_surface_not_ready'
        $baseResult.nativeAction = 'manual_open_project'
        $baseResult.currentThreadAction = 'manual_registration_required'
        Emit-Result -Value ([pscustomobject]$baseResult)
        exit 0
    }

    if (-not $nativeProjectRegistered) {
        $baseResult.state = 'manual_registration_required'
        $baseResult.recommendedCheckout = $canonical.expectedPath
        $baseResult.candidateType = 'canonical'
        $baseResult.targetCommit = $canonical.record.head
        $baseResult.nativeAction = 'manual_open_project'
        $baseResult.currentThreadAction = 'manual_registration_required'
        $baseResult.reasonCodes += 'canonical_project_not_registered_in_codex_app'
        Emit-Result -Value ([pscustomobject]$baseResult)
        exit 0
    }

    if (Test-PathEqual -Left $root -Right $canonical.expectedPath) {
        $baseResult.state = 'ready'
        $baseResult.recommendedCheckout = $root
        $baseResult.candidateType = 'canonical'
        $baseResult.targetCommit = $canonical.record.head
        $baseResult.nativeAction = 'none'
        $baseResult.currentThreadAction = 'none'
        $baseResult.reasonCodes += 'current_canonical_worktree_ready'
    }
    else {
        $baseResult.state = 'replace'
        $baseResult.recommendedCheckout = $canonical.expectedPath
        $baseResult.candidateType = 'canonical'
        $baseResult.targetCommit = $canonical.record.head
        $baseResult.nativeAction = 'handoff_thread'
        $baseResult.currentThreadAction = 'handoff_other_thread'
        $baseResult.reasonCodes += 'current_checkout_is_not_canonical_for_surface'
    }

    Emit-Result -Value ([pscustomobject]$baseResult)
    exit 0
}
catch {
    $fallback = [pscustomobject]@{
        schemaVersion = 1
        generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        state = 'blocked'
        intent = $Intent
        surfaceType = $SurfaceType
        surfaceId = $SurfaceId
        currentCheckout = $ProjectRoot
        currentSha = $null
        currentBranch = $null
        currentTracking = $null
        currentTaskSlug = $null
        currentRegistered = $false
        currentUnderWorktreeRoot = $false
        currentUnderManagedWorktreeRoot = $false
        currentDetached = $false
        currentDirtyCount = $null
        currentBinding = $null
        recommendedCheckout = $null
        candidateType = $null
        targetCommit = $null
        reasonCodes = @('resolver_error')
        nativeAction = 'none'
        currentThreadAction = 'none'
        nativeProjectRegistered = [bool]$NativeProjectRegistered
        nativeProjectRegistration = $null
        preservationReasons = @('fail_closed_after_resolver_error')
        candidates = @()
        canonical = $null
        currentPullRequest = $null
        errorType = $_.Exception.GetType().FullName
    }
    Emit-Result -Value $fallback
    exit 0
}
