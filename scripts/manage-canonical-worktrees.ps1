param(
    [ValidateSet('inventory', 'plan', 'ensure-canonical', 'claim', 'release', 'retire')]
    [string]$Action = 'inventory',
    [string]$ProjectRoot = 'C:\CodexShared\Projetos\skincos',
    [string]$WorktreeRoot = 'C:\CodexShared\Worktrees\skincos',
    [string]$TopologyPath,
    [string]$RuntimeRegistryRoot = 'C:\CodexRuntime\operator\admin\skincos\worktree-registry',
    [string]$Repository = 'jubenitogarcia/skincos',
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
if ([string]::IsNullOrWhiteSpace($TopologyPath)) { $TopologyPath = Join-Path $ProjectRoot 'ops\codex\worktree-topology.json' }

function Normalize-PathString {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
    try { $full = [System.IO.Path]::GetFullPath($Path) } catch { $full = $Path }
    return $full.Replace('/', '\').TrimEnd([char[]]'\/').ToLowerInvariant()
}

function Test-PathWithinRoot {
    param([string]$Path, [string]$Root)
    $p = Normalize-PathString $Path; $r = Normalize-PathString $Root
    return $p -eq $r -or $p.StartsWith("$r\")
}

function Read-JsonFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
    catch { throw "JSON inválido em '$Path': $($_.Exception.Message)" }
}

function Write-JsonAtomic {
    param([string]$Path, [object]$Value)
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $temporary = "$Path.$PID.tmp"
    $Value | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Invoke-Git {
    param([string]$RepoPath, [string[]]$Arguments)
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; $output = @(); $exitCode = 1
    try { $output = @(& git -C $RepoPath @Arguments 2>&1 | ForEach-Object { [string]$_ }); $exitCode = $LASTEXITCODE }
    catch { $output = @([string]$_.Exception.Message); $exitCode = 1 }
    finally { $ErrorActionPreference = $old }
    [pscustomobject]@{ output = @($output); exitCode = $exitCode }
}

function Get-WorktreeRecords {
    param([string]$RepoPath, [switch]$IncludeStatus, [string]$OnlyPath)
    $result = Invoke-Git $RepoPath @('worktree', 'list', '--porcelain')
    if ($result.exitCode -ne 0) { throw "git worktree list falhou: $($result.output -join ' ')" }
    $records = @(); $current = $null
    foreach ($line in @($result.output + '')) {
        if ($line -like 'worktree *') {
            if ($null -ne $current) { $records += [pscustomobject]$current }
            $current = [ordered]@{ path = $line.Substring(9); head = $null; branch = $null; detached = $false; locked = $false; lockReason = $null; prunable = $false; prunableReason = $null }
            continue
        }
        if ($null -eq $current) { continue }
        if ($line -like 'HEAD *') { $current.head = $line.Substring(5) }
        elseif ($line -match '^branch refs/heads/(.*)$') { $current.branch = $Matches[1] }
        elseif ($line -eq 'detached') { $current.detached = $true }
        elseif ($line -eq 'locked') { $current.locked = $true }
        elseif ($line -like 'locked *') { $current.locked = $true; $current.lockReason = $line.Substring(7) }
        elseif ($line -eq 'prunable') { $current.prunable = $true }
        elseif ($line -like 'prunable *') { $current.prunable = $true; $current.prunableReason = $line.Substring(9) }
    }
    if ($null -ne $current) { $records += [pscustomobject]$current }
    if (-not [string]::IsNullOrWhiteSpace($OnlyPath)) {
        $wanted = Normalize-PathString $OnlyPath
        $records = @($records | Where-Object { (Normalize-PathString $_.path) -eq $wanted })
    }
    foreach ($record in $records) {
        $exists = Test-Path -LiteralPath $record.path -PathType Container; $status = @()
        if ($exists -and $IncludeStatus) { $status = @(Invoke-Git $record.path @('status', '--porcelain=v1')).output }
        Add-Member -InputObject $record -NotePropertyName exists -NotePropertyValue $exists
        Add-Member -InputObject $record -NotePropertyName dirtyCount -NotePropertyValue $(if ($IncludeStatus) { @($status | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count } else { $null })
        Add-Member -InputObject $record -NotePropertyName dirtySample -NotePropertyValue @($status | Select-Object -First 10)
    }
    @($records)
}

function Get-Topology {
    $topology = Read-JsonFile $TopologyPath
    if ($null -eq $topology) { throw "Topologia não encontrada em '$TopologyPath'." }
    if ([int]$topology.schemaVersion -ne 1 -or [string]$topology.topologyId -ne 'skincos-canonical-worktrees') { throw "Topologia incompatível em '$TopologyPath'." }
    $surfaces = @($topology.surfaces); $ids = @($surfaces | ForEach-Object { [string]$_.id })
    if (@($ids | Where-Object { $_ -and $_ -notmatch '^[a-z0-9][a-z0-9-]*$' }).Count -gt 0) { throw 'A topologia contém identificador de superfície inválido.' }
    if (@($ids | Group-Object | Where-Object { $_.Name -and $_.Count -gt 1 }).Count -gt 0) { throw 'A topologia contém identificadores de superfície duplicados.' }
    $topology
}

function Get-SurfaceDefinitions {
    param([object]$Topology)
    $root = Join-Path $WorktreeRoot ([string]$Topology.worktree.canonicalRelativeRoot); $definitions = @()
    foreach ($surface in @($Topology.surfaces)) {
        $id = [string]$surface.id; if ([string]::IsNullOrWhiteSpace($id)) { continue }
        $type = if ([string]::IsNullOrWhiteSpace([string]$surface.type)) { 'module' } else { [string]$surface.type }
        $relative = if ([string]::IsNullOrWhiteSpace([string]$surface.relativePath)) { "$type\$id" } else { [string]$surface.relativePath }
        $definitions += [pscustomobject]@{ surfaceType = $type; surfaceId = $id; label = [string]$surface.label; source = [string]$surface.source; pilot = [bool]$surface.pilot; expectedPath = Join-Path $root $relative; workflowIds = @($surface.workflowIds) }
    }
    @($definitions)
}

function Get-RegistryState {
    $path = Join-Path $RuntimeRegistryRoot 'canonical-registry.json'; $value = Read-JsonFile $path
    if ($null -eq $value) { return [pscustomobject]@{ status = 'missing'; path = $path; surfaces = @() } }
    if ([int]$value.schemaVersion -ne 1) { return [pscustomobject]@{ status = 'invalid'; path = $path; surfaces = @() } }
    [pscustomobject]@{ status = 'ok'; path = $path; surfaces = @($value.surfaces) }
}

function Get-Lease {
    param([string]$Type, [string]$Id)
    $path = Join-Path $RuntimeRegistryRoot (Join-Path 'leases' "$Type--$Id"); $ownerPath = Join-Path $path 'owner.json'
    if (-not (Test-Path -LiteralPath $ownerPath -PathType Leaf)) { return [pscustomobject]@{ status = 'free'; path = $path; owner = $null } }
    [pscustomobject]@{ status = 'claimed'; path = $path; owner = Read-JsonFile $ownerPath }
}

function Get-ManifestReferences {
    $root = [System.IO.Path]::GetFullPath((Join-Path $RuntimeRegistryRoot '..\runtime'))
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { return @() }
    $references = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $root -Filter 'current.json' -File -Recurse -Force -ErrorAction SilentlyContinue)) {
        try { $manifest = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json } catch { continue }
        foreach ($name in @('worktree', 'sourceOrigin')) {
            if ($null -eq $manifest.PSObject.Properties[$name]) { continue }
            $value = [string]$manifest.$name; if ($value) { $references += [pscustomobject]@{ manifestPath = $file.FullName; property = $name; value = $value } }
        }
    }
    @($references)
}

function Get-Inventory {
    param([object]$Topology, [object[]]$Definitions, [object[]]$Worktrees, [object]$Registry)
    $refs = @(Get-ManifestReferences); $rows = @()
    foreach ($definition in $Definitions) {
        $expected = Normalize-PathString $definition.expectedPath; $matches = @($Worktrees | Where-Object { (Normalize-PathString $_.path) -eq $expected })
        $registryRows = @($Registry.surfaces | Where-Object { $_.surfaceType -eq $definition.surfaceType -and $_.surfaceId -eq $definition.surfaceId }); $lease = Get-Lease $definition.surfaceType $definition.surfaceId
        $manifestRows = @($refs | Where-Object { Test-PathWithinRoot $_.value $definition.expectedPath }); $mismatch = $false
        if ($matches.Count -eq 1 -and $registryRows.Count -eq 1) { $mismatch = (Normalize-PathString ([string]$registryRows[0].path)) -ne $expected -or ([string]$registryRows[0].targetCommit).ToLowerInvariant() -ne ([string]$matches[0].head).ToLowerInvariant() }
        $status = 'missing'
        if ($Registry.status -eq 'invalid') { $status = 'invalid_registry' }
        elseif ($matches.Count -gt 1 -or $registryRows.Count -gt 1) { $status = 'duplicate' }
        elseif ($matches.Count -eq 0 -and $registryRows.Count -gt 0) { $status = 'registry_without_worktree' }
        elseif ($matches.Count -eq 1 -and $matches[0].dirtyCount -gt 0) { $status = 'blocked_dirty' }
        elseif ($matches.Count -eq 1 -and $manifestRows.Count -gt 0) { $status = 'protected_manifest_reference' }
        elseif ($matches.Count -eq 1 -and $lease.status -eq 'claimed') { $status = 'claimed' }
        elseif ($matches.Count -eq 1 -and $mismatch) { $status = 'registry_mismatch' }
        elseif ($matches.Count -eq 1 -and $registryRows.Count -eq 1) { $status = 'ready' }
        elseif ($matches.Count -eq 1) { $status = 'unregistered_worktree' }
        $rows += [pscustomobject]@{ surfaceType = $definition.surfaceType; surfaceId = $definition.surfaceId; label = $definition.label; pilot = $definition.pilot; expectedPath = $definition.expectedPath; status = $status; worktreeCount = $matches.Count; worktrees = @($matches | ForEach-Object { [pscustomobject]@{ path = $_.path; head = $_.head; branch = $_.branch; detached = $_.detached; dirtyCount = $_.dirtyCount; prunable = $_.prunable } }); registryCount = $registryRows.Count; registry = @($registryRows); registryMismatch = $mismatch; lease = $lease; manifestReferences = @($manifestRows); workflowIds = @($definition.workflowIds) }
    }
    $canonicalRoot = Join-Path $WorktreeRoot ([string]$Topology.worktree.canonicalRelativeRoot); $expected = @($rows | ForEach-Object { Normalize-PathString $_.expectedPath }); $extra = @($Worktrees | Where-Object { (Test-PathWithinRoot $_.path $canonicalRoot) -and $expected -notcontains (Normalize-PathString $_.path) } | ForEach-Object { [pscustomobject]@{ path = $_.path; head = $_.head; branch = $_.branch; dirtyCount = $_.dirtyCount } })
    [pscustomobject]@{ status = if (@($rows | Where-Object { $_.status -in @('invalid_registry', 'duplicate', 'registry_mismatch') }).Count) { 'drift' } else { 'ok' }; topologyPath = $TopologyPath; canonicalRoot = $canonicalRoot; surfaceCount = $rows.Count; presentCount = @($rows | Where-Object { $_.worktreeCount -eq 1 }).Count; missingCount = @($rows | Where-Object { $_.status -eq 'missing' }).Count; duplicateCount = @($rows | Where-Object { $_.status -eq 'duplicate' }).Count; claimedCount = @($rows | Where-Object { $_.status -eq 'claimed' }).Count; pilot = @($rows | Where-Object { $_.pilot }); surfaces = @($rows); unmappedCanonicalWorktrees = $extra; registry = $Registry }
}

function Get-Definition { param([object[]]$Definitions); if ([string]::IsNullOrWhiteSpace($SurfaceType) -or [string]::IsNullOrWhiteSpace($SurfaceId)) { throw '-SurfaceType e -SurfaceId são obrigatórios para esta ação.' }; $found = @($Definitions | Where-Object { $_.surfaceType -eq $SurfaceType -and $_.surfaceId -eq $SurfaceId }); if ($found.Count -ne 1) { throw "Superfície não encontrada ou ambígua: $SurfaceType/$SurfaceId." }; $found[0] }

function Update-Registry {
    param([object]$Entry, [switch]$RemoveLease)
    $state = Get-RegistryState; if ($RemoveLease) { $rows = @($state.surfaces | ForEach-Object { if ($_.surfaceType -eq $Entry.surfaceType -and $_.surfaceId -eq $Entry.surfaceId) { $copy = [ordered]@{}; foreach ($p in $_.PSObject.Properties) { $copy[$p.Name] = $p.Value }; $copy.Remove('lease'); [pscustomobject]$copy } else { $_ } }) } else { $rows = @($state.surfaces | Where-Object { $_.surfaceType -ne $Entry.surfaceType -or $_.surfaceId -ne $Entry.surfaceId }); $rows += $Entry }
    Write-JsonAtomic (Join-Path $RuntimeRegistryRoot 'canonical-registry.json') ([pscustomobject]@{ schemaVersion = 1; updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o'); surfaces = @($rows) })
}

function Ensure-Canonical {
    param([object]$Definition, [object[]]$Worktrees)
    if (-not $Apply) { throw 'ensure-canonical exige -Apply.' }; if ($TargetCommit -notmatch '^[0-9a-fA-F]{40}$') { throw 'ensure-canonical exige -TargetCommit com SHA completo de 40 caracteres.' }
    $matches = @($Worktrees | Where-Object { (Normalize-PathString $_.path) -eq (Normalize-PathString $Definition.expectedPath) }); if ($matches.Count -gt 1) { throw "Slot canônico duplicado: $($Definition.surfaceType)/$($Definition.surfaceId)." }
    if ($matches.Count -eq 1) { $dirty = @(Invoke-Git $matches[0].path @('status', '--porcelain=v1')).output | Where-Object { $_ }; if ($dirty.Count) { throw 'O slot canônico existente está sujo.' }; if ([string]$matches[0].head -ne $TargetCommit) { throw "Slot canônico já existe em $($matches[0].head), esperado $TargetCommit." }; $verb = 'reused' }
    else { if (Test-Path -LiteralPath $Definition.expectedPath) { throw "O caminho canônico existe mas não está registrado: $($Definition.expectedPath)." }; if ((Invoke-Git $ProjectRoot @('cat-file', '-e', "$TargetCommit^{commit}")).exitCode -ne 0) { throw "SHA alvo não existe no repositório: $TargetCommit." }; New-Item -ItemType Directory -Path (Split-Path -Parent $Definition.expectedPath) -Force | Out-Null; $add = Invoke-Git $ProjectRoot @('worktree', 'add', '--detach', $Definition.expectedPath, $TargetCommit); if ($add.exitCode -ne 0) { throw "Não foi possível criar o slot canônico: $($add.output -join ' ')" }; $verb = 'created' }
    $entry = [pscustomobject]@{ surfaceType = $Definition.surfaceType; surfaceId = $Definition.surfaceId; label = $Definition.label; role = 'canonical'; path = $Definition.expectedPath; targetCommit = $TargetCommit.ToLowerInvariant(); source = $Definition.source; updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o') }; Update-Registry $entry
    [pscustomobject]@{ action = $verb; surfaceType = $Definition.surfaceType; surfaceId = $Definition.surfaceId; path = $Definition.expectedPath; targetCommit = $TargetCommit.ToLowerInvariant() }
}

function Claim-Canonical {
    param([object]$Surface)
    if (-not $Apply) { throw 'claim exige -Apply.' }; if ($Surface.status -notin @('ready', 'claimed') -or $Surface.worktreeCount -ne 1 -or @($Surface.worktrees | Where-Object { $_.dirtyCount -gt 0 }).Count) { throw "Slot não está pronto para claim: $($Surface.status)." }; if ($Surface.lease.status -eq 'claimed') { throw "Slot já possui lease de $($Surface.lease.owner.owner)." }
    $path = $Surface.lease.path; New-Item -ItemType Directory -Path $path -Force | Out-Null; $token = [guid]::NewGuid().ToString('N'); $ownerRecord = [pscustomobject]@{ schemaVersion = 1; token = $token; owner = $Owner; pid = $PID; claimedAtUtc = (Get-Date).ToUniversalTime().ToString('o'); surfaceType = $Surface.surfaceType; surfaceId = $Surface.surfaceId; path = $Surface.expectedPath }; Write-JsonAtomic (Join-Path $path 'owner.json') $ownerRecord
    $entry = @((Get-RegistryState).surfaces | Where-Object { $_.surfaceType -eq $Surface.surfaceType -and $_.surfaceId -eq $Surface.surfaceId })[0]; if ($null -eq $entry) { throw 'Registro canônico ausente para claim.' }; $copy = [ordered]@{}; foreach ($p in $entry.PSObject.Properties) { $copy[$p.Name] = $p.Value }; $copy.lease = [pscustomobject]@{ owner = $Owner; token = $token; claimedAtUtc = $ownerRecord.claimedAtUtc }; Update-Registry ([pscustomobject]$copy)
    [pscustomobject]@{ action = 'claimed'; surfaceType = $Surface.surfaceType; surfaceId = $Surface.surfaceId; owner = $Owner; token = $token; path = $Surface.expectedPath }
}

function Release-Canonical {
    param([object]$Surface)
    if (-not $Apply) { throw 'release exige -Apply.' }; if ($Surface.lease.status -ne 'claimed') { return [pscustomobject]@{ action = 'already-free'; surfaceType = $Surface.surfaceType; surfaceId = $Surface.surfaceId } }; $record = $Surface.lease.owner; if ($record.owner -ne $Owner -and ([string]::IsNullOrWhiteSpace($LeaseToken) -or $record.token -ne $LeaseToken)) { throw 'Release recusado: owner/token não corresponde ao lease.' }; Remove-Item -LiteralPath $Surface.lease.path -Recurse -Force; Update-Registry ([pscustomobject]@{ surfaceType = $Surface.surfaceType; surfaceId = $Surface.surfaceId }) -RemoveLease; [pscustomobject]@{ action = 'released'; surfaceType = $Surface.surfaceType; surfaceId = $Surface.surfaceId; path = $Surface.expectedPath }
}

function Retire-Worktree {
    if (-not $Apply) { throw 'retire exige -Apply.' }; if ([string]::IsNullOrWhiteSpace($WorktreePath)) { throw 'retire exige -WorktreePath explícito.' }; $normalized = Normalize-PathString $WorktreePath; if ((Normalize-PathString $ProjectRoot) -eq $normalized) { throw 'O clone compartilhado nunca pode ser aposentado.' }
    $topology = Get-Topology; $canonicalRoot = Join-Path $WorktreeRoot ([string]$topology.worktree.canonicalRelativeRoot); if (Test-PathWithinRoot $WorktreePath $canonicalRoot) { throw 'Slots canônicos não podem ser aposentados por esta ação.' }; $record = @(Get-WorktreeRecords $ProjectRoot -IncludeStatus -OnlyPath $WorktreePath); if ($record.Count -ne 1) { throw "Worktree não encontrado ou ambíguo: $WorktreePath." }; $record = $record[0]
    if (-not $record.exists -or $record.dirtyCount -gt 0 -or $record.detached -or $record.prunable -or [string]::IsNullOrWhiteSpace($record.branch)) { throw 'Worktree não atende aos requisitos de aposentadoria segura.' }; if ((Invoke-Git $ProjectRoot @('show-ref', '--verify', '--quiet', "refs/remotes/origin/$($record.branch)")).exitCode -eq 0) { throw 'Branch possui tracking remoto; revisão manual obrigatória.' }; if ((Invoke-Git $ProjectRoot @('merge-base', '--is-ancestor', $record.head, 'origin/main')).exitCode -ne 0) { throw 'Worktree não é ancestral de origin/main.' }; if (@(Get-ManifestReferences | Where-Object { Test-PathWithinRoot $_.value $record.path }).Count) { throw 'Manifesto de runtime referencia o worktree.' }
    throw 'Aposentadoria automática requer verificação externa de processos; remova pelo fluxo operacional apropriado.'
}

$topology = Get-Topology; $definitions = @(Get-SurfaceDefinitions $topology); $needInventory = $Action -in @('inventory', 'plan', 'claim', 'release'); $worktrees = @(Get-WorktreeRecords $ProjectRoot -IncludeStatus:$needInventory); $registry = Get-RegistryState; $inventory = if ($needInventory) { Get-Inventory $topology $definitions $worktrees $registry } else { $null }
switch ($Action) {
    'inventory' { $inventory | ConvertTo-Json -Depth 16 }
    'plan' {
        $actions = @($inventory.surfaces | ForEach-Object {
            if ($_.status -eq 'missing') {
                [pscustomobject]@{ action = 'ensure-canonical'; surfaceType = $_.surfaceType; surfaceId = $_.surfaceId; required = $true; reason = 'canonical_slot_missing'; mutation = 'requires -Apply and explicit -TargetCommit' }
            }
            elseif ($_.status -in @('ready', 'claimed')) {
                [pscustomobject]@{ action = 'none'; surfaceType = $_.surfaceType; surfaceId = $_.surfaceId; required = $false; reason = "canonical_slot_$($_.status)"; mutation = 'none' }
            }
            else {
                [pscustomobject]@{ action = 'review'; surfaceType = $_.surfaceType; surfaceId = $_.surfaceId; required = $true; reason = $_.status; mutation = 'blocked_fail_closed' }
            }
        })
        [pscustomobject]@{ inventory = $inventory; actions = $actions } | ConvertTo-Json -Depth 16
    }
    'ensure-canonical' { Ensure-Canonical (Get-Definition $definitions) $worktrees | ConvertTo-Json -Depth 12 }
    'claim' { $d = Get-Definition $definitions; Claim-Canonical (@($inventory.surfaces | Where-Object { $_.surfaceType -eq $d.surfaceType -and $_.surfaceId -eq $d.surfaceId })[0]) | ConvertTo-Json -Depth 12 }
    'release' { $d = Get-Definition $definitions; Release-Canonical (@($inventory.surfaces | Where-Object { $_.surfaceType -eq $d.surfaceType -and $_.surfaceId -eq $d.surfaceId })[0]) | ConvertTo-Json -Depth 12 }
    'retire' { Retire-Worktree | ConvertTo-Json -Depth 12 }
}
