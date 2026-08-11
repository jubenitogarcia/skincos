param(
    [ValidateSet('inventory', 'plan', 'ensure-canonical', 'claim', 'release', 'retire')]
    [string]$Action = 'inventory',
    [string]$ProjectRoot = 'C:\CodexShared\Projetos\skincos',
    [string]$WorktreeRoot = 'C:\CodexShared\Worktrees\skincos',
    [string]$TopologyPath,
    [string]$RuntimeRegistryRoot = 'C:\CodexRuntime\operator\admin\skincos\worktree-registry',
    [string]$Repository = 'jubenitogarcia/skincos',
    [ValidateSet('crm-module', 'orb-workflow-family')]
    [string]$SurfaceType,
    [string]$SurfaceId,
    [string]$TargetCommit,
    [string]$WorktreePath,
    [string]$Owner = $env:USERNAME,
    [string]$LeaseToken,
    [switch]$Apply,
    [switch]$SkipGitHub
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($TopologyPath)) {
    $TopologyPath = Join-Path $ProjectRoot 'ops\codex\worktree-topology.json'
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

    return $fullPath.Replace('/', '\').TrimEnd([char[]]'\/').ToLowerInvariant()
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

function Convert-ToWslPath {
    param([string]$Path)

    if ($Path -match '^([A-Za-z]):\\(.*)$') {
        return "/mnt/$($Matches[1].ToLowerInvariant())/$($Matches[2].Replace('\', '/'))"
    }
    return $Path.Replace('\', '/')
}

function Read-JsonFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    }
    catch {
        throw "JSON inválido em '$Path': $($_.Exception.Message)"
    }
}

function Write-JsonAtomic {
    param(
        [string]$Path,
        [object]$Value
    )

    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $temporary = "$Path.$PID.tmp"
    $Value | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Invoke-Git {
    param(
        [string]$RepoPath,
        [string[]]$Arguments
    )

    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
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
        $ErrorActionPreference = $oldPreference
    }

    return [pscustomobject]@{
        output = @($output)
        exitCode = $exitCode
    }
}

function Get-WorktreeRecords {
    param(
        [string]$RepoPath,
        [switch]$IncludeStatus
    )

    $result = Invoke-Git -RepoPath $RepoPath -Arguments @('worktree', 'list', '--porcelain')
    if ($result.exitCode -ne 0) {
        throw "git worktree list falhou: $($result.output -join ' ')"
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
        $exists = Test-Path -LiteralPath $record.path -PathType Container
        $status = @()
        if ($exists -and $IncludeStatus) {
            $status = @(Invoke-Git -RepoPath $record.path -Arguments @('status', '--porcelain=v1')).output
        }
        $dirtyCount = $null
        if ($IncludeStatus) {
            $dirtyCount = @($status | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
        }
        Add-Member -InputObject $record -NotePropertyName exists -NotePropertyValue $exists
        Add-Member -InputObject $record -NotePropertyName dirtyCount -NotePropertyValue $dirtyCount
        Add-Member -InputObject $record -NotePropertyName dirtySample -NotePropertyValue @($status | Select-Object -First 10)
    }

    return @($records)
}

function Get-Topology {
    $topology = Read-JsonFile -Path $TopologyPath
    if ($null -eq $topology) {
        throw "Topologia não encontrada em '$TopologyPath'."
    }
    if ([int]$topology.schemaVersion -ne 1 -or [string]$topology.topologyId -ne 'skincos-canonical-worktrees') {
        throw "Topologia incompatível em '$TopologyPath'."
    }

    $allIds = @()
    $allIds += @($topology.crm.surfaces | ForEach-Object { [string]$_.id })
    $allIds += @($topology.orb.families | ForEach-Object { [string]$_.id })
    if (@($allIds | Where-Object { $_ -notmatch '^[a-z0-9][a-z0-9-]*$' }).Count -gt 0) {
        throw 'A topologia contém identificador de superfície inválido.'
    }
    if (@($allIds | Group-Object | Where-Object { $_.Count -gt 1 }).Count -gt 0) {
        throw 'A topologia contém identificadores de superfície duplicados.'
    }
    return $topology
}

function Get-SurfaceDefinitions {
    param([object]$Topology)

    $definitions = @()
    foreach ($surface in @($Topology.crm.surfaces)) {
        $id = [string]$surface.id
        $definitions += [pscustomobject]@{
            surfaceType = 'crm-module'
            surfaceId = $id
            label = [string]$surface.label
            route = [string]$surface.route
            source = [string]$surface.source
            pilot = @($Topology.crm.pilot) -contains $id
            expectedPath = Join-Path $WorktreeRoot (Join-Path ([string]$Topology.worktree.canonicalRelativeRoot) ("crm\$id"))
            workflowIds = @()
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
            pilot = @($Topology.orb.pilot) -contains $id
            expectedPath = Join-Path $WorktreeRoot (Join-Path ([string]$Topology.worktree.canonicalRelativeRoot) ("orb\$id"))
            workflowIds = @($family.mainWorkflowIds) + @($family.subworkflowIds) + @($family.relatedWorkflowIds)
        }
    }
    return @($definitions)
}

function Get-RegistryState {
    $path = Join-Path $RuntimeRegistryRoot 'canonical-registry.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return [pscustomobject]@{
            status = 'missing'
            path = $path
            surfaces = @()
        }
    }

    $value = Read-JsonFile -Path $path
    if ($null -eq $value -or [int]$value.schemaVersion -ne 1) {
        return [pscustomobject]@{
            status = 'invalid'
            path = $path
            surfaces = @()
        }
    }
    return [pscustomobject]@{
        status = 'ok'
        path = $path
        surfaces = @($value.surfaces)
    }
}

function Get-Lease {
    param(
        [string]$SurfaceType,
        [string]$SurfaceId
    )

    $key = "$SurfaceType--$SurfaceId"
    $leasePath = Join-Path $RuntimeRegistryRoot (Join-Path 'leases' $key)
    $ownerPath = Join-Path $leasePath 'owner.json'
    if (-not (Test-Path -LiteralPath $ownerPath -PathType Leaf)) {
        return [pscustomobject]@{ status = 'free'; path = $leasePath; owner = $null }
    }
    return [pscustomobject]@{ status = 'claimed'; path = $leasePath; owner = Read-JsonFile -Path $ownerPath }
}

function Get-SurfaceDefinition {
    param(
        [object[]]$Definitions,
        [string]$RequestedType,
        [string]$RequestedId
    )

    if ([string]::IsNullOrWhiteSpace($RequestedType) -or [string]::IsNullOrWhiteSpace($RequestedId)) {
        throw '-SurfaceType e -SurfaceId são obrigatórios para esta ação.'
    }
    $matches = @($Definitions | Where-Object { $_.surfaceType -eq $RequestedType -and $_.surfaceId -eq $RequestedId })
    if ($matches.Count -ne 1) {
        throw "Superfície não encontrada ou ambígua: $RequestedType/$RequestedId."
    }
    return $matches[0]
}

function Get-ManifestReferences {
    $root = Join-Path $RuntimeRegistryRoot '..\runtime\crm-local'
    $manifestRoot = [System.IO.Path]::GetFullPath($root)
    if (-not (Test-Path -LiteralPath $manifestRoot -PathType Container)) {
        return @()
    }

    $references = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $manifestRoot -Filter 'current.json' -File -Recurse -Force -ErrorAction SilentlyContinue)) {
        try { $manifest = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json } catch { continue }
        foreach ($propertyName in @('worktree', 'sourceOrigin')) {
            if ($null -eq $manifest.PSObject.Properties[$propertyName]) { continue }
            $value = [string]$manifest.$propertyName
            if ([string]::IsNullOrWhiteSpace($value)) { continue }
            $references += [pscustomobject]@{ manifestPath = $file.FullName; property = $propertyName; value = $value }
        }
    }
    return @($references)
}

function Get-CanonicalInventory {
    param(
        [object]$Topology,
        [object[]]$Definitions,
        [object[]]$Worktrees,
        [object]$Registry
    )

    $manifestReferences = @(Get-ManifestReferences)
    $surfaceRows = @()
    foreach ($definition in $Definitions) {
        $expected = Normalize-PathString -Path $definition.expectedPath
        $matches = @($Worktrees | Where-Object { (Normalize-PathString -Path $_.path) -eq $expected })
        $registryRows = @($Registry.surfaces | Where-Object { $_.surfaceType -eq $definition.surfaceType -and $_.surfaceId -eq $definition.surfaceId })
        $lease = Get-Lease -SurfaceType $definition.surfaceType -SurfaceId $definition.surfaceId
        $manifestRows = @($manifestReferences | Where-Object { Test-PathWithinRoot -Path $_.value -Root $definition.expectedPath })
        $registryMismatch = $false
        if ($matches.Count -eq 1 -and $registryRows.Count -eq 1) {
            $registryMismatch = (Normalize-PathString -Path ([string]$registryRows[0].path)) -ne $expected -or
                ([string]$registryRows[0].targetCommit).ToLowerInvariant() -ne ([string]$matches[0].head).ToLowerInvariant()
        }

        $status = 'missing'
        if ($Registry.status -eq 'invalid') {
            $status = 'invalid_registry'
        }
        elseif ($matches.Count -gt 1 -or $registryRows.Count -gt 1) {
            $status = 'duplicate'
        }
        elseif ($matches.Count -eq 0 -and $registryRows.Count -gt 0) {
            $status = 'registry_without_worktree'
        }
        elseif ($matches.Count -eq 1 -and $matches[0].dirtyCount -gt 0) {
            $status = 'blocked_dirty'
        }
        elseif ($matches.Count -eq 1 -and $manifestRows.Count -gt 0) {
            $status = 'protected_manifest_reference'
        }
        elseif ($matches.Count -eq 1 -and $lease.status -eq 'claimed') {
            $status = 'claimed'
        }
        elseif ($matches.Count -eq 1 -and $registryMismatch) {
            $status = 'registry_mismatch'
        }
        elseif ($matches.Count -eq 1 -and $registryRows.Count -eq 1) {
            $status = 'ready'
        }
        elseif ($matches.Count -eq 1) {
            $status = 'unregistered_worktree'
        }

        $row = [ordered]@{
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
            manifestReferences = @($manifestRows)
            workflowIds = @($definition.workflowIds)
        }
        $surfaceRows += [pscustomobject]$row
    }

    $canonicalRoot = Join-Path $WorktreeRoot ([string]$Topology.worktree.canonicalRelativeRoot)
    $expectedPaths = @($surfaceRows | ForEach-Object { Normalize-PathString -Path $_.expectedPath })
    $extra = @()
    foreach ($worktree in $Worktrees) {
        $worktreePath = Normalize-PathString -Path $worktree.path
        if ((Test-PathWithinRoot -Path $worktree.path -Root $canonicalRoot) -and ($expectedPaths -notcontains $worktreePath)) {
            $extra += [pscustomobject]@{ path = $worktree.path; head = $worktree.head; branch = $worktree.branch; dirtyCount = $worktree.dirtyCount }
        }
    }

    return [pscustomobject]@{
        status = if (@($surfaceRows | Where-Object { $_.status -in @('invalid_registry', 'duplicate', 'registry_mismatch') }).Count -gt 0) { 'drift' } else { 'ok' }
        topologyPath = $TopologyPath
        canonicalRoot = $canonicalRoot
        surfaceCount = $surfaceRows.Count
        presentCount = @($surfaceRows | Where-Object { $_.worktreeCount -eq 1 }).Count
        missingCount = @($surfaceRows | Where-Object { $_.status -eq 'missing' }).Count
        duplicateCount = @($surfaceRows | Where-Object { $_.status -eq 'duplicate' }).Count
        claimedCount = @($surfaceRows | Where-Object { $_.status -eq 'claimed' }).Count
        pilot = @($surfaceRows | Where-Object { $_.pilot })
        surfaces = @($surfaceRows)
        unmappedCanonicalWorktrees = $extra
        registry = $Registry
    }
}

function Write-RegistryEntry {
    param([object]$Entry)

    $registryPath = Join-Path $RuntimeRegistryRoot 'canonical-registry.json'
    $registry = Get-RegistryState
    $surfaces = @($registry.surfaces | Where-Object { $_.surfaceType -ne $Entry.surfaceType -or $_.surfaceId -ne $Entry.surfaceId })
    $surfaces += $Entry
    Write-JsonAtomic -Path $registryPath -Value ([pscustomobject]@{ schemaVersion = 1; updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o'); surfaces = @($surfaces) })
}

function Update-RegistryLease {
    param(
        [string]$RequestedType,
        [string]$RequestedId,
        [object]$Lease
    )

    $registry = Get-RegistryState
    $rows = @($registry.surfaces | ForEach-Object {
        if ($_.surfaceType -eq $RequestedType -and $_.surfaceId -eq $RequestedId) {
            $copy = [ordered]@{}
            foreach ($property in $_.PSObject.Properties) { $copy[$property.Name] = $property.Value }
            if ($null -eq $Lease) {
                $copy.Remove('lease')
            }
            else {
                $copy.lease = $Lease
            }
            [pscustomobject]$copy
        }
        else { $_ }
    })
    Write-JsonAtomic -Path (Join-Path $RuntimeRegistryRoot 'canonical-registry.json') -Value ([pscustomobject]@{ schemaVersion = 1; updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o'); surfaces = @($rows) })
}

function Ensure-Canonical {
    param(
        [object]$Definition,
        [object[]]$Worktrees
    )

    if (-not $Apply) { throw 'ensure-canonical exige -Apply.' }
    if ($TargetCommit -notmatch '^[0-9a-fA-F]{40}$') { throw 'ensure-canonical exige -TargetCommit com SHA completo de 40 caracteres.' }

    $matches = @($Worktrees | Where-Object { (Normalize-PathString -Path $_.path) -eq (Normalize-PathString -Path $Definition.expectedPath) })
    if ($matches.Count -gt 1) { throw "Slot canônico duplicado: $($Definition.surfaceType)/$($Definition.surfaceId)." }
    if ($matches.Count -eq 1) {
        $status = @(Invoke-Git -RepoPath $matches[0].path -Arguments @('status', '--porcelain=v1')).output
        if (@($status | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) { throw 'O slot canônico existente está sujo.' }
        if ([string]$matches[0].head -ne $TargetCommit) { throw "Slot canônico já existe em $($matches[0].head), esperado $TargetCommit." }
        $action = 'reused'
    }
    else {
        if (Test-Path -LiteralPath $Definition.expectedPath) { throw "O caminho canônico existe mas não está registrado: $($Definition.expectedPath)." }
        $commitCheck = Invoke-Git -RepoPath $ProjectRoot -Arguments @('cat-file', '-e', "$TargetCommit^{commit}")
        if ($commitCheck.exitCode -ne 0) { throw "SHA alvo não existe no repositório: $TargetCommit." }
        New-Item -ItemType Directory -Path (Split-Path -Parent $Definition.expectedPath) -Force | Out-Null
        $add = Invoke-Git -RepoPath $ProjectRoot -Arguments @('worktree', 'add', '--detach', $Definition.expectedPath, $TargetCommit)
        if ($add.exitCode -ne 0) { throw "Não foi possível criar o slot canônico: $($add.output -join ' ')" }
        $action = 'created'
    }

    $entry = [pscustomobject]@{
        surfaceType = $Definition.surfaceType
        surfaceId = $Definition.surfaceId
        label = $Definition.label
        role = 'canonical'
        path = $Definition.expectedPath
        targetCommit = $TargetCommit.ToLowerInvariant()
        source = $Definition.source
        updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    }
    Write-RegistryEntry -Entry $entry
    return [pscustomobject]@{ action = $action; surfaceType = $Definition.surfaceType; surfaceId = $Definition.surfaceId; path = $Definition.expectedPath; targetCommit = $TargetCommit.ToLowerInvariant() }
}

function Claim-Canonical {
    param([object]$Surface)

    if (-not $Apply) { throw 'claim exige -Apply.' }
    if ($Surface.status -notin @('ready', 'claimed')) { throw "Slot não está pronto para claim: $($Surface.status)." }
    if ($Surface.worktreeCount -ne 1) { throw 'Claim exige exatamente um worktree canônico.' }
    if (@($Surface.worktrees | Where-Object { $_.dirtyCount -gt 0 }).Count -gt 0) { throw 'Claim recusado para worktree sujo.' }
    if ($Surface.lease.status -eq 'claimed') { throw "Slot já possui lease de $($Surface.lease.owner.owner)." }

    $leasePath = $Surface.lease.path
    New-Item -ItemType Directory -Path (Split-Path -Parent $leasePath) -Force | Out-Null
    New-Item -ItemType Directory -Path $leasePath -Force:$false | Out-Null
    $token = [guid]::NewGuid().ToString('N')
    $ownerRecord = [pscustomobject]@{
        schemaVersion = 1
        token = $token
        owner = $Owner
        pid = $PID
        claimedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        surfaceType = $Surface.surfaceType
        surfaceId = $Surface.surfaceId
        path = $Surface.expectedPath
    }
    Write-JsonAtomic -Path (Join-Path $leasePath 'owner.json') -Value $ownerRecord
    Update-RegistryLease -RequestedType $Surface.surfaceType -RequestedId $Surface.surfaceId -Lease ([pscustomobject]@{ owner = $Owner; token = $token; claimedAtUtc = $ownerRecord.claimedAtUtc })
    return [pscustomobject]@{ action = 'claimed'; surfaceType = $Surface.surfaceType; surfaceId = $Surface.surfaceId; owner = $Owner; token = $token; path = $Surface.expectedPath }
}

function Release-Canonical {
    param([object]$Surface)

    if (-not $Apply) { throw 'release exige -Apply.' }
    if ($Surface.lease.status -ne 'claimed') { return [pscustomobject]@{ action = 'already-free'; surfaceType = $Surface.surfaceType; surfaceId = $Surface.surfaceId } }
    $record = $Surface.lease.owner
    if ($record.owner -ne $Owner -and ([string]::IsNullOrWhiteSpace($LeaseToken) -or $record.token -ne $LeaseToken)) {
        throw 'Release recusado: owner/token não corresponde ao lease.'
    }
    Remove-Item -LiteralPath $Surface.lease.path -Recurse -Force
    Update-RegistryLease -RequestedType $Surface.surfaceType -RequestedId $Surface.surfaceId -Lease $null
    return [pscustomobject]@{ action = 'released'; surfaceType = $Surface.surfaceType; surfaceId = $Surface.surfaceId; path = $Surface.expectedPath }
}

function Test-OpenPullRequest {
    param([string]$Branch)

    if ($SkipGitHub) { return [pscustomobject]@{ status = 'skipped'; open = $null } }
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { return [pscustomobject]@{ status = 'gh_missing'; open = $null } }
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $raw = @(& gh pr list --repo $Repository --head $Branch --state open --json number,title 2>&1 | ForEach-Object { [string]$_ })
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference
    if ($exitCode -ne 0) { return [pscustomobject]@{ status = 'error'; open = $null; output = $raw } }
    try { $rows = @($raw -join "`n" | ConvertFrom-Json) } catch { return [pscustomobject]@{ status = 'error'; open = $null; output = $raw } }
    return [pscustomobject]@{ status = 'ok'; open = $rows.Count -gt 0; pullRequests = @($rows) }
}

function Test-SourceInUse {
    param([string]$Path)

    $wrapper = Join-Path $ProjectRoot 'scripts\invoke-skincos-wsl.ps1'
    if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) { return [pscustomobject]@{ status = 'wrapper_missing'; inUse = $null } }
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $wrapper -ProjectRoot $ProjectRoot -Executable 'bash' -Argument @('scripts/crm-local-process-control.sh', 'source-in-use', (Convert-ToWslPath -Path $Path)) -SkipBootstrapCheck -SkipNodeCheck -SkipNpmCheck *> $null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference
    if ($exitCode -eq 0) { return [pscustomobject]@{ status = 'checked'; inUse = $true } }
    if ($exitCode -eq 1) { return [pscustomobject]@{ status = 'checked'; inUse = $false } }
    return [pscustomobject]@{ status = 'error'; inUse = $null; exitCode = $exitCode }
}

function Retire-Worktree {
    if (-not $Apply) { throw 'retire exige -Apply.' }
    if ([string]::IsNullOrWhiteSpace($WorktreePath)) { throw 'retire exige -WorktreePath explícito.' }
    $normalized = Normalize-PathString -Path $WorktreePath
    if ((Normalize-PathString -Path $ProjectRoot) -eq $normalized) { throw 'O clone compartilhado nunca pode ser aposentado.' }
    $topology = Get-Topology
    $canonicalRoot = Join-Path $WorktreeRoot ([string]$topology.worktree.canonicalRelativeRoot)
    if (Test-PathWithinRoot -Path $WorktreePath -Root $canonicalRoot) { throw 'Slots canônicos não podem ser aposentados por esta ação.' }

    $records = @(Get-WorktreeRecords -RepoPath $ProjectRoot -IncludeStatus | Where-Object { (Normalize-PathString -Path $_.path) -eq $normalized })
    if ($records.Count -ne 1) { throw "Worktree não encontrado ou ambíguo: $WorktreePath." }
    $record = $records[0]
    if (-not $record.exists) { throw 'Worktree não existe no filesystem.' }
    if ($record.dirtyCount -gt 0) { throw 'Worktree sujo: preservação obrigatória.' }
    if ($record.detached) { throw 'Worktree detached: confirmação manual obrigatória.' }
    if ($record.prunable) { throw 'Worktree já prunable: resolver estado Git antes da remoção.' }
    if ([string]::IsNullOrWhiteSpace($record.branch)) { throw 'Worktree sem branch não pode ser aposentado automaticamente.' }

    $remote = Invoke-Git -RepoPath $ProjectRoot -Arguments @('show-ref', '--verify', '--quiet', "refs/remotes/origin/$($record.branch)")
    if ($remote.exitCode -eq 0) { throw 'Branch possui tracking remoto; revisão manual obrigatória.' }
    $ancestor = Invoke-Git -RepoPath $ProjectRoot -Arguments @('merge-base', '--is-ancestor', $record.head, 'origin/main')
    if ($ancestor.exitCode -ne 0) { throw 'Worktree não é ancestral de origin/main.' }

    $pr = Test-OpenPullRequest -Branch $record.branch
    if ($pr.status -ne 'ok' -or $pr.open) { throw "PR não foi comprovadamente encerrado: $($pr | ConvertTo-Json -Compress -Depth 6)" }

    $manifestReferences = @(Get-ManifestReferences | Where-Object { Test-PathWithinRoot -Path $_.value -Root $record.path })
    if ($manifestReferences.Count -gt 0) { throw 'Manifesto de runtime referencia o worktree.' }
    $leaseKey = @((Get-RegistryState).surfaces | Where-Object { (Normalize-PathString -Path $_.path) -eq $normalized })
    if ($leaseKey.Count -gt 0 -and $leaseKey[0].lease) { throw 'Lease de runtime referencia o worktree.' }
    $sourceUse = Test-SourceInUse -Path $record.path
    if ($sourceUse.status -ne 'checked' -or $sourceUse.inUse) { throw "source-in-use não confirmou ausência de processo: $($sourceUse | ConvertTo-Json -Compress)" }

    $removed = Invoke-Git -RepoPath $ProjectRoot -Arguments @('worktree', 'remove', '--', $record.path)
    if ($removed.exitCode -ne 0) { throw "git worktree remove falhou: $($removed.output -join ' ')" }
    $prune = Invoke-Git -RepoPath $ProjectRoot -Arguments @('worktree', 'prune')
    if ($prune.exitCode -ne 0) { throw "git worktree prune falhou: $($prune.output -join ' ')" }
    return [pscustomobject]@{ action = 'retired'; path = $record.path; branch = $record.branch; head = $record.head; sourceInUse = $sourceUse }
}

$topology = Get-Topology
$definitions = @(Get-SurfaceDefinitions -Topology $topology)
$requiresInventory = $Action -in @('inventory', 'plan', 'claim', 'release')
$worktrees = @(Get-WorktreeRecords -RepoPath $ProjectRoot -IncludeStatus:$requiresInventory)
$registry = Get-RegistryState
$inventory = if ($requiresInventory) { Get-CanonicalInventory -Topology $topology -Definitions $definitions -Worktrees $worktrees -Registry $registry } else { $null }

switch ($Action) {
    'inventory' {
        $inventory | ConvertTo-Json -Depth 16
    }
    'plan' {
        $actions = @($inventory.surfaces | ForEach-Object {
            switch ($_.status) {
                'missing' { [pscustomobject]@{ action = 'ensure-canonical'; surfaceType = $_.surfaceType; surfaceId = $_.surfaceId; required = $true; reason = 'canonical_slot_missing'; mutation = 'requires -Apply and explicit -TargetCommit' } }
                'ready' { [pscustomobject]@{ action = 'none'; surfaceType = $_.surfaceType; surfaceId = $_.surfaceId; required = $false; reason = 'canonical_slot_ready'; mutation = 'none' } }
                'claimed' { [pscustomobject]@{ action = 'none'; surfaceType = $_.surfaceType; surfaceId = $_.surfaceId; required = $false; reason = 'canonical_slot_claimed'; mutation = 'none' } }
                default { [pscustomobject]@{ action = 'review'; surfaceType = $_.surfaceType; surfaceId = $_.surfaceId; required = $true; reason = $_.status; mutation = 'blocked_fail_closed' } }
            }
        })
        [pscustomobject]@{ inventory = $inventory; actions = $actions } | ConvertTo-Json -Depth 16
    }
    'ensure-canonical' {
        $definition = Get-SurfaceDefinition -Definitions $definitions -RequestedType $SurfaceType -RequestedId $SurfaceId
        Ensure-Canonical -Definition $definition -Worktrees $worktrees | ConvertTo-Json -Depth 12
    }
    'claim' {
        $surface = Get-SurfaceDefinition -Definitions $definitions -RequestedType $SurfaceType -RequestedId $SurfaceId
        $row = @($inventory.surfaces | Where-Object { $_.surfaceType -eq $surface.surfaceType -and $_.surfaceId -eq $surface.surfaceId })[0]
        Claim-Canonical -Surface $row | ConvertTo-Json -Depth 12
    }
    'release' {
        $surface = Get-SurfaceDefinition -Definitions $definitions -RequestedType $SurfaceType -RequestedId $SurfaceId
        $row = @($inventory.surfaces | Where-Object { $_.surfaceType -eq $surface.surfaceType -and $_.surfaceId -eq $surface.surfaceId })[0]
        Release-Canonical -Surface $row | ConvertTo-Json -Depth 12
    }
    'retire' {
        Retire-Worktree | ConvertTo-Json -Depth 12
    }
}
