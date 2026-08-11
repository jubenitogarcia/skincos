param(
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$WorktreeRoot = "C:\CodexShared\Worktrees\skincos",
    [string]$RuntimeRoot = "C:\CodexRuntime",
    [string]$OperatorRuntimeRoot = "C:\CodexRuntime\operator\admin\skincos",
    [string]$Repository = "jubenitogarcia/skincos",
    [string]$ReportPath,
    [string]$TopologyPath,
    [string[]]$ProtectedPath = @(),
    [switch]$SkipGitHub,
    [switch]$SkipHealth,
    [switch]$FailOnDrift
)

$ErrorActionPreference = "Stop"

function Normalize-PathString {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }

    try {
        $fullPath = [System.IO.Path]::GetFullPath($Path)
    }
    catch {
        $fullPath = $Path
    }

    return $fullPath.Replace('/', '\').TrimEnd([char[]]"\/").ToLowerInvariant()
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

function Convert-WslPathToWindows {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }

    if ($Path -match '^/mnt/(?<drive>[a-zA-Z])(?:/(?<rest>.*))?$') {
        $rest = [string]$Matches.rest
        if ([string]::IsNullOrWhiteSpace($rest)) {
            return "$($Matches.drive.ToUpperInvariant()):\"
        }
        return "$($Matches.drive.ToUpperInvariant()):\$($rest.Replace('/', '\'))"
    }

    return $Path
}

function Get-GitCommand {
    param(
        [string]$RepoPath,
        [string[]]$Arguments
    )

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = @()
    $exitCode = 1
    try {
        $output = @(& git -C $RepoPath @Arguments 2>&1 | ForEach-Object { [string]$_ })
        $exitCode = $LASTEXITCODE
    }
    catch {
        $output = @([string]$_.Exception.Message)
        $exitCode = 1
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }

    return [pscustomobject]@{
        output = @($output)
        exitCode = $exitCode
    }
}

function Get-GitOutput {
    param(
        [string]$RepoPath,
        [string[]]$Arguments
    )

    $result = Get-GitCommand -RepoPath $RepoPath -Arguments $Arguments
    return @($result.output)
}

function Get-DirectoryFootprint {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return [pscustomobject]@{
            path = $Path
            exists = $false
            scope = "top-level"
            items = 0
            directFiles = 0
            directBytes = 0
        }
    }

    $entries = @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue)
    $directFiles = @($entries | Where-Object { -not $_.PSIsContainer })
    $directBytes = ($directFiles | Measure-Object -Property Length -Sum).Sum

    return [pscustomobject]@{
        path = $Path
        exists = $true
        scope = "top-level"
        items = $entries.Count
        directFiles = $directFiles.Count
        directBytes = if ($null -eq $directBytes) { [int64]0 } else { [int64]$directBytes }
    }
}

function Get-WorktreeBlocks {
    param([string]$RepoPath)

    $lines = @(Get-GitOutput -RepoPath $RepoPath -Arguments @("worktree", "list", "--porcelain"))
    $records = @()
    $current = $null

    foreach ($line in @($lines + "")) {
        if ($line -like "worktree *") {
            if ($null -ne $current -and $current.Contains("path")) {
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

        if ($line -like "HEAD *") {
            $current.head = $line.Substring(5)
        }
        elseif ($line -match '^branch refs/heads/(.*)$') {
            $current.branch = $Matches[1]
        }
        elseif ($line -eq "detached") {
            $current.detached = $true
        }
        elseif ($line -eq "locked") {
            $current.locked = $true
        }
        elseif ($line -like "locked *") {
            $current.locked = $true
            $current.lockReason = $line.Substring(7)
        }
        elseif ($line -eq "prunable") {
            $current.prunable = $true
        }
        elseif ($line -like "prunable *") {
            $current.prunable = $true
            $current.prunableReason = $line.Substring(9)
        }
    }

    if ($null -ne $current -and $current.Contains("path")) {
        $records += [pscustomobject]$current
    }
    return @($records)
}

function Get-PullRequestIndex {
    param(
        [string]$RepositoryName,
        [switch]$Skip
    )

    if ($Skip) {
        return [pscustomobject]@{
            status = "skipped"
            repository = $RepositoryName
            pullRequests = @()
            byBranch = @{}
        }
    }

    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{
            status = "gh_missing"
            repository = $RepositoryName
            pullRequests = @()
            byBranch = @{}
        }
    }

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $raw = @()
    $exitCode = 1
    try {
        $raw = @(& gh api --paginate --slurp "repos/$RepositoryName/pulls?state=all&per_page=100" 2>&1 | ForEach-Object { [string]$_ })
        $exitCode = $LASTEXITCODE
    }
    catch {
        $raw = @([string]$_.Exception.Message)
        $exitCode = 1
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }

    if ($exitCode -ne 0) {
        return [pscustomobject]@{
            status = "gh_query_failed"
            repository = $RepositoryName
            error = (@($raw) -join "`n")
            pullRequests = @()
            byBranch = @{}
        }
    }

    try {
        $jsonText = @($raw) -join "`n"
        $pages = ConvertFrom-Json -InputObject $jsonText
    }
    catch {
        return [pscustomobject]@{
            status = "gh_response_invalid"
            repository = $RepositoryName
            error = $_.Exception.Message
            pullRequests = @()
            byBranch = @{}
        }
    }

    $pullRequests = @()
    $byBranch = @{}
    foreach ($page in $pages) {
        foreach ($pullRequest in $page) {
            $mergedAt = [string]$pullRequest.merged_at
            $state = if (-not [string]::IsNullOrWhiteSpace($mergedAt)) {
                "MERGED"
            }
            else {
                ([string]$pullRequest.state).ToUpperInvariant()
            }

            $record = [pscustomobject]@{
                number = [int]$pullRequest.number
                title = [string]$pullRequest.title
                state = $state
                isDraft = [bool]$pullRequest.draft
                headRefName = [string]$pullRequest.head.ref
                headSha = [string]$pullRequest.head.sha
                updatedAt = [string]$pullRequest.updated_at
                url = [string]$pullRequest.html_url
            }
            $pullRequests += $record
            if (-not [string]::IsNullOrWhiteSpace($record.headRefName)) {
                if (-not $byBranch.ContainsKey($record.headRefName)) {
                    $byBranch[$record.headRefName] = @()
                }
                $byBranch[$record.headRefName] += $record
            }
        }
    }

    return [pscustomobject]@{
        status = "ok"
        repository = $RepositoryName
        pullRequests = @($pullRequests)
        byBranch = $byBranch
    }
}

function Get-ManifestPids {
    param([object]$Manifest)

    $result = @()
    if ($null -eq $Manifest -or $null -eq $Manifest.PSObject.Properties["pids"] -or $null -eq $Manifest.pids) {
        return @()
    }

    foreach ($property in $Manifest.pids.PSObject.Properties) {
        $pidText = [string]$property.Value
        if ($pidText -notmatch '^[0-9]+$') {
            continue
        }

        $pidValue = [int]$pidText
        $windowsProcess = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
        $result += [pscustomobject]@{
            name = [string]$property.Name
            pid = $pidValue
            windowsProcessPresent = $null -ne $windowsProcess
        }
    }
    return @($result)
}

function Get-ManifestSourceRoots {
    param([object]$Manifest)

    $roots = @()
    foreach ($propertyName in @("worktree", "sourceOrigin")) {
        if ($null -eq $Manifest -or $null -eq $Manifest.PSObject.Properties[$propertyName]) {
            continue
        }
        $rawPath = Convert-WslPathToWindows -Path ([string]$Manifest.$propertyName)
        if ([string]::IsNullOrWhiteSpace($rawPath)) {
            continue
        }
        $roots += $rawPath

        $leaf = Split-Path -Leaf $rawPath
        if ($leaf -like "*__*") {
            $sourceKey = $leaf.Split("__")[0]
            $roots += Join-Path (Split-Path -Parent $rawPath) $sourceKey
        }
    }
    return @($roots | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
}

function Get-RuntimeManifestIndex {
    param([string]$RuntimePath)

    $manifestFiles = @()
    $patterns = @(
        (Join-Path $RuntimePath "current.json"),
        (Join-Path $RuntimePath "*\current.json"),
        (Join-Path $RuntimePath "*\*\current.json"),
        (Join-Path $RuntimePath "*\*\*\current.json"),
        (Join-Path $RuntimePath "*\*\*\*\current.json"),
        (Join-Path $RuntimePath "*\*\*\*\*\current.json")
    )
    foreach ($pattern in $patterns) {
        $manifestFiles += @(Get-ChildItem -Path $pattern -File -Force -ErrorAction SilentlyContinue)
    }
    $manifestFiles = @($manifestFiles | Sort-Object FullName -Unique)

    $manifests = @()
    $byPath = @{}
    foreach ($file in $manifestFiles) {
        try {
            $manifest = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
        }
        catch {
            continue
        }

        $roots = @(Get-ManifestSourceRoots -Manifest $manifest)
        $record = [pscustomobject]@{
            manifestPath = $file.FullName
            runtimeId = [string]$manifest.runtimeId
            state = [string]$manifest.state
            module = [string]$manifest.module
            persona = [string]$manifest.persona
            targetCommit = [string]$manifest.targetCommit
            worktree = Convert-WslPathToWindows -Path ([string]$manifest.worktree)
            sourceOrigin = Convert-WslPathToWindows -Path ([string]$manifest.sourceOrigin)
            sourceRoots = $roots
            pids = @(Get-ManifestPids -Manifest $manifest)
            updatedAt = [string]$manifest.updatedAt
        }
        $manifests += $record

        foreach ($root in $roots) {
            $key = Normalize-PathString -Path $root
            if (-not $byPath.ContainsKey($key)) {
                $byPath[$key] = @()
            }
            $byPath[$key] += $record
        }
    }

    return [pscustomobject]@{
        manifests = @($manifests)
        byPath = $byPath
    }
}

function Get-WorktreeCategory {
    param(
        [string]$Path,
        [string]$ProjectPath,
        [string]$SharedWorktreePath,
        [string]$RuntimePath,
        [string]$OperatorPath
    )

    if (Test-PathWithinRoot -Path $Path -Root $SharedWorktreePath) {
        return "manual-shared"
    }
    if ((Test-PathWithinRoot -Path $Path -Root $OperatorPath) -or (Test-PathWithinRoot -Path $Path -Root $RuntimePath)) {
        return "private-runtime"
    }
    if (Normalize-PathString -Path $Path -eq (Normalize-PathString -Path $ProjectPath)) {
        return "shared-clone"
    }
    return "other"
}

function Get-WorktreeRelation {
    param(
        [string]$RepoPath,
        [string]$Head,
        [string]$OriginMain
    )

    if ([string]::IsNullOrWhiteSpace($Head) -or [string]::IsNullOrWhiteSpace($OriginMain)) {
        return [pscustomobject]@{ relation = "unknown"; behind = $null; ahead = $null }
    }

    $countsResult = Get-GitCommand -RepoPath $RepoPath -Arguments @("rev-list", "--left-right", "--count", "origin/main...$Head")
    $countText = @($countsResult.output) -join " "
    $parts = @($countText -split '\s+' | Where-Object { $_ -match '^[0-9]+$' })
    if ($countsResult.exitCode -ne 0 -or $parts.Count -lt 2) {
        return [pscustomobject]@{ relation = "unknown"; behind = $null; ahead = $null }
    }

    $behind = [int]$parts[0]
    $ahead = [int]$parts[1]
    $relation = if ($ahead -eq 0) {
        "ancestor_or_same"
    }
    elseif ($behind -eq 0) {
        "ahead_only"
    }
    else {
        "diverged"
    }

    return [pscustomobject]@{
        relation = $relation
        behind = $behind
        ahead = $ahead
    }
}

function Get-WorktreeAudit {
    param(
        [string]$RepoPath,
        [string]$SharedWorktreePath,
        [string]$RuntimePath,
        [string]$OperatorPath,
        [string]$OriginMain,
        [object]$PullRequestIndex,
        [object]$ManifestIndex,
        [string[]]$ProtectedPaths
    )

    $normalizedProtectedPaths = @($ProtectedPaths | ForEach-Object { Normalize-PathString -Path $_ } | Where-Object { $_ })
    $records = @()
    foreach ($block in @(Get-WorktreeBlocks -RepoPath $RepoPath)) {
        $path = [string]$block.path
        $branch = [string]$block.branch
        $category = Get-WorktreeCategory -Path $path -ProjectPath $RepoPath -SharedWorktreePath $SharedWorktreePath -RuntimePath $RuntimePath -OperatorPath $OperatorPath
        $exists = Test-Path -LiteralPath $path
        $statusLines = if ($exists) { @(Get-GitOutput -RepoPath $path -Arguments @("status", "--porcelain=v1")) } else { @() }
        $dirtyCount = @($statusLines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
        $remoteRefExists = $false
        $pullRequests = @()

        if (-not [string]::IsNullOrWhiteSpace($branch)) {
            $remoteResult = Get-GitCommand -RepoPath $RepoPath -Arguments @("show-ref", "--verify", "--quiet", "refs/remotes/origin/$branch")
            $remoteRefExists = $remoteResult.exitCode -eq 0
            if ($PullRequestIndex.status -eq "ok" -and $PullRequestIndex.byBranch.ContainsKey($branch)) {
                $pullRequests = @($PullRequestIndex.byBranch[$branch])
            }
        }

        $openPullRequest = @($pullRequests | Where-Object { $_.state -eq "OPEN" }).Count -gt 0
        $prState = if ($PullRequestIndex.status -ne "ok") {
            "unverified"
        }
        elseif ($pullRequests.Count -eq 0) {
            "none"
        }
        elseif ($openPullRequest) {
            "open"
        }
        elseif (@($pullRequests | Where-Object { $_.state -eq "MERGED" }).Count -gt 0) {
            "merged"
        }
        else {
            "closed"
        }

        $relation = Get-WorktreeRelation -RepoPath $RepoPath -Head ([string]$block.head) -OriginMain $OriginMain
        $latestCommitAt = $null
        if (-not [string]::IsNullOrWhiteSpace([string]$block.head)) {
            $latestCommitAt = @(Get-GitOutput -RepoPath $RepoPath -Arguments @("show", "-s", "--format=%cI", [string]$block.head)) | Select-Object -First 1
        }

        $normalizedPath = Normalize-PathString -Path $path
        $manifestReferences = if ($ManifestIndex.byPath.ContainsKey($normalizedPath)) {
            @($ManifestIndex.byPath[$normalizedPath])
        }
        else {
            @()
        }
        $manifestReferenceCount = @($manifestReferences).Count
        $protected = $normalizedProtectedPaths -contains $normalizedPath

        $classification = "review_unproven"
        if ($protected) {
            $classification = "preserve_protected_path"
        }
        elseif ($dirtyCount -gt 0) {
            $classification = "preserve_dirty"
        }
        elseif ($manifestReferenceCount -gt 0) {
            $classification = "preserve_runtime_manifest_reference"
        }
        elseif ($category -eq "manual-shared") {
            if ([bool]$block.detached) {
                $classification = "preserve_detached"
            }
            elseif ($openPullRequest) {
                $classification = "preserve_open_pr"
            }
            elseif ($PullRequestIndex.status -ne "ok") {
                $classification = "review_pr_unverified"
            }
            elseif ($relation.relation -eq "ancestor_or_same" -and -not $remoteRefExists) {
                $classification = "review_clean_ancestor_no_remote_no_open_pr"
            }
            elseif ($relation.relation -eq "ancestor_or_same") {
                $classification = "review_clean_ancestor"
            }
            elseif ($relation.relation -eq "diverged") {
                $classification = "review_clean_diverged"
            }
        }
        elseif (Test-PathWithinRoot -Path $path -Root (Join-Path $OperatorPath "source\crm-local\immutable")) {
            if ($manifestReferenceCount -gt 0) {
                $classification = "preserve_runtime_manifest_reference"
            }
            else {
                $classification = "review_runtime_source_unreferenced"
            }
        }

        $records += [pscustomobject]@{
            path = $path
            category = $category
            exists = $exists
            head = [string]$block.head
            branch = if ([string]::IsNullOrWhiteSpace($branch)) { $null } else { $branch }
            detached = [bool]$block.detached
            locked = [bool]$block.locked
            lockReason = $block.lockReason
            prunable = [bool]$block.prunable
            prunableReason = $block.prunableReason
            dirtyCount = $dirtyCount
            dirtySample = @($statusLines | Select-Object -First 10)
            remoteRefExists = $remoteRefExists
            relation = $relation.relation
            behindOriginMain = $relation.behind
            aheadOfOriginMain = $relation.ahead
            latestCommitAt = [string]$latestCommitAt
            pullRequests = @($pullRequests)
            pullRequestState = $prState
            openPullRequest = $openPullRequest
            protected = $protected
            manifestReferences = @($manifestReferences | ForEach-Object { $_.runtimeId })
            manifestFiles = @($manifestReferences | ForEach-Object { $_.manifestPath })
            manifestProcesses = @($manifestReferences | ForEach-Object { $_.pids })
            classification = $classification
        }
    }
    return @($records)
}

function Get-TopologyDocument {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return [pscustomobject]@{ status = "not_configured"; path = $null; document = $null }
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{ status = "missing"; path = $Path; document = $null }
    }

    try {
        $document = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    }
    catch {
        return [pscustomobject]@{ status = "invalid"; path = $Path; document = $null; error = $_.Exception.Message }
    }

    if ([int]$document.schemaVersion -ne 1 -or [string]$document.topologyId -ne "skincos-canonical-worktrees") {
        return [pscustomobject]@{ status = "invalid"; path = $Path; document = $null; error = "unsupported_schema" }
    }
    $surfaceIds = @($document.crm.surfaces | ForEach-Object { [string]$_.id }) + @($document.orb.families | ForEach-Object { [string]$_.id })
    if (@($surfaceIds | Where-Object { $_ -notmatch '^[a-z0-9][a-z0-9-]*$' }).Count -gt 0) {
        return [pscustomobject]@{ status = "invalid"; path = $Path; document = $null; error = "invalid_surface_id" }
    }
    if (@($surfaceIds | Group-Object | Where-Object { $_.Count -gt 1 }).Count -gt 0) {
        return [pscustomobject]@{ status = "invalid"; path = $Path; document = $null; error = "duplicate_surface_id" }
    }
    return [pscustomobject]@{ status = "ok"; path = $Path; document = $document }
}

function Get-TopologySurfaceDefinitions {
    param(
        [object]$Topology,
        [string]$WorktreeRoot
    )

    if ($null -eq $Topology) {
        return @()
    }

    $definitions = @()
    foreach ($surface in @($Topology.crm.surfaces)) {
        $id = [string]$surface.id
        $definitions += [pscustomobject]@{
            surfaceType = "crm-module"
            surfaceId = $id
            label = [string]$surface.label
            pilot = @($Topology.crm.pilot) -contains $id
            expectedPath = Join-Path $WorktreeRoot (Join-Path ([string]$Topology.worktree.canonicalRelativeRoot) ("crm\$id"))
            workflowIds = @()
        }
    }
    foreach ($family in @($Topology.orb.families)) {
        $id = [string]$family.id
        $definitions += [pscustomobject]@{
            surfaceType = "orb-workflow-family"
            surfaceId = $id
            label = [string]$family.label
            pilot = @($Topology.orb.pilot) -contains $id
            expectedPath = Join-Path $WorktreeRoot (Join-Path ([string]$Topology.worktree.canonicalRelativeRoot) ("orb\$id"))
            workflowIds = @($family.mainWorkflowIds) + @($family.subworkflowIds) + @($family.relatedWorkflowIds)
        }
    }
    return @($definitions)
}

function Get-CanonicalRegistrySnapshot {
    param([string]$RegistryRoot)

    $path = Join-Path $RegistryRoot "canonical-registry.json"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return [pscustomobject]@{ status = "missing"; path = $path; surfaces = @() }
    }
    try {
        $value = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    }
    catch {
        return [pscustomobject]@{ status = "invalid"; path = $path; surfaces = @(); error = $_.Exception.Message }
    }
    if ($null -eq $value -or [int]$value.schemaVersion -ne 1) {
        return [pscustomobject]@{ status = "invalid"; path = $path; surfaces = @(); error = "unsupported_schema" }
    }
    return [pscustomobject]@{ status = "ok"; path = $path; surfaces = @($value.surfaces) }
}

function Get-CanonicalLeaseSnapshot {
    param(
        [string]$RegistryRoot,
        [string]$SurfaceType,
        [string]$SurfaceId
    )

    $leasePath = Join-Path $RegistryRoot (Join-Path "leases" "$SurfaceType--$SurfaceId")
    $ownerPath = Join-Path $leasePath "owner.json"
    if (-not (Test-Path -LiteralPath $ownerPath -PathType Leaf)) {
        return [pscustomobject]@{ status = "free"; path = $leasePath; owner = $null }
    }
    try {
        $owner = Get-Content -LiteralPath $ownerPath -Raw | ConvertFrom-Json
        return [pscustomobject]@{ status = "claimed"; path = $leasePath; owner = $owner }
    }
    catch {
        return [pscustomobject]@{ status = "invalid"; path = $leasePath; owner = $null; error = $_.Exception.Message }
    }
}

function Get-CanonicalTopologyAudit {
    param(
        [object]$TopologyState,
        [string]$WorktreeRoot,
        [string]$OperatorRuntimeRoot,
        [object[]]$Worktrees
    )

    if ($TopologyState.status -ne "ok") {
        return [pscustomobject]@{
            status = $TopologyState.status
            topologyPath = $TopologyState.path
            surfaceCount = 0
            presentCount = 0
            missingCount = 0
            duplicateCount = 0
            claimedCount = 0
            surfaces = @()
            unmappedCanonicalWorktrees = @()
            registry = Get-CanonicalRegistrySnapshot -RegistryRoot (Join-Path $OperatorRuntimeRoot "worktree-registry")
        }
    }

    $registry = Get-CanonicalRegistrySnapshot -RegistryRoot (Join-Path $OperatorRuntimeRoot "worktree-registry")
    $definitions = @(Get-TopologySurfaceDefinitions -Topology $TopologyState.document -WorktreeRoot $WorktreeRoot)
    $canonicalRows = @()
    foreach ($definition in $definitions) {
        $expected = Normalize-PathString -Path $definition.expectedPath
        $matches = @($Worktrees | Where-Object { (Normalize-PathString -Path $_.path) -eq $expected })
        $registryRows = @($registry.surfaces | Where-Object { $_.surfaceType -eq $definition.surfaceType -and $_.surfaceId -eq $definition.surfaceId })
        $lease = Get-CanonicalLeaseSnapshot -RegistryRoot (Join-Path $OperatorRuntimeRoot "worktree-registry") -SurfaceType $definition.surfaceType -SurfaceId $definition.surfaceId
        $registryMismatch = $false
        if ($matches.Count -eq 1 -and $registryRows.Count -eq 1) {
            $registryMismatch = (Normalize-PathString -Path ([string]$registryRows[0].path)) -ne $expected -or
                ([string]$registryRows[0].targetCommit).ToLowerInvariant() -ne ([string]$matches[0].head).ToLowerInvariant()
        }
        $status = "missing"
        if ($registry.status -eq "invalid") {
            $status = "invalid_registry"
        }
        elseif ($matches.Count -gt 1 -or $registryRows.Count -gt 1) {
            $status = "duplicate"
        }
        elseif ($matches.Count -eq 0 -and $registryRows.Count -gt 0) {
            $status = "registry_without_worktree"
        }
        elseif ($matches.Count -eq 1 -and $matches[0].dirtyCount -gt 0) {
            $status = "blocked_dirty"
        }
        elseif ($matches.Count -eq 1 -and $registryMismatch) {
            $status = "registry_mismatch"
        }
        elseif ($matches.Count -eq 1 -and $lease.status -eq "claimed") {
            $status = "claimed"
        }
        elseif ($matches.Count -eq 1 -and $registryRows.Count -eq 1) {
            $status = "ready"
        }
        elseif ($matches.Count -eq 1) {
            $status = "unregistered_worktree"
        }

        $canonicalRows += [pscustomobject]@{
            surfaceType = $definition.surfaceType
            surfaceId = $definition.surfaceId
            label = $definition.label
            pilot = [bool]$definition.pilot
            expectedPath = $definition.expectedPath
            status = $status
            worktreeCount = $matches.Count
            worktrees = @($matches | ForEach-Object {
                [pscustomobject]@{
                    path = $_.path
                    head = $_.head
                    branch = $_.branch
                    detached = [bool]$_.detached
                    dirtyCount = $_.dirtyCount
                    prunable = [bool]$_.prunable
                }
            })
            registryCount = $registryRows.Count
            registry = @($registryRows)
            registryMismatch = $registryMismatch
            lease = $lease
            manifestReferences = @($matches | ForEach-Object { $_.manifestReferences })
            manifestFiles = @($matches | ForEach-Object { $_.manifestFiles })
            manifestProcesses = @($matches | ForEach-Object { $_.manifestProcesses })
            preservationReason = if ($status -eq "missing") { "canonical_slot_missing" } elseif ($status -eq "duplicate") { "duplicate_slot" } elseif ($status -eq "registry_mismatch") { "registry_mismatch" } elseif ($status -eq "blocked_dirty") { "dirty" } elseif ($status -eq "claimed") { "active_lease" } elseif (@($matches | ForEach-Object { $_.manifestReferences } | Where-Object { $_ }).Count -gt 0) { "manifest_reference" } else { "ready" }
            workflowIds = @($definition.workflowIds)
        }
    }

    $canonicalRoot = Join-Path $WorktreeRoot ([string]$TopologyState.document.worktree.canonicalRelativeRoot)
    $expectedPaths = @($canonicalRows | ForEach-Object { Normalize-PathString -Path $_.expectedPath })
    $unmapped = @($Worktrees | Where-Object {
        $path = Normalize-PathString -Path $_.path
        (Test-PathWithinRoot -Path $_.path -Root $canonicalRoot) -and ($expectedPaths -notcontains $path)
    } | ForEach-Object {
        [pscustomobject]@{ path = $_.path; head = $_.head; branch = $_.branch; dirtyCount = $_.dirtyCount }
    })

    $driftStatuses = @("invalid_registry", "duplicate", "registry_without_worktree", "registry_mismatch")
    return [pscustomobject]@{
        status = if (@($canonicalRows | Where-Object { $driftStatuses -contains $_.status }).Count -gt 0) { "drift" } else { "ok" }
        topologyPath = $TopologyState.path
        canonicalRoot = $canonicalRoot
        surfaceCount = $canonicalRows.Count
        presentCount = @($canonicalRows | Where-Object { $_.worktreeCount -eq 1 }).Count
        missingCount = @($canonicalRows | Where-Object { $_.status -eq "missing" }).Count
        duplicateCount = @($canonicalRows | Where-Object { $_.status -eq "duplicate" }).Count
        claimedCount = @($canonicalRows | Where-Object { $_.status -eq "claimed" }).Count
        pilot = @($canonicalRows | Where-Object { $_.pilot })
        surfaces = @($canonicalRows)
        unmappedCanonicalWorktrees = $unmapped
        registry = $registry
    }
}

function Get-Health {
    param([string]$Url)

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
        return [pscustomobject]@{ url = $Url; reachable = $true; statusCode = [int]$response.StatusCode }
    }
    catch {
        return [pscustomobject]@{ url = $Url; reachable = $false; statusCode = $null; error = $_.Exception.Message }
    }
}

function Get-GitIntegrity {
    param([string]$RepoPath)

    $shallowResult = Get-GitCommand -RepoPath $RepoPath -Arguments @("rev-parse", "--is-shallow-repository")
    $shallowRepository = ((@($shallowResult.output) | Select-Object -First 1) -eq "true")
    $graphVerify = Get-GitCommand -RepoPath $RepoPath -Arguments @("commit-graph", "verify")
    $fsckNormal = Get-GitCommand -RepoPath $RepoPath -Arguments @("fsck", "--full", "--no-dangling", "--no-progress")
    $fsckWithoutGraph = Get-GitCommand -RepoPath $RepoPath -Arguments @("-c", "core.commitGraph=false", "fsck", "--full", "--no-dangling", "--no-progress")

    $state = if ($graphVerify.exitCode -eq 0 -and $fsckNormal.exitCode -eq 0) {
        "ok"
    }
    elseif ($fsckWithoutGraph.exitCode -eq 0) {
        "commit_graph_failed_object_fsck_ok"
    }
    else {
        "object_fsck_failed"
    }

    return [pscustomobject]@{
        state = $state
        shallowRepository = $shallowRepository
        commitGraphWrite = [pscustomobject]@{
            eligible = -not $shallowRepository
            blockedReason = if ($shallowRepository) { "repository_shallow" } else { $null }
        }
        commitGraphVerify = [pscustomobject]@{ ok = $graphVerify.exitCode -eq 0; exitCode = $graphVerify.exitCode; output = @($graphVerify.output | Select-Object -First 80) }
        fsck = [pscustomobject]@{ ok = $fsckNormal.exitCode -eq 0; exitCode = $fsckNormal.exitCode; output = @($fsckNormal.output | Select-Object -First 80) }
        fsckWithoutCommitGraph = [pscustomobject]@{ ok = $fsckWithoutGraph.exitCode -eq 0; exitCode = $fsckWithoutGraph.exitCode; output = @($fsckWithoutGraph.output | Select-Object -First 80) }
    }
}

$normalizedProjectRoot = Normalize-PathString -Path $ProjectRoot
$scriptCheckoutRoot = Split-Path -Parent $PSScriptRoot
$effectiveTopologyPath = if ([string]::IsNullOrWhiteSpace($TopologyPath)) { Join-Path $ProjectRoot "ops\codex\worktree-topology.json" } else { $TopologyPath }
$effectiveProtectedPaths = @($ProtectedPath)
if (Test-PathWithinRoot -Path $scriptCheckoutRoot -Root $WorktreeRoot -or $normalizedProjectRoot -eq (Normalize-PathString -Path $scriptCheckoutRoot)) {
    $effectiveProtectedPaths += $scriptCheckoutRoot
}
$effectiveProtectedPaths += $ProjectRoot

$originMain = ((Get-GitOutput -RepoPath $ProjectRoot -Arguments @("rev-parse", "origin/main")) | Select-Object -First 1)
$pullRequestIndex = Get-PullRequestIndex -RepositoryName $Repository -Skip:$SkipGitHub
$manifestIndex = Get-RuntimeManifestIndex -RuntimePath (Join-Path $OperatorRuntimeRoot "runtime\crm-local")
$worktrees = @(Get-WorktreeAudit -RepoPath $ProjectRoot -SharedWorktreePath $WorktreeRoot -RuntimePath $RuntimeRoot -OperatorPath $OperatorRuntimeRoot -OriginMain $originMain -PullRequestIndex $pullRequestIndex -ManifestIndex $manifestIndex -ProtectedPaths $effectiveProtectedPaths)
$topologyState = Get-TopologyDocument -Path $effectiveTopologyPath
$canonicalTopology = Get-CanonicalTopologyAudit -TopologyState $topologyState -WorktreeRoot $WorktreeRoot -OperatorRuntimeRoot $OperatorRuntimeRoot -Worktrees $worktrees
$gitIntegrity = Get-GitIntegrity -RepoPath $ProjectRoot

$retiredPaths = @(
    "C:\ProgramData\CodexProfileRename",
    "C:\ProgramData\SkincosMiniPc",
    "C:\CodexShared\Backups",
    "C:\CodexShared\Projetos\_bootstrap\n8n-top-level-legacy-20260703T181656",
    "C:\CodexRuntime\recovery\atendimento-legacy"
)
$backupRoot = Join-Path $RuntimeRoot "backups\orb\daily"
$backupFiles = if (Test-Path -LiteralPath $backupRoot) {
    @(Get-ChildItem -LiteralPath $backupRoot -File -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending)
} else { @() }
$latestBackup = if ($backupFiles.Count -gt 0) { $backupFiles[0] } else { $null }
$orphanTask = Get-ScheduledTask -TaskName "Orb Stack WSL Supervisor" -ErrorAction SilentlyContinue
$drive = Get-PSDrive -Name C
$manualWorktrees = @($worktrees | Where-Object { $_.category -eq "manual-shared" })
$privateSourceWorktrees = @($worktrees | Where-Object { $_.classification -like "*runtime_source*" -or (Test-PathWithinRoot -Path $_.path -Root (Join-Path $OperatorRuntimeRoot "source\crm-local\immutable")) })
$classificationCounts = @{}
foreach ($group in @($worktrees | Group-Object classification)) {
    $classificationCounts[$group.Name] = $group.Count
}
$sourceMetadataRoot = Join-Path $OperatorRuntimeRoot "source\crm-local\metadata"
$sourceMetadataCount = @(Get-ChildItem -LiteralPath $sourceMetadataRoot -File -Force -ErrorAction SilentlyContinue).Count
$runtimeManifests = @($manifestIndex.manifests)
$runtimeStateCounts = @{}
foreach ($group in @($runtimeManifests | Group-Object state)) {
    $runtimeStateCounts[$group.Name] = $group.Count
}

$result = [pscustomobject]@{
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    repository = $Repository
    project = [pscustomobject]@{
        path = $ProjectRoot
        branch = (@(Get-GitOutput -RepoPath $ProjectRoot -Arguments @("branch", "--show-current")) | Select-Object -First 1)
        head = (@(Get-GitOutput -RepoPath $ProjectRoot -Arguments @("rev-parse", "HEAD")) | Select-Object -First 1)
        originMain = $originMain
        dirtyCount = @(Get-GitOutput -RepoPath $ProjectRoot -Arguments @("status", "--porcelain=v1")).Count
        gitIntegrity = $gitIntegrity
    }
    footprints = @(
        Get-DirectoryFootprint -Path $ProjectRoot
        Get-DirectoryFootprint -Path $WorktreeRoot
        Get-DirectoryFootprint -Path $RuntimeRoot
    )
    summary = [pscustomobject]@{
        worktreeCount = $worktrees.Count
        manualWorktreeCount = $manualWorktrees.Count
        manualDirtyCount = @($manualWorktrees | Where-Object { $_.dirtyCount -gt 0 }).Count
        manualDetachedCount = @($manualWorktrees | Where-Object { $_.detached }).Count
        manualOpenPullRequestCount = @($manualWorktrees | Where-Object { $_.openPullRequest }).Count
        privateRuntimeWorktreeCount = @($worktrees | Where-Object { $_.category -eq "private-runtime" }).Count
        privateSourceWorktreeCount = $privateSourceWorktrees.Count
        privateSourceMetadataCount = $sourceMetadataCount
        runtimeManifestCount = $runtimeManifests.Count
        canonicalSurfaceCount = $canonicalTopology.surfaceCount
        canonicalPresentCount = $canonicalTopology.presentCount
        canonicalMissingCount = $canonicalTopology.missingCount
        canonicalDuplicateCount = $canonicalTopology.duplicateCount
        canonicalClaimedCount = $canonicalTopology.claimedCount
        classificationCounts = $classificationCounts
        runtimeStateCounts = $runtimeStateCounts
    }
    pullRequests = [pscustomobject]@{
        status = $pullRequestIndex.status
        repository = $pullRequestIndex.repository
        count = @($pullRequestIndex.pullRequests).Count
    }
    worktrees = @($worktrees)
    canonicalTopology = $canonicalTopology
    runtimeManifests = @($runtimeManifests)
    retiredPaths = @($retiredPaths | ForEach-Object { [pscustomobject]@{ path = $_; exists = Test-Path -LiteralPath $_ } })
    orphanScheduledTaskPresent = $null -ne $orphanTask
    latestOrbBackup = if ($latestBackup) {
        [pscustomobject]@{ path = $latestBackup.FullName; bytes = [int64]$latestBackup.Length; ageHours = [math]::Round(((Get-Date).ToUniversalTime() - $latestBackup.LastWriteTimeUtc).TotalHours, 2) }
    } else { $null }
    cDrive = [pscustomobject]@{ freeBytes = [int64]$drive.Free; usedBytes = [int64]$drive.Used }
    health = if ($SkipHealth) {
        @()
    } else {
        @(
            Get-Health -Url "http://127.0.0.1:5678/healthz"
            Get-Health -Url "https://orb.skincos.com.br/healthz"
            Get-Health -Url "https://crm.skincos.com.br"
        )
    }
    protectedPaths = @($effectiveProtectedPaths | Select-Object -Unique)
    reportPath = $ReportPath
}

$json = $result | ConvertTo-Json -Depth 12
if (-not [string]::IsNullOrWhiteSpace($ReportPath)) {
    if (-not (Test-PathWithinRoot -Path $ReportPath -Root $OperatorRuntimeRoot)) {
        throw "ReportPath must remain inside the private operator runtime: '$ReportPath'."
    }
    $reportParent = Split-Path -Parent $ReportPath
    New-Item -ItemType Directory -Path $reportParent -Force | Out-Null
    $json | Set-Content -LiteralPath $ReportPath -Encoding utf8
}

Write-Output $json

if ($FailOnDrift) {
    $retiredPresent = @($result.retiredPaths | Where-Object { $_.exists }).Count -gt 0
    $prunablePresent = @($result.worktrees | Where-Object { $_.prunable }).Count -gt 0
    $canonicalDrift = $result.canonicalTopology.status -in @("invalid", "drift")
    if ($retiredPresent -or $result.orphanScheduledTaskPresent -or $prunablePresent -or $result.project.gitIntegrity.state -ne "ok" -or $canonicalDrift) {
        exit 1
    }
}
