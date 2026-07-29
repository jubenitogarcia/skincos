param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        "WorkspaceMenu",
        "ContextMenu",
        "LocalMenu",
        "EfAppMenu",
        "OrbMenu",
        "SharedSetup",
        "SharedValidate",
        "RuntimeSetup",
        "RuntimeValidate",
        "WslAccountBootstrap",
        "GitHubAuthLoginWsl",
        "GitHubAuthStatus",
        "SharedStatus",
        "CodexContext",
        "CodexContextOnline",
        "ThreadBootstrap",
        "NewWorktree",
        "WebsiteLocalStart",
        "WebsiteLocalStop",
        "WebsiteSiteCheck",
        "WebsiteReleaseCheck",
        "CrmLocal",
        "CrmConsultor",
        "CrmConsultorStop",
        "CrmSiteEf",
        "CrmMetaAds",
        "CrmFinance",
        "CrmAtendimento",
        "CrmAtendimentoMirrorStatus",
        "CrmAtendimentoMirrorSync",
        "CrmLocalStop",
        "CrmMemory",
        "CrmSiteSmoke",
        "CrmMetaAdsSmoke",
        "CrmFinanceSmoke",
        "CrmAtendimentoSmoke",
        "PlatformLocalStart",
        "EfAppSetup",
        "EfAppSelftest",
        "EfAppCaixa",
        "EfAppAgendaDelta",
        "EfAppAgendaFullSync",
        "EfAppBookingApi",
        "EfAppProcedures",
        "EfAppClientRegistration",
        "EfAppRecorder",
        "EfAppRotateAgendaSyncToken",
        "OrbStatus",
        "OrbRestart",
        "OrbRepair",
        "OrbLogs",
        "MetaAdsPublishPreflight",
        "OrbValidate",
        "OrbBusinessValidate",
        "OrbAudit",
        "OrbSupportServicesApply",
        "OrbImportClinicWorkflowsLive"
    )]
    [string]$Action,
    [string]$ProjectRoot,
    [switch]$CrmAtendimentoDetachedStart
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-ProjectRoot {
    param(
        [string]$RequestedPath,
        [string]$ScriptDirectory
    )

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    $scriptProjectRoot = Split-Path -Parent $ScriptDirectory
    if ((Test-Path -LiteralPath (Join-Path $scriptProjectRoot ".git")) -or
        (Test-Path -LiteralPath (Join-Path $scriptProjectRoot "AGENTS.md"))) {
        return (Resolve-Path -LiteralPath $scriptProjectRoot).Path
    }

    $currentPath = (Get-Location).Path
    if ((Test-Path -LiteralPath (Join-Path $currentPath ".git")) -or
        (Test-Path -LiteralPath (Join-Path $currentPath "AGENTS.md"))) {
        return (Resolve-Path -LiteralPath $currentPath).Path
    }

    throw "Unable to resolve the Skincos project root automatically. Re-run the command from the project/worktree root or pass -ProjectRoot explicitly."
}

$ProjectRoot = Resolve-ProjectRoot -RequestedPath $ProjectRoot -ScriptDirectory $scriptRoot
$localStateRoot = Join-Path $env:LOCALAPPDATA "Codex\skincos"
$operatorRuntimeRoot = "C:\CodexRuntime\operator\admin\skincos"
$crmLocalSourceSelectionPath = Join-Path $operatorRuntimeRoot "runtime\crm-local\active-source.json"
$tmpRoot = Join-Path $localStateRoot "tmp"
$logRoot = Join-Path $operatorRuntimeRoot "logs"
$wslInvoker = Join-Path $scriptRoot "invoke-skincos-wsl.ps1"
$crmLocalPreviewSelected = $false

# A CRM preview is selected explicitly and kept outside every worktree. This
# makes the chosen source deterministic for all Codex actions/modules, while
# never guessing from the thread that happened to invoke the shortcut.
$previewSourceRoot = [string]$env:CRM_LOCAL_PREVIEW_SOURCE_ROOT
if ([string]$env:CRM_LOCAL_CLEAR_PREVIEW_SOURCE -in @('1', 'true', 'TRUE')) {
    Remove-Item -LiteralPath $crmLocalSourceSelectionPath -Force -ErrorAction SilentlyContinue
    $previewSourceRoot = ''
} elseif ([string]::IsNullOrWhiteSpace($previewSourceRoot) -and (Test-Path -LiteralPath $crmLocalSourceSelectionPath)) {
    try {
        $previewSourceRoot = [string]((Get-Content -Raw -LiteralPath $crmLocalSourceSelectionPath | ConvertFrom-Json).sourceRoot)
    } catch {
        throw "A seleção ativa do CRM Local está inválida em '$crmLocalSourceSelectionPath'. Remova-a com CRM_LOCAL_CLEAR_PREVIEW_SOURCE=1 antes de iniciar o CRM."
    }
}
if (-not [string]::IsNullOrWhiteSpace($previewSourceRoot)) {
    $previewSourceRoot = (Resolve-Path -LiteralPath $previewSourceRoot).Path
    if (-not (Test-Path -LiteralPath (Join-Path $previewSourceRoot '.git'))) {
        throw "A prévia ativa do CRM Local não aponta para um checkout Git válido: '$previewSourceRoot'."
    }
    $ProjectRoot = $previewSourceRoot
    $crmLocalPreviewSelected = $true
    $env:CRM_LOCAL_INCLUDE_WORKING_CHANGES = 'true'
    if (-not [string]::IsNullOrWhiteSpace([string]$env:CRM_LOCAL_PREVIEW_SOURCE_ROOT)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $crmLocalSourceSelectionPath) -Force | Out-Null
        [pscustomobject]@{
            sourceRoot = $ProjectRoot
            selectedAt = (Get-Date).ToString('o')
            selectedBy = 'CRM_LOCAL_PREVIEW_SOURCE_ROOT'
        } | ConvertTo-Json | Set-Content -LiteralPath $crmLocalSourceSelectionPath -Encoding utf8
        Write-Host "[crm-local] Prévia ativa selecionada: $ProjectRoot"
    }
}

function Ensure-LocalState {
    foreach ($path in @(
        $localStateRoot,
        $tmpRoot,
        $logRoot,
        (Join-Path $operatorRuntimeRoot "scraper"),
        (Join-Path $operatorRuntimeRoot "scraper\report"),
        (Join-Path $operatorRuntimeRoot "scraper\debug"),
        (Join-Path $operatorRuntimeRoot "scraper\logs")
    )) {
        if (-not (Test-Path -LiteralPath $path)) {
            New-Item -ItemType Directory -Path $path -Force | Out-Null
        }
    }
}

function Convert-WindowsPathToWsl {
    param([string]$Path)

    if ($Path -match '^(?<drive>[A-Za-z]):\\(?<rest>.*)$') {
        $drive = $Matches.drive.ToLowerInvariant()
        $rest = $Matches.rest -replace '\\', '/'
        if ([string]::IsNullOrWhiteSpace($rest)) {
            return "/mnt/$drive"
        }
        return "/mnt/$drive/$rest"
    }

    return $Path
}

function Convert-ToBashLiteral {
    param([string]$Value)

    return "'" + $Value.Replace("'", "'""'""'") + "'"
}

function Invoke-ShortcutWsl {
    param(
        [string]$Command,
        [string]$WorkingProjectRoot = $ProjectRoot,
        [string[]]$EnvVar = @(),
        [switch]$SkipBootstrapCheck,
        [switch]$SkipNodeCheck,
        [switch]$SkipNpmCheck,
        [switch]$SkipGitCheck,
        [switch]$SkipRepoCheck,
        [int[]]$AcceptedExitCode = @(0)
    )

    & $wslInvoker `
        -ProjectRoot $WorkingProjectRoot `
        -RepoCommand $Command `
        -EnvVar $EnvVar `
        -SkipBootstrapCheck:$SkipBootstrapCheck `
        -SkipNodeCheck:$SkipNodeCheck `
        -SkipNpmCheck:$SkipNpmCheck `
        -SkipGitCheck:$SkipGitCheck `
        -SkipRepoCheck:$SkipRepoCheck

    if ($LASTEXITCODE -notin $AcceptedExitCode) {
        throw "The WSL command failed with exit code $LASTEXITCODE."
    }
}

function Invoke-ShortcutWslNativePreview {
    param(
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Command
    )
    if ($WorkingDirectory -notmatch '^/home/admin/\.local/state/skincos/crm-local-preview-source/[A-Za-z0-9._-]+$') {
        throw "Diretório nativo da prévia CRM não autorizado: '$WorkingDirectory'."
    }
    $nativeCommand = "cd -- {0} && {1}" -f (Convert-ToBashLiteral -Value $WorkingDirectory), $Command
    & wsl.exe -d Ubuntu-24.04 -- bash -lc $nativeCommand
    if ($LASTEXITCODE -ne 0) {
        throw "The native WSL preview command failed with exit code $LASTEXITCODE."
    }
}

function Get-CrmLocalReviewRef {
    if (-not [string]::IsNullOrWhiteSpace($env:CRM_LOCAL_REVIEW_REF)) {
        return $env:CRM_LOCAL_REVIEW_REF.Trim()
    }
    if ($crmLocalPreviewSelected) {
        # A selected preview is intentionally evaluated at its own checked-out
        # base. Its dirty snapshot is then fingerprinted, so every module sees
        # the same work without pretending that it was already integrated.
        return "HEAD"
    }
    if ([string]::IsNullOrWhiteSpace($env:CRM_LOCAL_REVIEW_REF)) {
        # The Codex App action is the canonical local CRM, not a preview of
        # whichever worktree or thread happens to invoke it. Fetching and
        # resolving origin/main makes "atualizado" deterministic across
        # modules and threads.
        return "origin/main"
    }
    return "origin/main"
}

function Test-CrmLocalIncludeWorkingChanges {
    $raw = [string]$env:CRM_LOCAL_INCLUDE_WORKING_CHANGES
    if ([string]::IsNullOrWhiteSpace($raw)) { return $false }
    switch ($raw.Trim().ToLowerInvariant()) {
        "1" { return $true }
        "true" { return $true }
        "yes" { return $true }
        "0" { return $false }
        "false" { return $false }
        "no" { return $false }
        default { throw "CRM_LOCAL_INCLUDE_WORKING_CHANGES deve ser true ou false." }
    }
}

function Get-CrmLocalTargetCommit {
    $reviewRef = Get-CrmLocalReviewRef
    if ($reviewRef -match '^(origin/|refs/remotes/origin/)') {
        & git -C $ProjectRoot fetch origin --prune --quiet
        if ($LASTEXITCODE -ne 0) {
            throw "Não foi possível atualizar as referências remotas antes de iniciar o CRM Local."
        }
    }

    $targetCommit = (& git -C $ProjectRoot rev-parse --verify "${reviewRef}^{commit}" 2>$null | Select-Object -First 1).Trim()
    if ($targetCommit -notmatch '^[0-9a-fA-F]{40}$') {
        throw "A revisão do CRM Local não pôde ser resolvida: '$reviewRef'."
    }
    return $targetCommit.ToLowerInvariant()
}

function Get-CrmLocalSnapshotHash {
    param([Parameter(Mandatory = $true)][string]$Value)
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Export-CrmLocalSnapshotPatch {
    param([Parameter(Mandatory = $true)][string]$OutputPath)

    New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = 'git'
    $process.StartInfo.Arguments = ('-C "{0}" diff --binary HEAD' -f $ProjectRoot)
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    try {
        [void]$process.Start()
        $stream = [IO.File]::Open($OutputPath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $process.StandardOutput.BaseStream.CopyTo($stream)
        } finally {
            $stream.Dispose()
        }
        $standardError = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            throw "Não foi possível ler as alterações locais do checkout '$ProjectRoot': $standardError"
        }
    } finally {
        $process.Dispose()
    }
}

function Remove-CrmLocalSourceSnapshot {
    param([object]$Snapshot)
    if ($null -ne $Snapshot -and -not [string]::IsNullOrWhiteSpace([string]$Snapshot.PatchPath)) {
        Remove-Item -LiteralPath ([string]$Snapshot.PatchPath) -Force -ErrorAction SilentlyContinue
    }
}

function Get-CrmLocalSnapshotRelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRootPath,
        [Parameter(Mandatory = $true)][string]$FullPath
    )
    $normalizedFullPath = [IO.Path]::GetFullPath($FullPath)
    $rootPrefix = $SourceRootPath + [IO.Path]::DirectorySeparatorChar
    if (-not $normalizedFullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Arquivo não rastreado fora do checkout no snapshot do CRM Local: '$FullPath'."
    }
    return $normalizedFullPath.Substring($rootPrefix.Length).Replace([char]'\', [char]'/')
}

function Get-CrmLocalSnapshotUntrackedFiles {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Entries)

    $sourceRootPath = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd([char]'\', [char]'/')
    $files = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in $Entries) {
        $relativeEntry = ([string]$entry).Trim()
        if ([string]::IsNullOrWhiteSpace($relativeEntry)) { continue }

        $candidate = Join-Path $ProjectRoot $relativeEntry.Replace('/', [IO.Path]::DirectorySeparatorChar)
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $item = Get-Item -LiteralPath $candidate -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Arquivo não rastreado com link simbólico não pode entrar no snapshot do CRM Local: '$relativeEntry'."
            }
            $relativeFile = Get-CrmLocalSnapshotRelativePath -SourceRootPath $sourceRootPath -FullPath $item.FullName
            $files.Add($relativeFile)
            continue
        }

        if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
            throw "Arquivo não rastreado inválido no snapshot do CRM Local: '$relativeEntry'."
        }

        # Git representa checkouts aninhados não rastreados como diretórios. Eles não
        # fazem parte da árvore do checkout acionado e não podem ser copiados para o
        # runtime sem misturar revisões, .git e alterações de outra thread.
        if (Test-Path -LiteralPath (Join-Path $candidate '.git')) {
            Write-Verbose "Ignorando checkout Git aninhado fora do snapshot do CRM Local: '$relativeEntry'."
            continue
        }

        $directoryItem = Get-Item -LiteralPath $candidate -Force
        if (($directoryItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Diretório não rastreado com link simbólico não pode entrar no snapshot do CRM Local: '$relativeEntry'."
        }

        Get-ChildItem -LiteralPath $candidate -File -Recurse -Force | ForEach-Object {
            if (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Arquivo não rastreado com link simbólico não pode entrar no snapshot do CRM Local: '$($_.FullName)'."
            }
            $relativeFile = Get-CrmLocalSnapshotRelativePath -SourceRootPath $sourceRootPath -FullPath $_.FullName
            & git -C $ProjectRoot check-ignore --quiet -- $relativeFile 2>$null
            if ($LASTEXITCODE -eq 0) { return }
            if ($LASTEXITCODE -ne 1) { throw "Não foi possível validar o arquivo não rastreado '$relativeFile' no snapshot do CRM Local." }
            $files.Add($relativeFile)
        }
    }
    return @($files | Sort-Object -Unique)
}

function Get-CrmLocalSourceSnapshot {
    param([Parameter(Mandatory = $true)][string]$TargetCommit)

    # The standard action intentionally ignores the caller's dirty checkout.
    # That checkout can belong to another Codex thread and may be based on an
    # older branch. A local preview must opt in explicitly and be based on the
    # exact requested revision, otherwise no changes are copied.
    if (-not (Test-CrmLocalIncludeWorkingChanges)) {
        return [pscustomobject]@{
            SourceRoot = $ProjectRoot
            TargetCommit = $TargetCommit
            PatchPath = $null
            Untracked = @()
            HasChanges = $false
            Fingerprint = "commit:${TargetCommit}"
        }
    }

    $sourceCommit = (& git -C $ProjectRoot rev-parse --verify 'HEAD^{commit}' 2>$null | Select-Object -First 1).Trim().ToLowerInvariant()
    if ($sourceCommit -notmatch '^[0-9a-f]{40}$') { throw "Não foi possível resolver o commit do checkout que disparou o CRM Local: '$ProjectRoot'." }
    if ($sourceCommit -ne $TargetCommit) {
        # A named preview may be based on an older ancestor. Its patch is
        # applied only to a fresh worktree at the current canonical commit;
        # conflict detection remains fail-closed in Apply-CrmLocalSourceSnapshot.
        & git -C $ProjectRoot merge-base --is-ancestor $sourceCommit $TargetCommit
        if ($LASTEXITCODE -ne 0) {
            throw "A prévia ativa não deriva da revisão canônica solicitada ($TargetCommit). Não copie alterações entre linhas divergentes; selecione uma prévia rebaseada ou limpe a seleção com CRM_LOCAL_CLEAR_PREVIEW_SOURCE=1."
        }
    }
    $patchPath = Join-Path $operatorRuntimeRoot ("tmp\crm-local-snapshot-{0}.patch" -f [Guid]::NewGuid().ToString('N'))
    Export-CrmLocalSnapshotPatch -OutputPath $patchPath
    $patchBytes = (Get-Item -LiteralPath $patchPath).Length
    $untrackedEntries = @(& git -C $ProjectRoot ls-files --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível ler os arquivos não rastreados do checkout '$ProjectRoot'." }
    $untracked = @(Get-CrmLocalSnapshotUntrackedFiles -Entries $untrackedEntries)
    $untrackedDigest = foreach ($relativePath in $untracked) {
        $candidate = Join-Path $ProjectRoot $relativePath
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "Arquivo não rastreado inválido no snapshot do CRM Local: '$relativePath'." }
        "${relativePath}:$((Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant())"
    }
    $hasChanges = $patchBytes -gt 0 -or $untracked.Count -gt 0
    $fingerprint = if ($hasChanges) {
        "snapshot:${TargetCommit}:$(Get-CrmLocalSnapshotHash -Value ((Get-FileHash -LiteralPath $patchPath -Algorithm SHA256).Hash.ToLowerInvariant() + "`n" + ($untrackedDigest -join "`n")))"
    } else {
        "commit:${TargetCommit}"
    }
    return [pscustomobject]@{
        SourceRoot = $ProjectRoot
        TargetCommit = $TargetCommit
        PatchPath = $patchPath
        Untracked = $untracked
        HasChanges = $hasChanges
        Fingerprint = $fingerprint
    }
}

function Get-CrmLocalSourceOrigin {
    param(
        [Parameter(Mandatory = $true)][object]$Snapshot,
        [Parameter(Mandatory = $true)][string]$Module
    )
    $sourceRoot = (Resolve-Path -LiteralPath ([string]$Snapshot.SourceRoot)).Path
    # The selected source is shared deliberately across CRM shortcuts, but a
    # runtime started for one module must never be reused by a different one.
    # Keep this token shell-neutral: it crosses the Windows → WSL command
    # boundary as an environment assignment before being persisted in JSON.
    return "{0}__{1}" -f $sourceRoot, $Module.Trim().ToLowerInvariant()
}

function Apply-CrmLocalSourceSnapshot {
    param(
        [Parameter(Mandatory = $true)][object]$Snapshot,
        [Parameter(Mandatory = $true)][string]$DestinationRoot
    )
    if (-not $Snapshot.HasChanges) { return }
    if ((Get-Item -LiteralPath $Snapshot.PatchPath).Length -gt 0) {
        & git -C $DestinationRoot apply --whitespace=nowarn --binary $Snapshot.PatchPath
        if ($LASTEXITCODE -ne 0) { throw "Não foi possível aplicar o snapshot local no worktree isolado '$DestinationRoot'." }
    }
    foreach ($relativePath in @($Snapshot.Untracked)) {
        $from = Join-Path $Snapshot.SourceRoot $relativePath
        $to = Join-Path $DestinationRoot $relativePath
        New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null
        Copy-Item -LiteralPath $from -Destination $to -Force
    }
}

function Get-CrmLocalSourceBaseRoot {
    param(
        [ValidateSet("Gestor", "Consultor")]
        [string]$Persona = "Gestor"
    )
    return (Join-Path $operatorRuntimeRoot ("source\crm-local-{0}-main" -f $Persona.ToLowerInvariant()))
}

function Sync-CrmLocalSourceRoot {
    param(
        [ValidateSet("Gestor", "Consultor")]
        [string]$Persona,
        [Parameter(Mandatory = $true)]
        [string]$TargetCommit,
        [Parameter(Mandatory = $true)]
        [object]$Snapshot
    )

    $sourceRoot = Get-CrmLocalSourceBaseRoot -Persona $Persona
    $sourceParent = Split-Path -Parent $sourceRoot
    New-Item -ItemType Directory -Path $sourceParent -Force | Out-Null

    if ($Snapshot.HasChanges) {
        $shortCommit = $TargetCommit.Substring(0, 12)
        $shortSnapshot = $Snapshot.Fingerprint.Split(':')[-1].Substring(0, 12)
        $snapshotRoot = "$sourceRoot-$shortCommit-$shortSnapshot"
        if (Test-Path -LiteralPath $snapshotRoot) {
            $snapshotRoot = "$snapshotRoot-$(Get-Date -Format 'yyyyMMddHHmmss')"
        }
        & git -C $ProjectRoot worktree add --detach $snapshotRoot $TargetCommit | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "Não foi possível criar o worktree isolado do snapshot do CRM Local em '$snapshotRoot'." }
        try {
            Apply-CrmLocalSourceSnapshot -Snapshot $Snapshot -DestinationRoot $snapshotRoot
        } catch {
            & git -C $ProjectRoot worktree remove --force $snapshotRoot 2>$null
            throw
        }
        return $snapshotRoot
    }

    if (Test-Path -LiteralPath $sourceRoot) {
        $trackedChanges = @(& git -C $sourceRoot status --porcelain --untracked-files=no)
        if ($LASTEXITCODE -ne 0) {
            throw "O worktree privado do CRM Local não está íntegro: '$sourceRoot'."
        }
        if ($trackedChanges.Count -gt 0) {
            $shortCommit = $TargetCommit.Substring(0, 12)
            $replacement = "$sourceRoot-$shortCommit"
            if (Test-Path -LiteralPath $replacement) {
                $replacement = "$replacement-$(Get-Date -Format 'yyyyMMddHHmmss')"
            }
            Write-Host "[crm-local] Worktree privado com alterações preservado em '$sourceRoot'; usando '$replacement'."
            $sourceRoot = $replacement
        }
    }

    if (-not (Test-Path -LiteralPath $sourceRoot)) {
        & git -C $ProjectRoot worktree prune | Out-Null
        & git -C $ProjectRoot worktree add --detach $sourceRoot $TargetCommit | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "Não foi possível criar o worktree limpo do CRM Local em '$sourceRoot'."
        }
        return $sourceRoot
    }

    & git -C $sourceRoot checkout --detach $TargetCommit | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Não foi possível alinhar o worktree privado do CRM Local ao commit $TargetCommit."
    }

    return $sourceRoot
}

function Resolve-CrmLocalSourceRoot {
    param(
        [ValidateSet("Gestor", "Consultor")]
        [string]$Persona = "Gestor"
    )
    $targetCommit = Get-CrmLocalTargetCommit
    $snapshot = Get-CrmLocalSourceSnapshot -TargetCommit $targetCommit
    try {
        $manifest = Get-CrmPersonaManifest -Persona $Persona
        if ($null -ne $manifest -and (Test-CrmWslPid -PidValue $manifest.pids.launcher)) {
            $runningSource = Convert-WslPathToWindows -Path ([string]$manifest.worktree)
            $runningCommit = if (Test-Path -LiteralPath $runningSource) { (& git -C $runningSource rev-parse HEAD 2>$null | Select-Object -First 1) } else { $null }
            if ([string]$runningCommit -eq $targetCommit) { return $runningSource }
            throw "O runtime de $Persona está ativo em outra revisão. Execute primeiro a ação principal do CRM Local para atualizá-lo."
        }
        return Sync-CrmLocalSourceRoot -Persona $Persona -TargetCommit $targetCommit -Snapshot $snapshot
    } finally {
        Remove-CrmLocalSourceSnapshot -Snapshot $snapshot
    }
}

function Resolve-CrmLocalModuleSourceRoot {
    param(
        [ValidateSet("Gestor", "Consultor")]
        [string]$Persona = "Gestor"
    )

    # Module-specific launchers do not own the canonical persona manifest, but
    # they must still execute the exact source snapshot selected by this action.
    # Never fall back to the mutable shared checkout here.
    $targetCommit = Get-CrmLocalTargetCommit
    $snapshot = Get-CrmLocalSourceSnapshot -TargetCommit $targetCommit
    try {
        return [pscustomobject]@{
            SourceRoot = Sync-CrmLocalSourceRoot -Persona $Persona -TargetCommit $targetCommit -Snapshot $snapshot
            TargetCommit = $targetCommit
            SourceFingerprint = $snapshot.Fingerprint
        }
    } finally {
        Remove-CrmLocalSourceSnapshot -Snapshot $snapshot
    }
}

function Convert-WslPathToWindows {
    param([string]$Path)
    if ($Path -match '^/mnt/(?<drive>[a-zA-Z])/(?<rest>.*)$') {
        return ("{0}:\{1}" -f $Matches.drive.ToUpperInvariant(), ($Matches.rest -replace '/', '\'))
    }
    return $Path
}

function Get-CrmPersonaRuntimeRoot {
    param([ValidateSet("Gestor", "Consultor")][string]$Persona)
    if ($Persona -eq "Gestor") { return $crmGestorRuntimeRoot }
    return $crmConsultorRuntimeRoot
}

function Get-CrmPersonaManifest {
    param([ValidateSet("Gestor", "Consultor")][string]$Persona)
    $path = Join-Path (Get-CrmPersonaRuntimeRoot -Persona $Persona) "current.json"
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try { return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { return $null }
}

function Test-CrmWslPid {
    param([object]$PidValue)
    $pidText = [string]$PidValue
    if ($pidText -notmatch '^[0-9]+$') { return $false }
    & wsl.exe -d Ubuntu-24.04 -- bash -lc "kill -0 $pidText 2>/dev/null" 2>$null
    return $LASTEXITCODE -eq 0
}

function Test-CrmHttpEndpoint {
    param([string]$Url, [string]$Role)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $Url
        if ($response.StatusCode -ne 200) { return $false }
        if (-not [string]::IsNullOrWhiteSpace($Role)) {
            $payload = $response.Content | ConvertFrom-Json
            return [string]$payload.user.role -eq $Role
        }
        return $true
    } catch { return $false }
}

function Test-CrmPersonaHealth {
    param(
        [ValidateSet("Gestor", "Consultor")][string]$Persona,
        [object]$Manifest = $null
    )
    if ($Persona -eq "Gestor") {
        # The manifest is authoritative for optional services. Atendimento is
        # intentionally a smaller Gestor preview (Pages + PostgreSQL-backed
        # adapter), so requiring unrelated Insumos/Ponto services made every
        # healthy Atendimento launch look stale and restart indefinitely.
        if (-not (Test-CrmHttpEndpoint -Url "http://127.0.0.1:8791/api/auth/me" -Role "GESTOR")) { return $false }
        if ($null -eq $Manifest -or $null -ne $Manifest.ports.insumos) {
            if (-not (Test-CrmHttpEndpoint -Url "http://127.0.0.1:8787/insumos/health")) { return $false }
        }
        if ($null -eq $Manifest -or $null -ne $Manifest.ports.timekeeping) {
            if (-not (Test-CrmHttpEndpoint -Url "http://127.0.0.1:8801/api/ponto/readiness")) { return $false }
        }
        if ($null -eq $Manifest -or $null -ne $Manifest.ports.whatsapp) {
            if (-not (Test-CrmHttpEndpoint -Url "http://127.0.0.1:8110/health")) { return $false }
        }
        return $true
    }
    return (Test-CrmHttpEndpoint -Url "http://127.0.0.1:8792/api/auth/me" -Role "CONSULTOR") -and
        (Test-CrmHttpEndpoint -Url "http://127.0.0.1:8792/api/ponto/readiness")
}

function Get-CrmPersonaDecision {
    param(
        [ValidateSet("Gestor", "Consultor")][string]$Persona,
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [Parameter(Mandatory = $true)][string]$SourceFingerprint,
        [Parameter(Mandatory = $true)][string]$SourceOrigin
    )
    $runtimeRoot = Get-CrmPersonaRuntimeRoot -Persona $Persona
    $manifest = Get-CrmPersonaManifest -Persona $Persona
    $pidAlive = $false
    if ($null -ne $manifest) { $pidAlive = Test-CrmWslPid -PidValue $manifest.pids.launcher }
    $healthy = $false
    if ($pidAlive) { $healthy = Test-CrmPersonaHealth -Persona $Persona -Manifest $manifest }
    $policyWsl = Convert-WindowsPathToWsl -Path (Join-Path $scriptRoot "crm-local-runtime-policy.mjs")
    $manifestWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "current.json")
    $buildStateWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "build-state.json")
    # wsl.exe joins arguments through a shell. Quote every policy input as one
    # Bash literal; otherwise a Windows source origin loses its backslashes and
    # spuriously invalidates an otherwise healthy runtime on its second launch.
    $policyCommand = "node {0} --manifest {1} --build-state {2} --target {3} --source-fingerprint {4} --source-origin {5} --persona {6} --pid-alive {7} --healthy {8}" -f `
        (Convert-ToBashLiteral -Value $policyWsl), `
        (Convert-ToBashLiteral -Value $manifestWsl), `
        (Convert-ToBashLiteral -Value $buildStateWsl), `
        (Convert-ToBashLiteral -Value $TargetCommit), `
        (Convert-ToBashLiteral -Value $SourceFingerprint), `
        (Convert-ToBashLiteral -Value $SourceOrigin), `
        (Convert-ToBashLiteral -Value $Persona.ToUpperInvariant()), `
        (Convert-ToBashLiteral -Value $pidAlive.ToString().ToLowerInvariant()), `
        (Convert-ToBashLiteral -Value $healthy.ToString().ToLowerInvariant())
    $decisionRaw = & wsl.exe -d Ubuntu-24.04 -- bash -lc $policyCommand
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível avaliar o estado do CRM Local ($Persona)." }
    $decision = $decisionRaw | Select-Object -Last 1 | ConvertFrom-Json
    if ([string]$decision.action -eq 'reuse' -and [string]$SourceFingerprint -eq "commit:$TargetCommit" -and $null -ne $manifest -and [string]::IsNullOrWhiteSpace([string]$manifest.sourceFingerprint)) {
        # A legacy canonical manifest has no fingerprint. Before accepting it,
        # prove its worktree still resolves to the exact requested commit. This
        # preserves the snapshot guard while letting an upgraded launcher reuse
        # a healthy canonical runtime instead of rebuilding it indefinitely.
        $legacyWorktree = Convert-WslPathToWindows -Path ([string]$manifest.worktree)
        $legacyCommit = if (Test-Path -LiteralPath $legacyWorktree) { (& git -C $legacyWorktree rev-parse --verify 'HEAD^{commit}' 2>$null | Select-Object -First 1).Trim().ToLowerInvariant() } else { $null }
        if ($legacyCommit -ne $TargetCommit) {
            $decision = [pscustomobject]@{ action = 'restart'; reason = 'legacy_worktree_outdated' }
        }
    }
    return [pscustomobject]@{ Action = [string]$decision.action; Reason = [string]$decision.reason; Manifest = $manifest }
}

function Open-CrmPersonaUrl {
    param([ValidateSet("Gestor", "Consultor")][string]$Persona, [object]$Manifest)
    $fallback = if ($Persona -eq "Gestor") { "http://localhost:8791/" } else { "http://localhost:8792/?module=ponto" }
    $url = if ($null -ne $Manifest -and -not [string]::IsNullOrWhiteSpace([string]$Manifest.url)) { [string]$Manifest.url } else { $fallback }
    $uri = [Uri]$url
    if ($uri.Scheme -ne 'http' -or $uri.Host -notin @('localhost', '127.0.0.1') -or $uri.Port -notin @(8791, 8792)) {
        throw "URL local inválida no manifesto de ${Persona}: '$url'."
    }
    Start-Process $url | Out-Null
    Write-Host "[crm-local] Runtime atualizado de $Persona reutilizado em $url."
}

function Open-CrmModuleUrl {
    param(
        [Parameter(Mandatory = $true)][string]$Module,
        [string]$ExtraQuery = ""
    )
    $url = "http://localhost:8791/?module=$Module"
    if (-not [string]::IsNullOrWhiteSpace($ExtraQuery)) {
        $url = "$url&$ExtraQuery"
    }
    Start-Process $url | Out-Null
    Write-Host "[crm-local] Abrindo o módulo atualizado '$Module' em $url."
}

function Wait-CrmPersonaCurrent {
    param(
        [ValidateSet("Gestor", "Consultor")][string]$Persona,
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [Parameter(Mandatory = $true)][string]$SourceFingerprint,
        [Parameter(Mandatory = $true)][string]$SourceOrigin,
        [int]$TimeoutSeconds = 420
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $decision = Get-CrmPersonaDecision -Persona $Persona -TargetCommit $TargetCommit -SourceFingerprint $SourceFingerprint -SourceOrigin $SourceOrigin
        if ($decision.Action -eq 'reuse') { return $decision }
        if ($decision.Action -notin @('wait', 'start')) { return $decision }
        Start-Sleep -Seconds 2
    }
    return [pscustomobject]@{ Action = 'restart'; Reason = 'startup_timeout'; Manifest = (Get-CrmPersonaManifest -Persona $Persona) }
}

function Wait-CrmAtendimentoReady {
    param(
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [Parameter(Mandatory = $true)][string]$SourceFingerprint,
        [Parameter(Mandatory = $true)][string]$SourceOrigin,
        [int]$TimeoutSeconds = 600
    )
    # The previous manifest is intentionally retained while the selected
    # snapshot is copied to native WSL storage.  Do not interpret that old
    # manifest as a failed new launch; wait until the requested provenance has
    # been written, then apply the normal authenticated health decision.
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $manifest = Get-CrmPersonaManifest -Persona Gestor
        if ($null -ne $manifest -and
            [string]$manifest.targetCommit -eq $TargetCommit -and
            [string]$manifest.sourceFingerprint -eq $SourceFingerprint -and
            (Test-CrmSourceOriginEquivalent -Left ([string]$manifest.sourceOrigin) -Right $SourceOrigin)) {
            $decision = Get-CrmPersonaDecision -Persona Gestor -TargetCommit $TargetCommit -SourceFingerprint $SourceFingerprint -SourceOrigin $SourceOrigin
            if ($decision.Action -eq 'reuse') { return $decision }
            if ($decision.Action -notin @('wait', 'start')) { return $decision }
        }
        Start-Sleep -Seconds 2
    }
    return [pscustomobject]@{ Action = 'restart'; Reason = 'startup_timeout'; Manifest = (Get-CrmPersonaManifest -Persona Gestor) }
}

function Assert-GestorSharedServices {
    $checks = @(
        @{ Name = "autenticação do Gestor"; Url = "http://127.0.0.1:8791/api/auth/me"; Role = "GESTOR" },
        @{ Name = "Insumos"; Url = "http://127.0.0.1:8787/insumos/health" },
        @{ Name = "Timekeeping"; Url = "http://127.0.0.1:8801/api/ponto/readiness" },
        @{ Name = "WhatsApp"; Url = "http://127.0.0.1:8110/health" }
    )
    foreach ($check in $checks) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $check.Url
            if ($response.StatusCode -ne 200) { throw "status $($response.StatusCode)" }
            if ($check.Role) {
                $payload = $response.Content | ConvertFrom-Json
                if ([string]$payload.user.role -ne $check.Role) {
                    throw "papel inesperado '$([string]$payload.user.role)'"
                }
            }
        } catch {
            throw "O CRM Local (Gestor) está incompleto: $($check.Name) não está pronto em $($check.Url). Reinicie a ação CRM – Local (Gestor) antes do Consultor."
        }
    }
}

function Stop-LegacyCrmRuntimeIfNeeded {
    $manifestPath = Join-Path $operatorRuntimeRoot "runtime\crm-local\current.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) { return }
    try { $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { return }
    if ([string]$manifest.persona) { return }
    if ([int]$manifest.ports.pages -ne 8791) { return }
    if (-not (Test-CrmWslPid -PidValue $manifest.pids.launcher)) { return }
    $manifestWorktree = [string]$manifest.worktree
    $legacyProjectRoot = "C:\CodexShared\Projetos\skincos"
    if (-not (Test-Path -LiteralPath $legacyProjectRoot)) { return }
    $legacyProjectWsl = Convert-WindowsPathToWsl -Path $legacyProjectRoot
    if ($manifestWorktree -ne $legacyProjectWsl) { return }

    Write-Host "[crm-local] Encerrando somente o runtime legado identificado antes de iniciar o Gestor canônico."
    $legacyRuntimeRootWsl = Convert-WindowsPathToWsl -Path (Join-Path $operatorRuntimeRoot "runtime\crm-local")
    Invoke-ShortcutWsl -WorkingProjectRoot $legacyProjectRoot -SkipBootstrapCheck -Command ("CRM_PERSONA=LEGACY CRM_RUNTIME_ROOT={0} CRM_PID_FILE={1} CRM_LOG_FILE={2} bash ./scripts/run-local-crm.sh --stop" -f `
        (Convert-ToBashLiteral -Value $legacyRuntimeRootWsl), `
        (Convert-ToBashLiteral -Value $crmLegacyPidWsl), `
        (Convert-ToBashLiteral -Value $crmLegacyLogWsl))
}

function Invoke-RepoPowerShellScript {
    param([string]$ScriptName)

    & (Join-Path $scriptRoot $ScriptName) -ProjectRoot $ProjectRoot
}

function New-MenuOption {
    param(
        [string]$Label,
        [string]$Action
    )

    return [pscustomobject]@{
        Label = $Label
        Action = $Action
    }
}

function Read-MenuSelection {
    param(
        [string]$Title,
        [object[]]$Options,
        [string]$CancelLabel = "Voltar"
    )

    while ($true) {
        Write-Host ""
        Write-Host "== $Title ==" -ForegroundColor Cyan
        for ($index = 0; $index -lt $Options.Count; $index++) {
            Write-Host ("{0}. {1}" -f ($index + 1), $Options[$index].Label)
        }
        Write-Host ("0. {0}" -f $CancelLabel)

        $raw = Read-Host "Escolha uma opcao"
        $choice = 0
        if (-not [int]::TryParse($raw, [ref]$choice)) {
            Write-Host "Digite o numero da opcao desejada." -ForegroundColor Yellow
            continue
        }

        if ($choice -eq 0) {
            return $null
        }

        if ($choice -ge 1 -and $choice -le $Options.Count) {
            return $Options[$choice - 1]
        }

        Write-Host "Opcao invalida." -ForegroundColor Yellow
    }
}

function Pause-AfterMenuAction {
    Write-Host ""
    [void](Read-Host "Pressione ENTER para voltar ao menu")
}

Ensure-LocalState

$websitePid = Join-Path $tmpRoot "website-local-dev.pid"
$websiteLog = Join-Path $logRoot "website-local-dev.log"
$websitePort = Join-Path $tmpRoot "website-local-dev.port"
$sharedRoot = Split-Path (Split-Path $ProjectRoot -Parent) -Parent
$websiteSourceRoot = Join-Path $sharedRoot "Worktrees\skincos\shared\website-local-main"
$crmGestorPid = Join-Path $tmpRoot "crm-local-gestor.pid"
$crmGestorLog = Join-Path $logRoot "crm-local-gestor.log"
$crmConsultorPid = Join-Path $tmpRoot "crm-local-consultor.pid"
$crmConsultorLog = Join-Path $logRoot "crm-local-consultor.log"
$crmLegacyPid = Join-Path $tmpRoot "crm-local-dev.pid"
$crmLegacyLog = Join-Path $logRoot "crm-local-dev.log"
$crmGestorRuntimeRoot = Join-Path $operatorRuntimeRoot "runtime\crm-local\gestor"
$crmConsultorRuntimeRoot = Join-Path $operatorRuntimeRoot "runtime\crm-local\consultor"
$atendimentoPid = Join-Path $tmpRoot "crm-atendimento-local.pid"
$atendimentoLog = Join-Path $logRoot "crm-atendimento-local.log"
$efAppStateRoot = Join-Path $localStateRoot "espacofacial-app"
$efAppArtifactRoot = Join-Path $operatorRuntimeRoot "scraper"
$efAppOutputRoot = Join-Path $efAppArtifactRoot "report"
$efAppDebugRoot = Join-Path $efAppArtifactRoot "debug"
$efAppLogRoot = Join-Path $efAppArtifactRoot "logs"
$efAppChromeProfileRoot = Join-Path $efAppStateRoot "chrome-profile"
$efAppBookingEnvFile = Join-Path $efAppStateRoot "booking_api.env"
$efAppAgendaSyncEnvFile = Join-Path $efAppStateRoot "agenda_sync.env"
$efAppLoginEnvFile = Join-Path $efAppStateRoot "login.env"

$tmpRootWsl = Convert-WindowsPathToWsl -Path $tmpRoot
$websitePidWsl = Convert-WindowsPathToWsl -Path $websitePid
$websiteLogWsl = Convert-WindowsPathToWsl -Path $websiteLog
$websitePortWsl = Convert-WindowsPathToWsl -Path $websitePort
$crmGestorPidWsl = Convert-WindowsPathToWsl -Path $crmGestorPid
$crmGestorLogWsl = Convert-WindowsPathToWsl -Path $crmGestorLog
$crmConsultorPidWsl = Convert-WindowsPathToWsl -Path $crmConsultorPid
$crmConsultorLogWsl = Convert-WindowsPathToWsl -Path $crmConsultorLog
$crmLegacyPidWsl = Convert-WindowsPathToWsl -Path $crmLegacyPid
$crmLegacyLogWsl = Convert-WindowsPathToWsl -Path $crmLegacyLog
$crmGestorRuntimeRootWsl = Convert-WindowsPathToWsl -Path $crmGestorRuntimeRoot
$crmConsultorRuntimeRootWsl = Convert-WindowsPathToWsl -Path $crmConsultorRuntimeRoot
$atendimentoPidWsl = Convert-WindowsPathToWsl -Path $atendimentoPid
$atendimentoLogWsl = Convert-WindowsPathToWsl -Path $atendimentoLog
$efAppOutputRootWsl = Convert-WindowsPathToWsl -Path $efAppOutputRoot

function Stop-CrmPersonaRuntime {
    param([ValidateSet("Gestor", "Consultor")][string]$Persona)
    $manifest = Get-CrmPersonaManifest -Persona $Persona
    if ($null -eq $manifest) { return }

    $manifestWorktree = [string]$manifest.worktree
    $sourceRoot = Convert-WslPathToWindows -Path $manifestWorktree
    $runtimeRootWsl = Convert-WindowsPathToWsl -Path (Get-CrmPersonaRuntimeRoot -Persona $Persona)
    if ($Persona -eq "Gestor") {
        $command = "CRM_PERSONA=GESTOR CRM_RUNTIME_ROOT={0} CRM_WITH_INSUMOS=1 CRM_WITH_TIMEKEEPING=1 CRM_WITH_WHATSAPP=1 CRM_PID_FILE={1} CRM_LOG_FILE={2} bash ./scripts/run-local-crm.sh --stop" -f `
            (Convert-ToBashLiteral -Value $runtimeRootWsl), `
            (Convert-ToBashLiteral -Value $crmGestorPidWsl), `
            (Convert-ToBashLiteral -Value $crmGestorLogWsl)
    } else {
        $command = "CRM_PERSONA=CONSULTOR CRM_RUNTIME_ROOT={0} CRM_VITE_PORT=5174 CRM_PAGES_PORT=8792 CRM_WITH_INSUMOS=0 CRM_WITH_TIMEKEEPING=0 CRM_WITH_WHATSAPP=0 CRM_PID_FILE={1} CRM_LOG_FILE={2} bash ./scripts/run-local-crm.sh --stop" -f `
            (Convert-ToBashLiteral -Value $runtimeRootWsl), `
            (Convert-ToBashLiteral -Value $crmConsultorPidWsl), `
            (Convert-ToBashLiteral -Value $crmConsultorLogWsl)
    }

    if ($manifestWorktree -match '^/home/admin/\.local/state/skincos/crm-local-preview-source/[A-Za-z0-9._-]+$') {
        Invoke-ShortcutWslNativePreview -WorkingDirectory $manifestWorktree -Command $command
        return
    }

    $allowedSourceRoot = Join-Path $operatorRuntimeRoot "source"
    $resolvedSource = if (Test-Path -LiteralPath $sourceRoot) { (Resolve-Path -LiteralPath $sourceRoot).Path } else { $null }
    if ($null -eq $resolvedSource -or -not $resolvedSource.StartsWith($allowedSourceRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "O runtime de $Persona aponta para um worktree não autorizado: '$sourceRoot'."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedSource "scripts\run-local-crm.sh"))) {
        throw "O launcher do runtime de $Persona não existe em '$resolvedSource'."
    }
    Invoke-ShortcutWsl -WorkingProjectRoot $resolvedSource -SkipBootstrapCheck -Command $command
}

function Start-CrmPersonaRuntime {
    param(
        [ValidateSet("Gestor", "Consultor")][string]$Persona,
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [Parameter(Mandatory = $true)][string]$SourceFingerprint,
        [Parameter(Mandatory = $true)][string]$SourceOrigin
    )
    $targetLiteral = Convert-ToBashLiteral -Value $TargetCommit
    if ($Persona -eq "Gestor") {
        $command = "CRM_PERSONA=GESTOR CRM_TARGET_COMMIT={0} CRM_SOURCE_FINGERPRINT={1} CRM_SOURCE_ORIGIN={2} CRM_RUNTIME_ROOT={3} LOCAL_AUTH_BYPASS=true LOCAL_AUTH_TEST_USER_ADMIN=true LOCAL_AUTH_ROLE=GESTOR LOCAL_AUTH_EMAIL=dev@local.test LOCAL_AUTH_NAME='Gestor Local' CRM_WITH_INSUMOS=1 CRM_WITH_TIMEKEEPING=1 CRM_WITH_WHATSAPP=1 CRM_BUILD_BEFORE_START=1 CRM_OPEN_BROWSER=1 CRM_PID_FILE={4} CRM_LOG_FILE={5} bash ./scripts/run-local-crm.sh" -f `
            $targetLiteral, `
            (Convert-ToBashLiteral -Value $SourceFingerprint), `
            (Convert-ToBashLiteral -Value $SourceOrigin), `
            (Convert-ToBashLiteral -Value $crmGestorRuntimeRootWsl), `
            (Convert-ToBashLiteral -Value $crmGestorPidWsl), `
            (Convert-ToBashLiteral -Value $crmGestorLogWsl)
    } else {
        $command = "CRM_PERSONA=CONSULTOR CRM_TARGET_COMMIT={0} CRM_SOURCE_FINGERPRINT={1} CRM_SOURCE_ORIGIN={2} CRM_RUNTIME_ROOT={3} LOCAL_AUTH_BYPASS=true LOCAL_AUTH_TEST_USER_ADMIN=false LOCAL_AUTH_ROLE=CONSULTOR LOCAL_AUTH_EMAIL=consultor.local@local.test LOCAL_AUTH_USERNAME=consultor-local LOCAL_AUTH_NAME='Consultor Local' LOCAL_AUTH_ALLOWED_MODULES=atendimento,ponto CRM_VITE_PORT=5174 CRM_PAGES_PORT=8792 CRM_WITH_INSUMOS=0 CRM_WITH_TIMEKEEPING=0 CRM_WITH_WHATSAPP=0 PONTO_API_TARGET=http://127.0.0.1:8801 PONTO_ACTOR_HMAC_KEY=test-actor-key-not-secret LOCAL_INSUMOS_API_TARGET=http://127.0.0.1:8787 LOCAL_WA_ORCHESTRATOR_API_TARGET=http://127.0.0.1:8110 CRM_BUILD_BEFORE_START=1 CRM_OPEN_BROWSER=1 CRM_PID_FILE={4} CRM_LOG_FILE={5} bash ./scripts/run-local-crm.sh --module ponto" -f `
            $targetLiteral, `
            (Convert-ToBashLiteral -Value $SourceFingerprint), `
            (Convert-ToBashLiteral -Value $SourceOrigin), `
            (Convert-ToBashLiteral -Value $crmConsultorRuntimeRootWsl), `
            (Convert-ToBashLiteral -Value $crmConsultorPidWsl), `
            (Convert-ToBashLiteral -Value $crmConsultorLogWsl)
    }
    Invoke-ShortcutWsl -WorkingProjectRoot $SourceRoot -SkipBootstrapCheck -Command $command
}

function Start-CrmAtendimentoRuntime {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [Parameter(Mandatory = $true)][string]$SourceFingerprint,
        [Parameter(Mandatory = $true)][string]$SourceOrigin
    )
    $snapshotId = ($SourceFingerprint -split ':')[-1]
    if ([string]::IsNullOrWhiteSpace($snapshotId) -or $snapshotId.Length -lt 12) {
        throw "Fingerprint inválido para a prévia isolada de Atendimento: '$SourceFingerprint'."
    }
    $nativeAtendimentoSource = "/home/admin/.local/state/skincos/crm-local-preview-source/atendimento-{0}-{1}" -f `
        $TargetCommit.Substring(0, 12), $snapshotId.Substring(0, 12)
    # WSL owns the child process tree of a non-interactive client, so a nohup
    # handoff would be killed with that client. Keep the durable PowerShell
    # supervisor attached to the WSL launcher; a 143 is only accepted here
    # because the exact manifest health gate below still has to pass.
    $command = "CRM_PERSONA=GESTOR CRM_TARGET_COMMIT={0} CRM_SOURCE_FINGERPRINT={1} CRM_SOURCE_ORIGIN={2} CRM_RUNTIME_ROOT={3} CRM_LOCAL_NATIVE_SOURCE_ROOT={4} LOCAL_AUTH_BYPASS=true LOCAL_AUTH_TEST_USER_ADMIN=true LOCAL_AUTH_ROLE=GESTOR LOCAL_AUTH_EMAIL=dev@local.test LOCAL_AUTH_NAME='Gestor Local' CRM_WITH_INSUMOS=0 CRM_WITH_TIMEKEEPING=0 CRM_WITH_WHATSAPP=1 CRM_BUILD_BEFORE_START=1 CRM_OPEN_BROWSER=0 CRM_PID_FILE={5} CRM_LOG_FILE={6} bash ./scripts/run-local-atendimento.sh" -f `
        (Convert-ToBashLiteral -Value $TargetCommit), `
        (Convert-ToBashLiteral -Value $SourceFingerprint), `
        (Convert-ToBashLiteral -Value $SourceOrigin), `
        (Convert-ToBashLiteral -Value $crmGestorRuntimeRootWsl), `
        (Convert-ToBashLiteral -Value $nativeAtendimentoSource), `
        (Convert-ToBashLiteral -Value $atendimentoPidWsl), `
        (Convert-ToBashLiteral -Value $atendimentoLogWsl)
    Invoke-ShortcutWsl -WorkingProjectRoot $SourceRoot -SkipBootstrapCheck -AcceptedExitCode @(0, 143) -Command $command
}

function Start-CrmAtendimentoBackgroundUpdate {
    $outLog = Join-Path $logRoot "crm-local-atendimento-action.out.log"
    $errLog = Join-Path $logRoot "crm-local-atendimento-action.err.log"
    $arguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
        '-Action', 'CrmAtendimento', '-ProjectRoot', $ProjectRoot,
        '-CrmAtendimentoDetachedStart'
    )
    Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null
    Write-Host "[crm-local] Inicialização persistente de Atendimento iniciada em segundo plano."
}

function Invoke-CrmAtendimentoAction {
    # run-local-crm owns its child services and waits for the Pages process.
    # Start it from a durable child PowerShell so closing the Codex action or
    # the invoking terminal cannot trigger its EXIT cleanup and tear down a
    # healthy preview. The child re-enters this function once with the switch,
    # retaining the exact persisted preview selection and snapshot fingerprint.
    if (-not $CrmAtendimentoDetachedStart) {
        Start-CrmAtendimentoBackgroundUpdate
        return
    }
    $targetCommit = Get-CrmLocalTargetCommit
    $snapshot = Get-CrmLocalSourceSnapshot -TargetCommit $targetCommit
    try {
        $sourceOrigin = Get-CrmLocalSourceOrigin -Snapshot $snapshot -Module 'atendimento'
        $decision = Get-CrmPersonaDecision -Persona Gestor -TargetCommit $targetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin
        if ($decision.Action -eq 'reuse') {
            Open-CrmModuleUrl -Module 'atendimento' -ExtraQuery 'metaAdsLocalScenario=connected-ready'
            return
        }
        if ($decision.Action -eq 'wait') {
            Write-Host '[crm-local] A inicialização de Atendimento para o snapshot atual já está em andamento; aguardando.'
            $decision = Wait-CrmPersonaCurrent -Persona Gestor -TargetCommit $targetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin
            if ($decision.Action -eq 'reuse') {
                Open-CrmModuleUrl -Module 'atendimento' -ExtraQuery 'metaAdsLocalScenario=connected-ready'
                return
            }
        }
        if ($decision.Action -eq 'restart') {
            Write-Host "[crm-local] Reiniciando Atendimento: $($decision.Reason)."
            Stop-CrmPersonaRuntime -Persona Gestor
        }
        $sourceRoot = Sync-CrmLocalSourceRoot -Persona Gestor -TargetCommit $targetCommit -Snapshot $snapshot
        Start-CrmAtendimentoRuntime -SourceRoot $sourceRoot -TargetCommit $targetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin
        $ready = Wait-CrmAtendimentoReady -TargetCommit $targetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin -TimeoutSeconds 600
        if ($ready.Action -ne 'reuse') {
            throw "A prévia de Atendimento não ficou pronta no snapshot $($snapshot.Fingerprint): $($ready.Reason)."
        }
        Open-CrmModuleUrl -Module 'atendimento' -ExtraQuery 'metaAdsLocalScenario=connected-ready'
    } finally {
        Remove-CrmLocalSourceSnapshot -Snapshot $snapshot
    }
}

function Invoke-CrmPersonaAction {
    param(
        [ValidateSet("Gestor", "Consultor")][string]$Persona,
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [string]$Module = 'crm-shell'
    )
    $snapshot = Get-CrmLocalSourceSnapshot -TargetCommit $TargetCommit
    try {
        $sourceOrigin = Get-CrmLocalSourceOrigin -Snapshot $snapshot -Module $Module
        $decision = Get-CrmPersonaDecision -Persona $Persona -TargetCommit $TargetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin
        if ($decision.Action -eq 'reuse') {
            Open-CrmPersonaUrl -Persona $Persona -Manifest $decision.Manifest
            return
        }
        if ($decision.Action -eq 'wait') {
            Write-Host "[crm-local] A inicialização de $Persona para o commit atual já está em andamento; aguardando."
            $decision = Wait-CrmPersonaCurrent -Persona $Persona -TargetCommit $TargetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin
            if ($decision.Action -eq 'reuse') {
                Open-CrmPersonaUrl -Persona $Persona -Manifest $decision.Manifest
                return
            }
        }
        if ($decision.Action -eq 'restart') {
            Write-Host "[crm-local] Reiniciando ${Persona}: $($decision.Reason)."
            Stop-CrmPersonaRuntime -Persona $Persona
        }
        $sourceRoot = Sync-CrmLocalSourceRoot -Persona $Persona -TargetCommit $TargetCommit -Snapshot $snapshot
        Start-CrmPersonaRuntime -Persona $Persona -SourceRoot $sourceRoot -TargetCommit $TargetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin
    } finally {
        Remove-CrmLocalSourceSnapshot -Snapshot $snapshot
    }
}

function Start-CrmGestorBackgroundUpdate {
    param([Parameter(Mandatory = $true)][string]$TargetCommit)
    $outLog = Join-Path $logRoot "crm-local-gestor-action.out.log"
    $errLog = Join-Path $logRoot "crm-local-gestor-action.err.log"
    $arguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
        '-Action', 'CrmLocal', '-ProjectRoot', $ProjectRoot
    )
    $previousReviewRef = $env:CRM_LOCAL_REVIEW_REF
    try {
        $env:CRM_LOCAL_REVIEW_REF = $TargetCommit
        Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden `
            -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null
    } finally {
        $env:CRM_LOCAL_REVIEW_REF = $previousReviewRef
    }
    Write-Host "[crm-consultor] Atualização do Gestor iniciada em segundo plano para $TargetCommit."
}

function Ensure-CrmGestorForConsultor {
    param([Parameter(Mandatory = $true)][string]$TargetCommit)
    $snapshot = Get-CrmLocalSourceSnapshot -TargetCommit $TargetCommit
    try {
        $sourceOrigin = Get-CrmLocalSourceOrigin -Snapshot $snapshot -Module 'crm-shell'
        $decision = Get-CrmPersonaDecision -Persona Gestor -TargetCommit $TargetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin
        if ($decision.Action -eq 'reuse') { return }
        if ($decision.Action -eq 'wait') {
            $decision = Wait-CrmPersonaCurrent -Persona Gestor -TargetCommit $TargetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin
            if ($decision.Action -eq 'reuse') { return }
        }
        if ($decision.Action -eq 'restart') { Stop-CrmPersonaRuntime -Persona Gestor }
        Start-CrmGestorBackgroundUpdate -TargetCommit $TargetCommit
        $ready = Wait-CrmPersonaCurrent -Persona Gestor -TargetCommit $TargetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin -TimeoutSeconds 600
        if ($ready.Action -ne 'reuse') {
            throw "O Gestor não ficou pronto no commit $TargetCommit. Consulte '$logRoot\crm-local-gestor-action.err.log'."
        }
    } finally {
        Remove-CrmLocalSourceSnapshot -Snapshot $snapshot
    }
}

foreach ($path in @(
    $efAppStateRoot,
    $efAppOutputRoot,
    $efAppDebugRoot,
    $efAppLogRoot,
    $efAppChromeProfileRoot
)) {
    if (-not (Test-Path -LiteralPath $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

$efAppEnvVars = @(
    "EF_OUTPUT_DIR=$efAppOutputRoot",
    "EF_DEBUG_DIR=$efAppDebugRoot",
    "EF_LOG_DIR=$efAppLogRoot",
    "EF_CHROME_USER_DATA_DIR=$efAppChromeProfileRoot",
    "EF_BOOKING_ENV_FILE=$efAppBookingEnvFile",
    "EF_AGENDA_SYNC_ENV_FILE=$efAppAgendaSyncEnvFile",
    "EF_LOGIN_ENV_FILE=$efAppLoginEnvFile"
)

function Invoke-EfAppPythonMode {
    param(
        [string]$Mode,
        [string[]]$ExtraEnvVar = @(),
        [switch]$Headed
    )

    $headlessValue = if ($Headed) { "HEADLESS=0" } else { "HEADLESS=1" }
    Invoke-ShortcutWsl `
        -EnvVar ($efAppEnvVars + @("EF_MODE=$Mode", $headlessValue) + $ExtraEnvVar) `
        -SkipNodeCheck `
        -SkipNpmCheck `
        -Command "cd integration/ef && if [[ ! -x ./.venv/bin/python ]]; then echo 'Scraper venv is missing. Run EF App Setup first.'; exit 1; fi && ./.venv/bin/python run_scraper.py"
}

function Invoke-ShortcutActionInternal {
    param([string]$SelectedAction)

    switch ($SelectedAction) {
        "SharedSetup" { Invoke-RepoPowerShellScript -ScriptName "setup-shared-codex-workspace.ps1" }
        "SharedValidate" { Invoke-RepoPowerShellScript -ScriptName "validate-shared-codex-workspace.ps1" }
        "RuntimeSetup" { & (Join-Path $scriptRoot "setup-shared-runtime.ps1") }
        "RuntimeValidate" { & (Join-Path $scriptRoot "validate-shared-runtime.ps1") }
        "WslAccountBootstrap" {
            Invoke-ShortcutWsl -SkipBootstrapCheck -Command "cd orb/engine && bash scripts/bootstrap-imported-wsl-account.sh"
        }
        "GitHubAuthLoginWsl" {
            Invoke-ShortcutWsl `
                -SkipBootstrapCheck `
                -SkipNodeCheck `
                -SkipNpmCheck `
                -SkipGitCheck `
                -Command "gh auth login --web --git-protocol https --hostname github.com && gh auth status"
        }
        "GitHubAuthStatus" {
            & (Join-Path $scriptRoot "show-github-auth-status.ps1") -ProjectRoot $ProjectRoot
        }
        "SharedStatus" { Invoke-RepoPowerShellScript -ScriptName "show-shared-codex-status.ps1" }
        "CodexContext" { Invoke-ShortcutWsl -Command "bash ./scripts/codex-context.sh" }
        "CodexContextOnline" { Invoke-ShortcutWsl -Command "bash ./scripts/codex-context.sh --online" }
        "ThreadBootstrap" { & (Join-Path $scriptRoot "print-codex-thread-bootstrap.ps1") -Interactive }
        "NewWorktree" { & (Join-Path $scriptRoot "new-shared-worktree.ps1") -Fetch }
        "WebsiteLocalStart" {
            $websiteSourceWsl = Convert-ToBashLiteral -Value (Convert-WindowsPathToWsl -Path $websiteSourceRoot)
            $websiteLocalCommand = 'mkdir -p "$HOME/.cache/skincos-local-root/website" && rsync -a --delete --exclude node_modules --exclude .next {0}/website/ "$HOME/.cache/skincos-local-root/website/" && WEBSITE_SOURCE_ROOT="$HOME/.cache/skincos-local-root" WEBSITE_SKIP_WORKERD_CHECK=0 WEBSITE_STATE_DIR={1} WEBSITE_PID_FILE={2} WEBSITE_LOG_FILE={3} WEBSITE_PORT_FILE={4} WEBSITE_DETACH=1 OPEN_BROWSER=0 bash ./scripts/run-local-website.sh' -f `
                $websiteSourceWsl, `
                (Convert-ToBashLiteral -Value $tmpRootWsl), `
                (Convert-ToBashLiteral -Value $websitePidWsl), `
                (Convert-ToBashLiteral -Value $websiteLogWsl), `
                (Convert-ToBashLiteral -Value $websitePortWsl)
            Invoke-ShortcutWsl -Command $websiteLocalCommand
        }
        "WebsiteLocalStop" {
            Invoke-ShortcutWsl -Command ('WEBSITE_SOURCE_ROOT="$HOME/.cache/skincos-local-root" WEBSITE_STATE_DIR={0} WEBSITE_PID_FILE={1} WEBSITE_PORT_FILE={2} bash ./scripts/run-local-website.sh --stop' -f `
                (Convert-ToBashLiteral -Value $tmpRootWsl), `
                (Convert-ToBashLiteral -Value $websitePidWsl), `
                (Convert-ToBashLiteral -Value $websitePortWsl))
        }
        "WebsiteSiteCheck" { Invoke-ShortcutWsl -Command "npm run codex:site:check" }
        "WebsiteReleaseCheck" { Invoke-ShortcutWsl -Command "npm run codex:site:release-check" }
        "CrmLocal" {
            Stop-LegacyCrmRuntimeIfNeeded
            $targetCommit = Get-CrmLocalTargetCommit
            Invoke-CrmPersonaAction -Persona Gestor -TargetCommit $targetCommit
        }
        "CrmConsultor" {
            $targetCommit = Get-CrmLocalTargetCommit
            Ensure-CrmGestorForConsultor -TargetCommit $targetCommit
            Assert-GestorSharedServices
            Invoke-CrmPersonaAction -Persona Consultor -TargetCommit $targetCommit -Module 'ponto'
        }
        "CrmConsultorStop" {
            Stop-CrmPersonaRuntime -Persona Consultor
        }
        "CrmSiteEf" {
            $targetCommit = Get-CrmLocalTargetCommit
            Invoke-CrmPersonaAction -Persona Gestor -TargetCommit $targetCommit -Module 'site-tracking'
            Open-CrmModuleUrl -Module "site-tracking" -ExtraQuery "metaAdsLocalScenario=connected-ready"
        }
        "CrmMetaAds" {
            $targetCommit = Get-CrmLocalTargetCommit
            Invoke-CrmPersonaAction -Persona Gestor -TargetCommit $targetCommit -Module 'meta-ads'
            Open-CrmModuleUrl -Module "meta-ads" -ExtraQuery "metaAdsLocalScenario=connected-ready"
        }
        "CrmFinance" {
            Invoke-ShortcutWsl -AcceptedExitCode @(0, 130, 143) -Command "npm run crm:local:finance"
        }
        "CrmAtendimento" {
            Invoke-CrmAtendimentoAction
        }
        "CrmAtendimentoMirrorStatus" { Invoke-ShortcutWsl -Command "npm run codex:crm:atendimento-mirror-status" }
        "CrmAtendimentoMirrorSync" { Invoke-ShortcutWsl -Command "npm run codex:crm:atendimento-mirror-sync -- --apply" }
        "CrmLocalStop" {
            Invoke-ShortcutWsl -Command "npm run crm:local:finance:stop"
            Stop-CrmPersonaRuntime -Persona Gestor
            Stop-LegacyCrmRuntimeIfNeeded
        }
        "CrmMemory" { Invoke-ShortcutWsl -Command "bash ./scripts/codex-memory-crm.sh" }
        "CrmSiteSmoke" { Invoke-ShortcutWsl -Command "npm run codex:crm:site-smoke" }
        "CrmMetaAdsSmoke" { Invoke-ShortcutWsl -Command "npm run codex:crm:meta-ads-smoke" }
        "CrmFinanceSmoke" { Invoke-ShortcutWsl -Command "npm run codex:crm:finance-smoke" }
        "CrmAtendimentoSmoke" { Invoke-ShortcutWsl -Command "npm run codex:crm:atendimento-smoke" }
        "PlatformLocalStart" { Invoke-ShortcutWsl -Command "OPEN_BROWSER=0 bash ./backend/scripts/dev.sh watch" }
        "EfAppSetup" {
            Invoke-ShortcutWsl `
                -EnvVar $efAppEnvVars `
                -SkipNodeCheck `
                -SkipNpmCheck `
                -Command "cd integration/ef && if ! command -v python3 >/dev/null 2>&1; then echo 'python3 is not available in WSL. Install Python 3 before using the Espaço Facial app automations.'; exit 1; fi && if [[ ! -d .venv ]]; then python3 -m venv .venv; fi && ./.venv/bin/python -m pip install --upgrade pip && ./.venv/bin/pip install -r requirements.lock"
        }
        "EfAppSelftest" {
            Invoke-ShortcutWsl `
                -EnvVar ($efAppEnvVars + @("HEADLESS=1")) `
                -SkipNodeCheck `
                -SkipNpmCheck `
                -Command "cd integration/ef && if [[ ! -x ./.venv/bin/python ]]; then echo 'Scraper venv is missing. Run EF App Setup first.'; exit 1; fi && ./.venv/bin/python selftest.py"
        }
        "EfAppCaixa" { Invoke-EfAppPythonMode -Mode "caixa" }
        "EfAppAgendaDelta" { Invoke-EfAppPythonMode -Mode "agenda_delta" }
        "EfAppAgendaFullSync" {
            Invoke-ShortcutWsl `
                -EnvVar ($efAppEnvVars + @("HEADLESS=1", "EF_OUTPUT_BASE_DIR=$efAppOutputRoot")) `
                -SkipNodeCheck `
                -SkipNpmCheck `
                -Command "cd integration/ef && if [[ ! -x ./.venv/bin/python ]]; then echo 'Scraper venv is missing. Run EF App Setup first.'; exit 1; fi && bash ./run_agenda_full_sync_all_units.sh"
        }
        "EfAppBookingApi" { Invoke-EfAppPythonMode -Mode "booking_api" }
        "EfAppProcedures" { Invoke-EfAppPythonMode -Mode "procedures" }
        "EfAppClientRegistration" {
            throw "The client registration export is still documented in integration/ef/README.md, but no runnable implementation is wired in run_scraper.py yet."
        }
        "EfAppRecorder" { Invoke-EfAppPythonMode -Mode "recorder" -Headed }
        "EfAppRotateAgendaSyncToken" {
            Invoke-ShortcutWsl `
                -EnvVar $efAppEnvVars `
                -Command "cd integration/ef && bash ./scripts/rotate_agenda_sync_token.sh --website-dir ../../../../website"
        }
        "OrbStatus" {
            Invoke-ShortcutWsl -Command "bash scripts/runtime/manage-native-runtime.sh status"
        }
        "OrbRestart" {
            Invoke-ShortcutWsl -Command "bash scripts/runtime/manage-native-runtime.sh restart"
        }
        "OrbRepair" {
            Invoke-ShortcutWsl -Command "bash scripts/runtime/prepare-lifecycle-layout.sh --apply && bash scripts/runtime/install-lifecycle-units.sh --apply && bash scripts/runtime/manage-native-runtime.sh restart && bash scripts/runtime/manage-native-runtime.sh validate"
        }
        "OrbLogs" {
            Invoke-ShortcutWsl -Command "bash scripts/runtime/manage-native-runtime.sh logs 200"
        }
        "MetaAdsPublishPreflight" {
            Invoke-ShortcutWsl -Command "cd orb/engine && bash scripts/validate-meta-ads-publish-preflight.sh"
        }
        "OrbValidate" {
            Invoke-ShortcutWsl -Command "bash scripts/runtime/manage-native-runtime.sh validate"
        }
        "OrbBusinessValidate" {
            Invoke-ShortcutWsl -Command "cd orb/engine && bash scripts/validate-mini-pc-business-readiness.sh"
        }
        "OrbAudit" {
            Invoke-ShortcutWsl -Command "cd orb/engine && bash scripts/audit-mini-pc-service-footprint.sh"
        }
        "OrbSupportServicesApply" {
            Invoke-ShortcutWsl -Command "bash ./scripts/runtime/install-lifecycle-units.sh --apply"
        }
        "OrbImportClinicWorkflowsLive" {
            $importChoice = Read-MenuSelection `
                -Title "Import Clinic Workflows Live" `
                -Options @(
                    (New-MenuOption -Label "Dry Run" -Action "DryRun"),
                    (New-MenuOption -Label "Apply" -Action "Apply")
                ) `
                -CancelLabel "Cancelar"
            if ($null -eq $importChoice) {
                return
            }

            $projectId = Read-Host "Project ID do n8n live (ENTER para detectar automaticamente)"
            $applyFlag = if ($importChoice.Action -eq "Apply") { " --apply" } else { "" }
            $projectArg = if ([string]::IsNullOrWhiteSpace($projectId)) {
                ""
            }
            else {
                " --project-id " + (Convert-ToBashLiteral -Value $projectId)
            }

            Invoke-ShortcutWsl -Command ("cd orb/engine && bash scripts/import-clinic-workflows-live.sh{0}{1}" -f $applyFlag, $projectArg)
        }
        "WorkspaceMenu" { Show-WorkspaceMenu }
        "ContextMenu" { Show-ContextMenu }
        "LocalMenu" { Show-LocalMenu }
        "EfAppMenu" { Show-EfAppMenu }
        "OrbMenu" { Show-OrbMenu }
        default {
            throw "Unsupported action: $SelectedAction"
        }
    }
}

function Invoke-MenuAction {
    param([string]$SelectedAction)

    try {
        Invoke-ShortcutActionInternal -SelectedAction $SelectedAction
    }
    catch {
        Write-Host ""
        Write-Host ("ERRO: {0}" -f $_.Exception.Message) -ForegroundColor Red
    }

    if ($SelectedAction -notin @("WorkspaceMenu", "ContextMenu", "LocalMenu", "EfAppMenu", "OrbMenu")) {
        Pause-AfterMenuAction
    }
}

function Show-WorkspaceMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "Workspace" `
            -Options @(
                (New-MenuOption -Label "Shared Setup" -Action "SharedSetup"),
                (New-MenuOption -Label "Shared Validate" -Action "SharedValidate"),
                (New-MenuOption -Label "Runtime Setup" -Action "RuntimeSetup"),
                (New-MenuOption -Label "Runtime Validate" -Action "RuntimeValidate"),
                (New-MenuOption -Label "WSL Account Bootstrap" -Action "WslAccountBootstrap"),
                (New-MenuOption -Label "GitHub Auth Login (WSL)" -Action "GitHubAuthLoginWsl"),
                (New-MenuOption -Label "GitHub Auth Status" -Action "GitHubAuthStatus")
            )
        if ($null -eq $selection) {
            return
        }
        Invoke-MenuAction -SelectedAction $selection.Action
    }
}

function Show-ContextMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "Contexto" `
            -Options @(
                (New-MenuOption -Label "Shared Status" -Action "SharedStatus"),
                (New-MenuOption -Label "Codex Context" -Action "CodexContext"),
                (New-MenuOption -Label "Codex Context Online" -Action "CodexContextOnline"),
                (New-MenuOption -Label "Thread Bootstrap" -Action "ThreadBootstrap"),
                (New-MenuOption -Label "New Worktree" -Action "NewWorktree")
            )
        if ($null -eq $selection) {
            return
        }
        Invoke-MenuAction -SelectedAction $selection.Action
    }
}

function Show-WebsiteMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "Local > Website" `
            -Options @(
                (New-MenuOption -Label "Start" -Action "WebsiteLocalStart"),
                (New-MenuOption -Label "Stop" -Action "WebsiteLocalStop"),
                (New-MenuOption -Label "Site Check" -Action "WebsiteSiteCheck"),
                (New-MenuOption -Label "Release Check" -Action "WebsiteReleaseCheck")
            )
        if ($null -eq $selection) {
            return
        }
        Invoke-MenuAction -SelectedAction $selection.Action
    }
}

function Show-CrmMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "Local > CRM" `
            -Options @(
                (New-MenuOption -Label "CRM – Local (Gestor)" -Action "CrmLocal"),
                (New-MenuOption -Label "CRM – Consultor (Ponto)" -Action "CrmConsultor"),
                (New-MenuOption -Label "CRM – Consultor Stop" -Action "CrmConsultorStop"),
                (New-MenuOption -Label "CRM Site EF" -Action "CrmSiteEf"),
                (New-MenuOption -Label "CRM Meta Ads" -Action "CrmMetaAds"),
                (New-MenuOption -Label "CRM Financeiro" -Action "CrmFinance"),
                (New-MenuOption -Label "CRM Atendimento" -Action "CrmAtendimento"),
                (New-MenuOption -Label "CRM Atendimento - Status do Clone" -Action "CrmAtendimentoMirrorStatus"),
                (New-MenuOption -Label "CRM Atendimento - Atualizar Clone" -Action "CrmAtendimentoMirrorSync"),
                (New-MenuOption -Label "CRM Local (Gestor) Stop" -Action "CrmLocalStop"),
                (New-MenuOption -Label "CRM Memory" -Action "CrmMemory"),
                (New-MenuOption -Label "CRM Site Smoke" -Action "CrmSiteSmoke"),
                (New-MenuOption -Label "CRM Meta Ads Smoke" -Action "CrmMetaAdsSmoke"),
                (New-MenuOption -Label "CRM Financeiro Smoke" -Action "CrmFinanceSmoke"),
                (New-MenuOption -Label "CRM Atendimento Smoke" -Action "CrmAtendimentoSmoke")
            )
        if ($null -eq $selection) {
            return
        }
        Invoke-MenuAction -SelectedAction $selection.Action
    }
}

function Show-LocalMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "Local" `
            -Options @(
                (New-MenuOption -Label "Website" -Action "ShowWebsiteMenu"),
                (New-MenuOption -Label "CRM" -Action "ShowCrmMenu"),
                (New-MenuOption -Label "Platform Local" -Action "PlatformLocalStart")
            )
        if ($null -eq $selection) {
            return
        }

        switch ($selection.Action) {
            "ShowWebsiteMenu" { Show-WebsiteMenu }
            "ShowCrmMenu" { Show-CrmMenu }
            default { Invoke-MenuAction -SelectedAction $selection.Action }
        }
    }
}

function Show-EfAppMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "EF App" `
            -Options @(
                (New-MenuOption -Label "Setup" -Action "EfAppSetup"),
                (New-MenuOption -Label "Selftest" -Action "EfAppSelftest"),
                (New-MenuOption -Label "Caixa" -Action "EfAppCaixa"),
                (New-MenuOption -Label "Agenda Delta" -Action "EfAppAgendaDelta"),
                (New-MenuOption -Label "Agenda Full Sync" -Action "EfAppAgendaFullSync"),
                (New-MenuOption -Label "Booking API" -Action "EfAppBookingApi"),
                (New-MenuOption -Label "Procedures" -Action "EfAppProcedures"),
                (New-MenuOption -Label "Client Registration" -Action "EfAppClientRegistration"),
                (New-MenuOption -Label "Recorder" -Action "EfAppRecorder"),
                (New-MenuOption -Label "Rotate Agenda Sync Token" -Action "EfAppRotateAgendaSyncToken")
            )
        if ($null -eq $selection) {
            return
        }
        Invoke-MenuAction -SelectedAction $selection.Action
    }
}

function Show-OrbMenu {
    while ($true) {
        $selection = Read-MenuSelection `
            -Title "Orb" `
            -Options @(
                (New-MenuOption -Label "Status" -Action "OrbStatus"),
                (New-MenuOption -Label "Restart" -Action "OrbRestart"),
                (New-MenuOption -Label "Logs" -Action "OrbLogs"),
                (New-MenuOption -Label "Meta Ads Publish Preflight" -Action "MetaAdsPublishPreflight"),
                (New-MenuOption -Label "Validate" -Action "OrbValidate"),
                (New-MenuOption -Label "Business Validate" -Action "OrbBusinessValidate"),
                (New-MenuOption -Label "Audit" -Action "OrbAudit"),
                (New-MenuOption -Label "Repair" -Action "OrbRepair"),
                (New-MenuOption -Label "Support Services Apply" -Action "OrbSupportServicesApply"),
                (New-MenuOption -Label "Import Clinic Workflows Live" -Action "OrbImportClinicWorkflowsLive")
            )
        if ($null -eq $selection) {
            return
        }
        Invoke-MenuAction -SelectedAction $selection.Action
    }
}

Invoke-ShortcutActionInternal -SelectedAction $Action
