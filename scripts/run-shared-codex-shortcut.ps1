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
        "CrmModules",
        "CrmThreadPreview",
        "CrmUsersThreadPreview",
        "CrmModule",
        "CrmModuleStop",
        "CrmConsultor",
        "CrmConsultorStop",
        "CrmSiteEf",
        "CrmMetaAds",
        "CrmFinance",
        "CrmAtendimento",
        "CrmAtendimentoMirrorPreflight",
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
    [ValidateSet("Gestor", "Consultor")]
    [string]$CrmRole,
    [ValidatePattern('^[a-z0-9]+(?:-[a-z0-9]+)*$')]
    [string]$CrmModule,
    [string]$CrmThreadPreviewSourceRoot,
    [string]$CrmThreadPreviewMaterializedSourceRoot,
    [string]$CrmThreadPreviewTargetCommit,
    [string]$CrmThreadPreviewSourceFingerprint,
    [switch]$CrmThreadPreviewDetachedStart,
    [switch]$CrmThreadPreviewStop,
    [switch]$CrmAtendimentoDetachedStart,
    [switch]$CrmLocalDetachedStart,
    [switch]$CrmRuntimeDetachedStart,
    [switch]$CrmRuntimeSuppressBrowser
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherProjectRoot = Split-Path -Parent $scriptRoot

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
$crmThreadPreviewInstanceRoot = Join-Path $operatorRuntimeRoot "runtime\crm-local\thread-previews"
$crmThreadPreviewPreferredPortBase = 25000
$crmThreadPreviewPortBundleLockPath = Join-Path $operatorRuntimeRoot "runtime\crm-local\port-bundles.lock"
$tmpRoot = Join-Path $localStateRoot "tmp"
$logRoot = Join-Path $operatorRuntimeRoot "logs"
$wslInvoker = Join-Path $scriptRoot "invoke-skincos-wsl.ps1"
$crmLocalPreviewSelected = $false
$persistedCrmPreviewSelection = $null
$crmCanonicalProjectRoot = 'C:\CodexShared\Projetos\skincos'
if (-not (Test-Path -LiteralPath (Join-Path $crmCanonicalProjectRoot '.git'))) {
    throw "A origem canônica do CRM Local não está disponível em '$crmCanonicalProjectRoot'."
}
$crmLaunchProjectRoot = $crmCanonicalProjectRoot

# A CRM preview is selected explicitly and kept outside every worktree. This
# makes the chosen source deterministic for CRM actions/modules only, while
# unrelated actions keep the project root explicitly supplied by their task.
$previewSourceRoot = [string]$env:CRM_LOCAL_PREVIEW_SOURCE_ROOT
if ([string]$env:CRM_LOCAL_CLEAR_PREVIEW_SOURCE -in @('1', 'true', 'TRUE')) {
    Remove-Item -LiteralPath $crmLocalSourceSelectionPath -Force -ErrorAction SilentlyContinue
    $previewSourceRoot = ''
} elseif ([string]::IsNullOrWhiteSpace($previewSourceRoot) -and (Test-Path -LiteralPath $crmLocalSourceSelectionPath)) {
    try {
        $persistedCrmPreviewSelection = Get-Content -Raw -LiteralPath $crmLocalSourceSelectionPath | ConvertFrom-Json
        $previewSourceRoot = [string]$persistedCrmPreviewSelection.sourceRoot
    } catch {
        throw "A seleção ativa do CRM Local está inválida em '$crmLocalSourceSelectionPath'. Remova-a com CRM_LOCAL_CLEAR_PREVIEW_SOURCE=1 antes de iniciar o CRM."
    }
}
if (-not [string]::IsNullOrWhiteSpace($previewSourceRoot)) {
    $previewSourceRoot = (Resolve-Path -LiteralPath $previewSourceRoot).Path
    $privatePreviewRoot = (Resolve-Path -LiteralPath (Join-Path $operatorRuntimeRoot 'source')).Path.TrimEnd([char]'\')
    if (-not $previewSourceRoot.StartsWith($privatePreviewRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "A prévia ativa do CRM Local deve estar no diretório privado autorizado '$privatePreviewRoot': '$previewSourceRoot'."
    }
    $previewGitRootRaw = @(& git -C $previewSourceRoot rev-parse --show-toplevel 2>$null)
    $previewGitExit = $LASTEXITCODE
    $previewGitRoot = [string]($previewGitRootRaw | Select-Object -First 1)
    if ($previewGitExit -ne 0 -or [string]::IsNullOrWhiteSpace($previewGitRoot) -or -not ([IO.Path]::GetFullPath($previewGitRoot.Trim()).TrimEnd([char]'\') -eq $previewSourceRoot.TrimEnd([char]'\'))) {
        throw "A prévia ativa do CRM Local deve ser a raiz de um worktree Git privado, sem checkout aninhado: '$previewSourceRoot'."
    }
    $previewCommit = (& git -C $previewSourceRoot rev-parse --verify 'HEAD^{commit}' 2>$null | Select-Object -First 1).Trim().ToLowerInvariant()
    if ($previewCommit -notmatch '^[0-9a-f]{40}$') {
        throw "Não foi possível resolver o commit da prévia ativa do CRM Local: '$previewSourceRoot'."
    }
    $crmLaunchProjectRoot = $previewSourceRoot
    $crmLocalPreviewSelected = $true
    $env:CRM_LOCAL_INCLUDE_WORKING_CHANGES = 'true'
    if (-not [string]::IsNullOrWhiteSpace([string]$env:CRM_LOCAL_PREVIEW_SOURCE_ROOT)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $crmLocalSourceSelectionPath) -Force | Out-Null
        [pscustomobject]@{
            version = 1
            sourceRoot = $previewSourceRoot
            sourceCommit = $previewCommit
            selectedAt = (Get-Date).ToString('o')
            selectedBy = 'CRM_LOCAL_PREVIEW_SOURCE_ROOT'
        } | ConvertTo-Json | Set-Content -LiteralPath $crmLocalSourceSelectionPath -Encoding utf8
        Write-Host "[crm-local] Prévia ativa selecionada: $previewSourceRoot"
    }
}

function Use-CrmLaunchSource {
    # CRM actions never inherit the calling task/worktree. They use either the
    # explicitly persisted private preview or the canonical shared source.
    $script:ProjectRoot = $script:crmLaunchProjectRoot
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

function Test-WindowsPathWithinRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $candidate = [IO.Path]::GetFullPath($Path).TrimEnd([char]'\', [char]'/')
    $boundaryRoot = [IO.Path]::GetFullPath($Root).TrimEnd([char]'\', [char]'/')
    if ($candidate.Equals($boundaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    $prefix = $boundaryRoot + [IO.Path]::DirectorySeparatorChar
    return $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Invoke-ShortcutWsl {
    [CmdletBinding(DefaultParameterSetName = "BashScript")]
    param(
        [Parameter(Mandatory = $true, ParameterSetName = "BashScript")]
        [string]$ScriptPath,
        [Parameter(Mandatory = $true, ParameterSetName = "Executable")]
        [string]$Executable,
        [Parameter(Mandatory = $true, ParameterSetName = "NpmScript")]
        [string]$NpmScript,
        [Parameter(Mandatory = $true, ParameterSetName = "PythonScript")]
        [string]$PythonScript,
        [Parameter(ParameterSetName = "BashScript")]
        [Parameter(ParameterSetName = "Executable")]
        [Parameter(ParameterSetName = "NpmScript")]
        [Parameter(ParameterSetName = "PythonScript")]
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory = ".",
        [string]$WorkingProjectRoot = $ProjectRoot,
        [string[]]$EnvVar = @(),
        [int[]]$AcceptedExitCode = @(0),
        [switch]$SkipBootstrapCheck,
        [switch]$SkipNodeCheck,
        [switch]$SkipNpmCheck,
        [switch]$SkipGitCheck,
        [switch]$SkipRepoCheck
    )

    $invokeParameters = @{
        ProjectRoot = $WorkingProjectRoot
        WorkingDirectory = $WorkingDirectory
        ArgumentList = $ArgumentList
        EnvVar = $EnvVar
        SkipBootstrapCheck = $SkipBootstrapCheck
        SkipNodeCheck = $SkipNodeCheck
        SkipNpmCheck = $SkipNpmCheck
        SkipGitCheck = $SkipGitCheck
        SkipRepoCheck = $SkipRepoCheck
    }
    switch ($PSCmdlet.ParameterSetName) {
        "BashScript" { $invokeParameters.ScriptPath = $ScriptPath }
        "Executable" { $invokeParameters.Executable = $Executable }
        "NpmScript" { $invokeParameters.NpmScript = $NpmScript }
        "PythonScript" { $invokeParameters.PythonScript = $PythonScript }
    }

    & $wslInvoker @invokeParameters
    $exitCode = $LASTEXITCODE
    if ($exitCode -notin $AcceptedExitCode) {
        throw "The WSL operation failed with exit code $exitCode."
    }
}

function Resolve-CrmRuntimePublicHost {
    param(
        [string]$WorkingProjectRoot = $launcherProjectRoot
    )

    try {
        $raw = Invoke-ShortcutWsl `
            -WorkingProjectRoot $WorkingProjectRoot `
            -Executable 'hostname' `
            -ArgumentList @('-I') `
            -SkipBootstrapCheck `
            -SkipNodeCheck `
            -SkipNpmCheck `
            -SkipGitCheck `
            -SkipRepoCheck
        $text = [string]($raw -join ' ')
        $candidates = @(
            [regex]::Matches($text, '(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])') |
                ForEach-Object { $_.Value } |
                Select-Object -Unique
        ) | Where-Object {
            $parsed = $null
            [Net.IPAddress]::TryParse($_, [ref]$parsed) -and
                $parsed.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and
                $_ -notmatch '^(127|0|169\.254)\.'
        }
        $preferred = @(
            $candidates | Where-Object { $_ -match '^172\.' }
            $candidates | Where-Object { $_ -match '^10\.' }
            $candidates | Where-Object { $_ -match '^192\.168\.' }
            $candidates
        ) | Select-Object -First 1
        if (-not [string]::IsNullOrWhiteSpace([string]$preferred)) {
            return [string]$preferred
        }
    } catch {
        # localhost remains the safe fallback when WSL localhost forwarding
        # is available or an address cannot be discovered.
    }
    return 'localhost'
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
    param(
        [Parameter(Mandatory = $true)][string]$OutputPath,
        [string]$SourceRoot = $ProjectRoot
    )

    New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = 'git'
    $process.StartInfo.Arguments = ('-C "{0}" diff --binary HEAD' -f $SourceRoot)
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
            throw "Não foi possível ler as alterações locais do checkout '$SourceRoot': $standardError"
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
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Entries,
        [string]$SourceRoot = $ProjectRoot
    )

    $sourceRootPath = (Resolve-Path -LiteralPath $SourceRoot).Path.TrimEnd([char]'\', [char]'/')
    $files = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in $Entries) {
        $relativeEntry = ([string]$entry).Trim()
        if ([string]::IsNullOrWhiteSpace($relativeEntry)) { continue }

        $candidate = Join-Path $SourceRoot $relativeEntry.Replace('/', [IO.Path]::DirectorySeparatorChar)
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
            & git -C $SourceRoot check-ignore --quiet -- $relativeFile 2>$null
            if ($LASTEXITCODE -eq 0) { return }
            if ($LASTEXITCODE -ne 1) { throw "Não foi possível validar o arquivo não rastreado '$relativeFile' no snapshot do CRM Local." }
            $files.Add($relativeFile)
        }
    }
    return @($files | Sort-Object -Unique)
}

function Get-CrmLocalSourceSnapshot {
    param(
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [string]$SourceRoot = $ProjectRoot,
        [switch]$IncludeWorkingChanges
    )

    # The standard action intentionally ignores the caller's dirty checkout.
    # That checkout can belong to another Codex thread and may be based on an
    # older branch. A local preview must opt in explicitly and be based on the
    # exact requested revision, otherwise no changes are copied.
    $shouldIncludeWorkingChanges = $IncludeWorkingChanges.IsPresent -or (Test-CrmLocalIncludeWorkingChanges)
    if (-not $shouldIncludeWorkingChanges) {
        return [pscustomobject]@{
            SourceRoot = $SourceRoot
            TargetCommit = $TargetCommit
            PatchPath = $null
            Untracked = @()
            HasChanges = $false
            Fingerprint = "commit:${TargetCommit}"
        }
    }

    $sourceCommit = (& git -C $SourceRoot rev-parse --verify 'HEAD^{commit}' 2>$null | Select-Object -First 1).Trim().ToLowerInvariant()
    if ($sourceCommit -notmatch '^[0-9a-f]{40}$') { throw "Não foi possível resolver o commit do checkout que disparou o CRM Local: '$SourceRoot'." }
    if ($sourceCommit -ne $TargetCommit) {
        # A named preview may be based on an older ancestor. Its patch is
        # applied only to a fresh worktree at the current canonical commit;
        # conflict detection remains fail-closed in Apply-CrmLocalSourceSnapshot.
        & git -C $SourceRoot merge-base --is-ancestor $sourceCommit $TargetCommit
        if ($LASTEXITCODE -ne 0) {
            throw "A prévia ativa não deriva da revisão canônica solicitada ($TargetCommit). Não copie alterações entre linhas divergentes; selecione uma prévia rebaseada ou limpe a seleção com CRM_LOCAL_CLEAR_PREVIEW_SOURCE=1."
        }
    }
    $patchPath = Join-Path $operatorRuntimeRoot ("tmp\crm-local-snapshot-{0}.patch" -f [Guid]::NewGuid().ToString('N'))
    Export-CrmLocalSnapshotPatch -OutputPath $patchPath -SourceRoot $SourceRoot
    $patchBytes = (Get-Item -LiteralPath $patchPath).Length
    $untrackedEntries = @(& git -C $SourceRoot ls-files --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível ler os arquivos não rastreados do checkout '$SourceRoot'." }
    $untracked = @(Get-CrmLocalSnapshotUntrackedFiles -Entries $untrackedEntries -SourceRoot $SourceRoot)
    $untrackedDigest = foreach ($relativePath in $untracked) {
        $candidate = Join-Path $SourceRoot $relativePath
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
        SourceRoot = $SourceRoot
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

function Convert-CrmSourceOriginToWsl {
    param([Parameter(Mandatory = $true)][string]$SourceOrigin)

    # Runtime manifests are written inside Ubuntu, so a source origin that
    # crosses the typed Windows -> WSL boundary must use the same canonical
    # path form before it is compared by the Node policy.  The module suffix
    # (for example ``__crm-shell``) intentionally remains part of the value.
    if ($SourceOrigin -match '^[A-Za-z]:[\\/]') {
        return Convert-WindowsPathToWsl -Path $SourceOrigin
    }
    return ($SourceOrigin -replace '\\', '/')
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
        [object]$Snapshot,
        [switch]$Versioned
    )

    $sourceRoot = Get-CrmLocalSourceBaseRoot -Persona $Persona
    $sourceParent = Split-Path -Parent $sourceRoot
    New-Item -ItemType Directory -Path $sourceParent -Force | Out-Null
    $mutexName = "Local\SkincosCrmPersonaSource-$($Persona.ToLowerInvariant())"
    $mutex = [Threading.Mutex]::new($false, $mutexName)
    $lockHeld = $false
    try {
        try {
            $lockHeld = $mutex.WaitOne([TimeSpan]::FromMinutes(10))
        } catch [Threading.AbandonedMutexException] {
            $lockHeld = $true
            Write-Host "[crm-local] Recuperando mutex abandonado da fonte privada de $Persona."
        }
        if (-not $lockHeld) {
            throw "Tempo limite ao aguardar a fonte privada do CRM Local ($Persona)."
        }

        if ($Snapshot.HasChanges -or $Versioned) {
            $shortCommit = $TargetCommit.Substring(0, 12)
            $snapshotRoot = "$sourceRoot-$shortCommit"
            if ($Snapshot.HasChanges) {
                $shortSnapshot = $Snapshot.Fingerprint.Split(':')[-1].Substring(0, 12)
                $snapshotRoot = "$snapshotRoot-$shortSnapshot"
            }
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
    } finally {
        if ($lockHeld) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Sync-CrmLocalImmutableSourceRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetCommit,
        [Parameter(Mandatory = $true)]
        [object]$Snapshot
    )

    $snapshotSourceRoot = (Resolve-Path -LiteralPath ([string]$Snapshot.SourceRoot)).Path
    $sourceKey = (Get-CrmLocalSnapshotHash -Value ([string]$Snapshot.Fingerprint)).Substring(0, 24)
    $sourceRoot = Join-Path $operatorRuntimeRoot ("source\crm-local\immutable\{0}" -f $sourceKey)
    $metadataPath = Join-Path $operatorRuntimeRoot ("source\crm-local\metadata\{0}.json" -f $sourceKey)
    New-Item -ItemType Directory -Path (Split-Path -Parent $sourceRoot) -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $metadataPath) -Force | Out-Null

    # Every runtime for the same exact source snapshot may share this immutable
    # tree and its build artifact. Creation itself is serialized so two Codex
    # actions cannot materialize or patch the same worktree concurrently.
    $mutexName = "Local\SkincosCrmSource-$sourceKey"
    $mutex = [Threading.Mutex]::new($false, $mutexName)
    $lockHeld = $false
    try {
        try {
            $lockHeld = $mutex.WaitOne([TimeSpan]::FromMinutes(10))
        } catch [Threading.AbandonedMutexException] {
            # The previous materializer died while owning the mutex. Windows
            # transfers ownership to this process; retain it and recover only
            # after proving the private source is not used by a WSL process.
            $lockHeld = $true
            Write-Host "[crm-local] Recuperando mutex abandonado da fonte privada $sourceKey."
        }
        if (-not $lockHeld) {
            throw "Tempo limite ao aguardar a fonte imutável do CRM Local ($sourceKey)."
        }

        if (Test-Path -LiteralPath $sourceRoot) {
            if (-not (Test-Path -LiteralPath $metadataPath)) {
                $sourceRootWsl = Convert-WindowsPathToWsl -Path $sourceRoot
                if (Test-CrmWslSourceInUse -SourceRootWsl $sourceRootWsl) {
                    throw "A fonte privada '$sourceRoot' existe sem metadados e ainda está em uso; ela não será movida."
                }
                $immutableRoot = Join-Path $operatorRuntimeRoot "source\crm-local\immutable"
                if (-not (Test-WindowsPathWithinRoot -Path $sourceRoot -Root $immutableRoot)) {
                    throw "A fonte privada incompleta está fora da raiz autorizada: '$sourceRoot'."
                }
                $quarantineRoot = Join-Path $operatorRuntimeRoot "source\crm-local\quarantine"
                New-Item -ItemType Directory -Path $quarantineRoot -Force | Out-Null
                $quarantinePath = Join-Path $quarantineRoot ("{0}-{1}" -f $sourceKey, (Get-Date -Format 'yyyyMMddHHmmssfff'))
                Move-Item -LiteralPath $sourceRoot -Destination $quarantinePath
                & git -C $snapshotSourceRoot worktree prune | Out-Null
                Write-Host "[crm-local] Fonte incompleta preservada em quarentena: '$quarantinePath'."
            } else {
                $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
                $actualCommit = (& git -C $sourceRoot rev-parse --verify 'HEAD^{commit}' 2>$null | Select-Object -First 1).Trim().ToLowerInvariant()
                if ($actualCommit -ne $TargetCommit -or [string]$metadata.fingerprint -ne [string]$Snapshot.Fingerprint) {
                    throw "A fonte privada '$sourceRoot' não corresponde à impressão solicitada; ela não será alterada enquanto outros runtimes podem usá-la."
                }
                return $sourceRoot
            }
        }

        & git -C $snapshotSourceRoot worktree prune | Out-Null
        & git -C $snapshotSourceRoot worktree add --detach $sourceRoot $TargetCommit | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "Não foi possível criar a fonte imutável do CRM Local em '$sourceRoot'."
        }
        try {
            Apply-CrmLocalSourceSnapshot -Snapshot $Snapshot -DestinationRoot $sourceRoot
            $metadata = [ordered]@{
                version = 1
                sourceKey = $sourceKey
                targetCommit = $TargetCommit
                fingerprint = [string]$Snapshot.Fingerprint
                sourceCheckout = [string]$Snapshot.SourceRoot
                createdAt = (Get-Date).ToString('o')
            }
            $temporaryMetadata = "$metadataPath.$([Guid]::NewGuid().ToString('N')).tmp"
            $metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporaryMetadata -Encoding utf8
            Move-Item -LiteralPath $temporaryMetadata -Destination $metadataPath -Force
        } catch {
            & git -C $snapshotSourceRoot worktree remove --force $sourceRoot 2>$null
            throw
        }
        return $sourceRoot
    } finally {
        if ($lockHeld) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
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
        if ($null -ne $manifest -and (Test-CrmManifestLauncherIdentity -Manifest $manifest)) {
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
    Invoke-ShortcutWsl `
        -WorkingProjectRoot $launcherProjectRoot `
        -ScriptPath "scripts/crm-local-process-control.sh" `
        -ArgumentList @("pid-alive", $pidText) `
        -AcceptedExitCode @(0, 1) `
        -SkipNodeCheck -SkipNpmCheck -SkipGitCheck 2>$null
    return $LASTEXITCODE -eq 0
}

function Get-CrmWslPidStartTicks {
    param([object]$PidValue)
    $pidText = [string]$PidValue
    if ($pidText -notmatch '^[0-9]+$') { return $null }
    $raw = Invoke-ShortcutWsl `
        -WorkingProjectRoot $launcherProjectRoot `
        -ScriptPath "scripts/crm-local-process-control.sh" `
        -ArgumentList @("pid-start-ticks", $pidText) `
        -AcceptedExitCode @(0, 1) `
        -SkipNodeCheck -SkipNpmCheck -SkipGitCheck 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    $ticks = [string]($raw | Select-Object -Last 1)
    if ($ticks -notmatch '^[0-9]+$') { return $null }
    return $ticks
}

function Test-CrmManifestLauncherIdentity {
    param([object]$Manifest)
    if ($null -eq $Manifest) { return $false }
    if ([int]$Manifest.version -ge 3) {
        return Test-CrmWslPidIdentity `
            -PidValue $Manifest.pids.launcher `
            -StartTicks $Manifest.pidStartTicks.launcher
    }
    return Test-CrmWslPid -PidValue $Manifest.pids.launcher
}

function Test-CrmWslLauncherProcess {
    param(
        [object]$PidValue,
        [Parameter(Mandatory = $true)][string]$ExpectedWorkingDirectory
    )
    $pidText = [string]$PidValue
    if ($pidText -notmatch '^[0-9]+$') { return $false }
    Invoke-ShortcutWsl `
        -WorkingProjectRoot $launcherProjectRoot `
        -ScriptPath "scripts/crm-local-process-control.sh" `
        -ArgumentList @("launcher-matches", $pidText, $ExpectedWorkingDirectory) `
        -AcceptedExitCode @(0, 1) `
        -SkipNodeCheck -SkipNpmCheck -SkipGitCheck 2>$null
    return $LASTEXITCODE -eq 0
}

function Test-CrmWslSourceInUse {
    param([Parameter(Mandatory = $true)][string]$SourceRootWsl)
    Invoke-ShortcutWsl `
        -WorkingProjectRoot $launcherProjectRoot `
        -ScriptPath "scripts/crm-local-process-control.sh" `
        -ArgumentList @("source-in-use", $SourceRootWsl) `
        -AcceptedExitCode @(0, 1) `
        -SkipNodeCheck -SkipNpmCheck -SkipGitCheck 2>$null
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

function Get-CrmManifestPort {
    param(
        [Parameter(Mandatory = $true)][object]$Manifest,
        [Parameter(Mandatory = $true)][string]$Name
    )
    if ($null -eq $Manifest.PSObject.Properties['ports'] -or $null -eq $Manifest.ports) {
        return $null
    }
    $property = $Manifest.ports.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    $port = 0
    if (-not [int]::TryParse([string]$property.Value, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        return $null
    }
    return $port
}

function Get-CrmManifestPublicUri {
    param([Parameter(Mandatory = $true)][object]$Manifest)
    $url = [string]$Manifest.url
    $uri = $null
    if ([string]::IsNullOrWhiteSpace($url) -or
        -not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne 'http' -or
        [string]::IsNullOrWhiteSpace($uri.Host) -or
        -not [string]::IsNullOrEmpty($uri.UserInfo)) {
        return $null
    }
    return $uri
}

function New-CrmRuntimeEndpointUrl {
    param(
        [Parameter(Mandatory = $true)][Uri]$Uri,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$Path
    )
    $endpointHost = $Uri.Host
    if ($endpointHost.Contains(':')) { $endpointHost = "[$endpointHost]" }
    return "http://${endpointHost}:$Port$Path"
}

function Test-CrmTimekeepingReadinessEndpoint {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$TargetCommit
    )
    if ($TargetCommit -notmatch '^[0-9a-f]{40}$') { return $false }
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $Url -Headers @{
            'x-skincos-gateway-release-sha' = $TargetCommit
            'x-skincos-gateway-environment' = 'local'
        }
        if ($response.StatusCode -ne 200) { return $false }
        $payload = $response.Content | ConvertFrom-Json
        return [bool]$payload.ok -and
            [bool]$payload.ready -and
            [string]$payload.version -eq $TargetCommit -and
            [string]$payload.environment -eq 'local' -and
            [string]$payload.availability.state -eq 'active'
    } catch { return $false }
}

function Test-CrmPersonaHealth {
    param(
        [ValidateSet("Gestor", "Consultor")][string]$Persona,
        [object]$Manifest = $null
    )
    if ($Persona -eq "Gestor") {
        if ($null -ne $Manifest -and [int]$Manifest.version -ge 3) {
            $buildSource = Convert-WslPathToWindows -Path ([string]$Manifest.worktree)
            $buildStatePath = Join-Path (Get-CrmPersonaRuntimeRoot -Persona $Persona) "build-state.json"
            if (-not (Test-Path -LiteralPath $buildSource)) { return $false }
            try {
                $buildDescriptor = Get-CrmInstanceBuildDescriptor -SourceRoot $buildSource -StatePath $buildStatePath
            } catch {
                return $false
            }
            if (-not [bool]$buildDescriptor.stateValid -or
                [string]$Manifest.build.inputFingerprint -ne [string]$buildDescriptor.inputFingerprint -or
                [string]$Manifest.build.lockfileFingerprint -ne [string]$buildDescriptor.lockfileFingerprint -or
                [string]$Manifest.build.artifactFingerprint -ne [string]$buildDescriptor.artifactFingerprint) {
                return $false
            }
        }
        # The manifest is authoritative for optional services. Atendimento is
        # intentionally a smaller Gestor preview (Pages + PostgreSQL-backed
        # adapter), so requiring unrelated Insumos/Ponto services made every
        # healthy Atendimento launch look stale and restart indefinitely.
        if (-not (Test-CrmHttpEndpoint -Url "http://127.0.0.1:8791/api/auth/me" -Role "GESTOR")) { return $false }
        if ($null -eq $Manifest -or $null -ne $Manifest.ports.insumos) {
            if (-not (Test-CrmHttpEndpoint -Url "http://127.0.0.1:8787/insumos/health")) { return $false }
        }
        if ($null -eq $Manifest -or $null -ne $Manifest.ports.timekeeping) {
            if ($null -eq $Manifest -or
                -not (Test-CrmTimekeepingReadinessEndpoint `
                    -Url "http://127.0.0.1:8801/api/ponto/readiness" `
                    -TargetCommit ([string]$Manifest.targetCommit))) {
                return $false
            }
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
        [Parameter(Mandatory = $true)][string]$SourceOrigin,
        [string]$RuntimeId = "",
        [string]$Module = "",
        [string]$ConfigFingerprint = "",
        [string]$PolicySourceRoot = ""
    )
    $runtimeRoot = Get-CrmPersonaRuntimeRoot -Persona $Persona
    $manifest = Get-CrmPersonaManifest -Persona $Persona
    $pidAlive = $false
    if ($null -ne $manifest) { $pidAlive = Test-CrmManifestLauncherIdentity -Manifest $manifest }
    $healthy = $false
    if ($pidAlive) { $healthy = Test-CrmPersonaHealth -Persona $Persona -Manifest $manifest }
    if ([string]::IsNullOrWhiteSpace($PolicySourceRoot) -and
        [string]::IsNullOrWhiteSpace($ConfigFingerprint) -and
        $null -ne $manifest) {
        $manifestSource = Convert-WslPathToWindows -Path ([string]$manifest.worktree)
        $allowedSourceRoot = Join-Path $operatorRuntimeRoot "source"
        if ((Test-Path -LiteralPath $manifestSource) -and
            (Test-WindowsPathWithinRoot -Path $manifestSource -Root $allowedSourceRoot) -and
            (Test-Path -LiteralPath (Join-Path $manifestSource "scripts\crm-local-runtime-policy.mjs"))) {
            $PolicySourceRoot = $manifestSource
        }
    }
    $policyPath = if ([string]::IsNullOrWhiteSpace($PolicySourceRoot)) {
        Join-Path $scriptRoot "crm-local-runtime-policy.mjs"
    } else {
        Join-Path $PolicySourceRoot "scripts\crm-local-runtime-policy.mjs"
    }
    $policyProjectRoot = if ([string]::IsNullOrWhiteSpace($PolicySourceRoot)) {
        $ProjectRoot
    } else {
        $PolicySourceRoot
    }
    if (-not (Test-Path -LiteralPath $policyPath)) {
        throw "Política do CRM Local não encontrada na fonte avaliada: '$policyPath'."
    }
    $policyWsl = Convert-WindowsPathToWsl -Path $policyPath
    $manifestWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "current.json")
    $buildStateWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "build-state.json")
    $policyArguments = @(
        $policyWsl,
        "--manifest", $manifestWsl,
        "--build-state", $buildStateWsl,
        "--target", $TargetCommit,
        "--source-fingerprint", $SourceFingerprint,
        "--source-origin", (Convert-CrmSourceOriginToWsl -SourceOrigin $SourceOrigin),
        "--persona", $Persona.ToUpperInvariant(),
        "--runtime-id", $RuntimeId,
        "--module", $Module,
        "--config-fingerprint", $ConfigFingerprint,
        "--pid-alive", $pidAlive.ToString().ToLowerInvariant(),
        "--healthy", $healthy.ToString().ToLowerInvariant()
    )
    $decisionRaw = Invoke-ShortcutWsl `
        -WorkingProjectRoot $policyProjectRoot `
        -Executable node `
        -ArgumentList $policyArguments `
        -SkipBootstrapCheck
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
    if ($Persona -eq "Gestor") {
        $sourceRoot = if ($null -ne $Manifest) { Convert-WslPathToWindows -Path ([string]$Manifest.worktree) } else { $null }
        $browserLauncher = if (-not [string]::IsNullOrWhiteSpace($sourceRoot)) {
            $allowedSourceRoot = Join-Path $operatorRuntimeRoot "source"
            if (-not (Test-Path -LiteralPath $sourceRoot) -or
                -not (Test-WindowsPathWithinRoot -Path $sourceRoot -Root $allowedSourceRoot)) {
                throw "A fonte do runtime de ${Persona} não está na raiz privada autorizada: '$sourceRoot'."
            }
            Join-Path $sourceRoot "scripts\open-crm-local-browser.ps1"
        } else {
            Join-Path $scriptRoot "open-crm-local-browser.ps1"
        }
        if (-not (Test-Path -LiteralPath $browserLauncher)) {
            throw "Launcher do navegador não encontrado na fonte do runtime de ${Persona}: '$browserLauncher'."
        }
        & $browserLauncher `
            -Url $url `
            -ProfilePath (Join-Path $crmGestorRuntimeRoot "browser\profile")
    } else {
        Start-Process $url | Out-Null
    }
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
        [string]$RuntimeId = "",
        [string]$Module = "",
        [string]$ConfigFingerprint = "",
        [int]$TimeoutSeconds = 420
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $decision = Get-CrmPersonaDecision -Persona $Persona -TargetCommit $TargetCommit -SourceFingerprint $SourceFingerprint -SourceOrigin $SourceOrigin -RuntimeId $RuntimeId -Module $Module -ConfigFingerprint $ConfigFingerprint
        if ($decision.Action -eq 'reuse') { return $decision }
        if ($decision.Action -notin @('wait', 'start')) { return $decision }
        Start-Sleep -Seconds 2
    }
    return [pscustomobject]@{ Action = 'restart'; Reason = 'startup_timeout'; Manifest = (Get-CrmPersonaManifest -Persona $Persona) }
}

function Test-CrmSourceOriginEquivalent {
    param(
        [AllowEmptyString()][string]$Left,
        [AllowEmptyString()][string]$Right
    )
    # Match the runtime-policy contract exactly. Windows source roots are
    # case-insensitive and may reach WSL with either slash separator, while
    # the module suffix and native paths must remain exact to prevent a
    # snapshot from Atendimento, Site or Meta Ads crossing the boundary.
    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) {
        return $false
    }
    $normalizedLeft = $Left.Trim() -replace '\\', '/'
    $normalizedRight = $Right.Trim() -replace '\\', '/'
    if ($normalizedLeft -match '^[A-Za-z]:/' -and $normalizedRight -match '^[A-Za-z]:/') {
        return $normalizedLeft.ToLowerInvariant() -ceq $normalizedRight.ToLowerInvariant()
    }
    return $normalizedLeft -ceq $normalizedRight
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

function Stop-CrmVerifiedLegacyWslLauncher {
    param(
        [Parameter(Mandatory = $true)][object]$PidValue,
        [Parameter(Mandatory = $true)][string]$ExpectedWorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $launcherPid = [string]$PidValue
    if (-not (Test-CrmWslLauncherProcess -PidValue $launcherPid -ExpectedWorkingDirectory $ExpectedWorkingDirectory)) {
        throw "O PID legado $launcherPid de $Label não possui cwd/cmdline compatíveis; ele não será encerrado."
    }
    $startTicks = Get-CrmWslPidStartTicks -PidValue $launcherPid
    if ($null -eq $startTicks -or -not (Test-CrmWslPidIdentity -PidValue $launcherPid -StartTicks $startTicks)) {
        throw "A identidade do PID legado $launcherPid de $Label mudou durante a validação; ele não será encerrado."
    }

    Write-Host "[crm-local] Encerrando somente o launcher legado verificado de $Label (PID $launcherPid)."
    Invoke-ShortcutWsl `
        -WorkingProjectRoot $launcherProjectRoot `
        -ScriptPath "scripts/crm-local-process-control.sh" `
        -ArgumentList @("signal", $launcherPid, "TERM") `
        -SkipNodeCheck -SkipNpmCheck -SkipGitCheck
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (-not (Test-CrmWslPidIdentity -PidValue $launcherPid -StartTicks $startTicks)) { return }
        Start-Sleep -Milliseconds 500
    }
    if (Test-CrmWslPidIdentity -PidValue $launcherPid -StartTicks $startTicks) {
        Invoke-ShortcutWsl `
            -WorkingProjectRoot $launcherProjectRoot `
            -ScriptPath "scripts/crm-local-process-control.sh" `
            -ArgumentList @("signal", $launcherPid, "KILL") `
            -SkipNodeCheck -SkipNpmCheck -SkipGitCheck
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

    Stop-CrmVerifiedLegacyWslLauncher `
        -PidValue $manifest.pids.launcher `
        -ExpectedWorkingDirectory $legacyProjectWsl `
        -Label "CRM Local"
}

function Stop-LegacyCrmPersonaRuntimeIfNeeded {
    $legacyRoot = Join-Path $operatorRuntimeRoot "runtime\crm-local\gestor"
    $manifestPath = Join-Path $legacyRoot "current.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) { return }
    try { $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { return }
    if ([string]$manifest.runtimeId) { return }
    if ([int]$manifest.ports.pages -ne 8791) { return }
    $launcherPid = [string]$manifest.pids.launcher
    if (-not (Test-CrmWslPid -PidValue $launcherPid)) { return }
    $worktreeWindows = Convert-WslPathToWindows -Path ([string]$manifest.worktree)
    $allowedSourceRoot = Join-Path $operatorRuntimeRoot "source"
    if (-not (Test-Path -LiteralPath $worktreeWindows)) { return }
    $resolvedSource = (Resolve-Path -LiteralPath $worktreeWindows).Path
    if (-not (Test-WindowsPathWithinRoot -Path $resolvedSource -Root $allowedSourceRoot)) {
        throw "O runtime legado do Gestor aponta para uma fonte não autorizada: '$resolvedSource'."
    }
    Stop-CrmVerifiedLegacyWslLauncher `
        -PidValue $launcherPid `
        -ExpectedWorkingDirectory ([string]$manifest.worktree) `
        -Label "CRM Local Gestor"
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
$crmInstanceRoot = Join-Path $operatorRuntimeRoot "runtime\crm-local\instances"
$crmTimekeepingPrivateRoot = Join-Path $operatorRuntimeRoot "runtime\crm-local\ponto-private"
$crmGestorRuntimeRoot = Join-Path $crmInstanceRoot "gestor\full"
$crmConsultorRuntimeRoot = Join-Path $crmInstanceRoot "consultor\legacy-ponto"
$crmBuildCacheRoot = Join-Path $operatorRuntimeRoot "cache\crm-local\builds"
$crmPlaywrightCacheRoot = Join-Path $operatorRuntimeRoot "cache\playwright"
$crmGestorPid = Join-Path $crmGestorRuntimeRoot "supervisor.pid"
$crmGestorLog = Join-Path $crmGestorRuntimeRoot "logs\runtime.log"
$crmConsultorPid = Join-Path $crmConsultorRuntimeRoot "supervisor.pid"
$crmConsultorLog = Join-Path $crmConsultorRuntimeRoot "logs\runtime.log"
$crmLegacyPid = Join-Path $tmpRoot "crm-local-dev.pid"
$crmLegacyLog = Join-Path $logRoot "crm-local-dev.log"
$atendimentoPid = Join-Path $tmpRoot "crm-atendimento-local.pid"
$atendimentoLog = Join-Path $logRoot "crm-atendimento-local.log"
$efAppStateRoot = Join-Path $localStateRoot "espacofacial-app"
$efAppArtifactRoot = Join-Path $operatorRuntimeRoot "scraper"
$efAppOutputRoot = Join-Path $efAppArtifactRoot "report"
$efAppClientRegistrationRunRoot = Join-Path $efAppArtifactRoot "client-registration"
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
$crmTimekeepingPrivateRootWsl = Convert-WindowsPathToWsl -Path $crmTimekeepingPrivateRoot
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
        $stopEnv = @(
            "CRM_PERSONA=GESTOR",
            "CRM_RUNTIME_ROOT=$runtimeRootWsl",
            "CRM_WITH_INSUMOS=1",
            "CRM_WITH_TIMEKEEPING=1",
            "CRM_WITH_WHATSAPP=1",
            "CRM_PID_FILE=$crmGestorPidWsl",
            "CRM_LOG_FILE=$crmGestorLogWsl"
        )
    } else {
        $stopEnv = @(
            "CRM_PERSONA=CONSULTOR",
            "CRM_RUNTIME_ROOT=$runtimeRootWsl",
            "CRM_VITE_PORT=5174",
            "CRM_PAGES_PORT=8792",
            "CRM_WITH_INSUMOS=0",
            "CRM_WITH_TIMEKEEPING=0",
            "CRM_WITH_WHATSAPP=0",
            "CRM_PID_FILE=$crmConsultorPidWsl",
            "CRM_LOG_FILE=$crmConsultorLogWsl"
        )
    }

    if ($manifestWorktree -match '^/home/admin/\.local/state/skincos/crm-local-preview-source/[A-Za-z0-9._-]+$') {
        Invoke-ShortcutWsl `
            -WorkingProjectRoot $manifestWorktree `
            -ScriptPath "./scripts/run-local-crm.sh" `
            -ArgumentList @("--stop") `
            -EnvVar $stopEnv `
            -SkipBootstrapCheck
        return
    }

    $allowedSourceRoot = Join-Path $operatorRuntimeRoot "source"
    $resolvedSource = if (Test-Path -LiteralPath $sourceRoot) { (Resolve-Path -LiteralPath $sourceRoot).Path } else { $null }
    if ($null -eq $resolvedSource -or -not (Test-WindowsPathWithinRoot -Path $resolvedSource -Root $allowedSourceRoot)) {
        throw "O runtime de $Persona aponta para um worktree não autorizado: '$sourceRoot'."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedSource "scripts\run-local-crm.sh"))) {
        throw "O launcher do runtime de $Persona não existe em '$resolvedSource'."
    }
    Invoke-ShortcutWsl `
        -WorkingProjectRoot $resolvedSource `
        -ScriptPath "./scripts/run-local-crm.sh" `
        -ArgumentList @("--stop") `
        -EnvVar $stopEnv `
        -SkipBootstrapCheck
}

function Start-CrmPersonaRuntime {
    param(
        [ValidateSet("Gestor", "Consultor")][string]$Persona,
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [Parameter(Mandatory = $true)][string]$SourceFingerprint,
        [Parameter(Mandatory = $true)][string]$SourceOrigin,
        [Parameter(Mandatory = $true)][string]$ConfigFingerprint
    )
    if ($Persona -eq "Gestor") {
        $browserProfileWsl = Convert-WindowsPathToWsl -Path (Join-Path $crmGestorRuntimeRoot "browser\profile")
        $browserScriptWsl = Convert-WindowsPathToWsl -Path (Join-Path $SourceRoot "scripts\open-crm-local-browser.ps1")
        $playwrightCacheWsl = Convert-WindowsPathToWsl -Path $crmPlaywrightCacheRoot
        $pagesStateWsl = Convert-WindowsPathToWsl -Path (Join-Path $crmGestorRuntimeRoot "state\pages")
        $insumosStateWsl = Convert-WindowsPathToWsl -Path (Join-Path $crmGestorRuntimeRoot "state\insumos")
        $timekeepingStateWsl = Convert-WindowsPathToWsl -Path (Join-Path $crmGestorRuntimeRoot "state\timekeeping")
        $whatsappStateWsl = Convert-WindowsPathToWsl -Path (Join-Path $crmGestorRuntimeRoot "state\whatsapp")
        $runtimeEnv = @(
            "CRM_RUNTIME_ID=gestor--full",
            "CRM_RUNTIME_MODULE=full",
            "CRM_PERSONA=GESTOR",
            "CRM_TARGET_COMMIT=$TargetCommit",
            "CRM_SOURCE_FINGERPRINT=$SourceFingerprint",
            "CRM_SOURCE_ORIGIN=$SourceOrigin",
            "CRM_RUNTIME_CONFIG_FINGERPRINT=$ConfigFingerprint",
            "CRM_RUNTIME_ROOT=$crmGestorRuntimeRootWsl",
            "LOCAL_AUTH_BYPASS=true",
            "LOCAL_AUTH_TEST_USER_ADMIN=true",
            "LOCAL_AUTH_ROLE=GESTOR",
            "LOCAL_AUTH_USERNAME=gestor-full-local",
            "LOCAL_AUTH_EMAIL=gestor.full@local.test",
            "LOCAL_AUTH_NAME=Gestor Local",
            "LOCAL_ESCALA_MOCK=true",
            "LOCAL_ESCALA_SHADOW_WRITES=false",
            "CRM_META_ADS_SCENARIO=connected-ready",
            "INTEGRATIONS_ENCRYPTION_SECRET=skincos-gestor--full-local-integrations",
            "REQUIRE_INTEGRATIONS_ENCRYPTION_SECRET=true",
            "UNIT_MONITOR_API_TARGET=http://127.0.0.1:8110",
            "CRM_WITH_INSUMOS=1",
            "CRM_INSUMOS_PERSIST_DIR=$insumosStateWsl",
            "CRM_WITH_TIMEKEEPING=1",
            "CRM_TIMEKEEPING_PRIVATE_ROOT=$crmTimekeepingPrivateRootWsl",
            "CRM_TIMEKEEPING_PERSIST_DIR=$timekeepingStateWsl",
            "CRM_WITH_WHATSAPP=1",
            "CRM_LOCAL_WA_RUNTIME_HOME=$whatsappStateWsl",
            "CRM_LOCAL_WA_SOURCE_HOME=/home/admin/.cache/skincos/crm-local/gestor--full/whatsapp",
            "R2_PERSIST_DIR=$pagesStateWsl",
            "CRM_LOCAL_ISOLATED=1",
            "CRM_ISOLATED_RUNTIME=1",
            "CRM_ALLOW_LEGACY_DEPENDENCY_MIGRATION=1",
            "PLAYWRIGHT_BROWSERS_PATH=$playwrightCacheWsl",
            "CRM_BROWSER_PROFILE_DIR=$browserProfileWsl",
            "CRM_BROWSER_SCRIPT=$browserScriptWsl",
            "CRM_BUILD_BEFORE_START=auto",
            "CRM_OPEN_BROWSER=1",
            "CRM_PID_FILE=$crmGestorPidWsl",
            "CRM_LOG_FILE=$crmGestorLogWsl"
        )
        $runtimeArguments = @()
    } else {
        $consultorSpec = Resolve-CrmLocalModuleSpec -Role Consultor -Module "ponto" -SourceRoot $SourceRoot
        $consultorRoleKey = [string]$consultorSpec.roleKey
        $consultorAuthAdmin = if ([bool]$consultorSpec.auth.testUserAdmin) { "true" } else { "false" }
        $consultorAllowedModules = @($consultorSpec.auth.allowedModules) -join ","
        $runtimeEnv = @(
            "CRM_RUNTIME_ID=consultor--ponto",
            "CRM_RUNTIME_MODULE=ponto",
            "CRM_PERSONA=$consultorRoleKey",
            "CRM_TARGET_COMMIT=$TargetCommit",
            "CRM_SOURCE_FINGERPRINT=$SourceFingerprint",
            "CRM_SOURCE_ORIGIN=$SourceOrigin",
            "CRM_RUNTIME_CONFIG_FINGERPRINT=$ConfigFingerprint",
            "CRM_RUNTIME_ROOT=$crmConsultorRuntimeRootWsl",
            "LOCAL_AUTH_BYPASS=true",
            "LOCAL_AUTH_TEST_USER_ADMIN=$consultorAuthAdmin",
            "LOCAL_AUTH_ROLE=$consultorRoleKey",
            "LOCAL_AUTH_EMAIL=consultor.local@local.test",
            "LOCAL_AUTH_USERNAME=consultor-local",
            "LOCAL_AUTH_NAME=Consultor Local",
            "LOCAL_AUTH_ALLOWED_MODULES=$consultorAllowedModules",
            "CRM_VITE_PORT=5174",
            "CRM_PAGES_PORT=8792",
            "CRM_WITH_INSUMOS=0",
            "CRM_WITH_TIMEKEEPING=0",
            "CRM_WITH_WHATSAPP=0",
            "PONTO_API_TARGET=http://127.0.0.1:8801",
            "LOCAL_INSUMOS_API_TARGET=http://127.0.0.1:8787",
            "LOCAL_WA_ORCHESTRATOR_API_TARGET=http://127.0.0.1:8110",
            "CRM_BUILD_BEFORE_START=1",
            "CRM_OPEN_BROWSER=1",
            "CRM_PID_FILE=$crmConsultorPidWsl",
            "CRM_LOG_FILE=$crmConsultorLogWsl"
        )
        $runtimeArguments = @("--module", "ponto")
    }
    Invoke-ShortcutWsl `
        -WorkingProjectRoot $SourceRoot `
        -ScriptPath "./scripts/run-local-crm.sh" `
        -ArgumentList $runtimeArguments `
        -EnvVar $runtimeEnv `
        -SkipBootstrapCheck `
        -AcceptedExitCode @(0, 130, 143)
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
    # WSL owns the child process tree of a non-interactive client. Keep the
    # durable PowerShell supervisor attached to this named launcher; a 143 is
    # accepted only because the exact manifest health gate still has to pass.
    $runtimeEnv = @(
        "CRM_PERSONA=GESTOR",
        "CRM_TARGET_COMMIT=$TargetCommit",
        "CRM_SOURCE_FINGERPRINT=$SourceFingerprint",
        "CRM_SOURCE_ORIGIN=$SourceOrigin",
        "CRM_RUNTIME_ROOT=$crmGestorRuntimeRootWsl",
        "CRM_LOCAL_NATIVE_SOURCE_ROOT=$nativeAtendimentoSource",
        "LOCAL_AUTH_BYPASS=true",
        "LOCAL_AUTH_TEST_USER_ADMIN=true",
        "LOCAL_AUTH_ROLE=GESTOR",
        "LOCAL_AUTH_EMAIL=dev@local.test",
        "LOCAL_AUTH_NAME=Gestor Local",
        "CRM_WITH_INSUMOS=0",
        "CRM_WITH_TIMEKEEPING=0",
        "CRM_WITH_WHATSAPP=1",
        "CRM_BUILD_BEFORE_START=1",
        "CRM_OPEN_BROWSER=0",
        "CRM_PID_FILE=$atendimentoPidWsl",
        "CRM_LOG_FILE=$atendimentoLogWsl"
    )
    Invoke-ShortcutWsl `
        -WorkingProjectRoot $SourceRoot `
        -ScriptPath "./scripts/run-local-atendimento.sh" `
        -EnvVar $runtimeEnv `
        -SkipBootstrapCheck `
        -AcceptedExitCode @(0, 143)
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
        Assert-CrmLocalLauncherContract -SourceRoot $sourceRoot
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
    $runtimeId = if ($Persona -eq "Gestor") { "gestor--full" } else { "consultor--ponto" }
    $runtimeModule = if ($Persona -eq "Gestor") { "full" } else { "ponto" }
    $configFingerprint = Get-CrmPersonaRuntimeConfigFingerprint -Persona $Persona
    $snapshot = Get-CrmLocalSourceSnapshot -TargetCommit $TargetCommit
    try {
        $sourceOrigin = Get-CrmLocalSourceOrigin -Snapshot $snapshot -Module $Module
        $decision = Get-CrmPersonaDecision -Persona $Persona -TargetCommit $TargetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin -RuntimeId $runtimeId -Module $runtimeModule -ConfigFingerprint $configFingerprint
        if ($decision.Action -eq 'reuse') {
            Open-CrmPersonaUrl -Persona $Persona -Manifest $decision.Manifest
            return
        }
        if ($decision.Action -eq 'wait') {
            Write-Host "[crm-local] A inicialização de $Persona para o commit atual já está em andamento; aguardando."
            $decision = Wait-CrmPersonaCurrent -Persona $Persona -TargetCommit $TargetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin -RuntimeId $runtimeId -Module $runtimeModule -ConfigFingerprint $configFingerprint
            if ($decision.Action -eq 'reuse') {
                Open-CrmPersonaUrl -Persona $Persona -Manifest $decision.Manifest
                return
            }
        }
        # Materialize and verify the candidate before touching the currently
        # healthy runtime. A versioned source avoids changing files underneath
        # the process that is still serving the previous revision.
        $sourceRoot = Sync-CrmLocalSourceRoot -Persona $Persona -TargetCommit $TargetCommit -Snapshot $snapshot -Versioned
        Assert-CrmLocalLauncherContract -SourceRoot $sourceRoot
        if ($decision.Action -eq 'restart') {
            Write-Host "[crm-local] Reiniciando ${Persona}: $($decision.Reason)."
            Stop-CrmPersonaRuntime -Persona $Persona
        }
        Start-CrmPersonaRuntime -Persona $Persona -SourceRoot $sourceRoot -TargetCommit $TargetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin -ConfigFingerprint $configFingerprint
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
        '-Action', 'CrmLocal', '-ProjectRoot', $ProjectRoot,
        '-CrmLocalDetachedStart'
    )
    $previousReviewRef = $env:CRM_LOCAL_REVIEW_REF
    try {
        $env:CRM_LOCAL_REVIEW_REF = $TargetCommit
        Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden `
            -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null
    } finally {
        $env:CRM_LOCAL_REVIEW_REF = $previousReviewRef
    }
    Write-Host "[crm-local] Inicialização persistente do Gestor iniciada em segundo plano para $TargetCommit."
}

function Ensure-CrmGestorForConsultor {
    param([Parameter(Mandatory = $true)][string]$TargetCommit)
    $configFingerprint = Get-CrmPersonaRuntimeConfigFingerprint -Persona Gestor
    $snapshot = Get-CrmLocalSourceSnapshot -TargetCommit $TargetCommit
    try {
        $sourceOrigin = Get-CrmLocalSourceOrigin -Snapshot $snapshot -Module 'crm-shell'
        $decision = Get-CrmPersonaDecision -Persona Gestor -TargetCommit $TargetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin -RuntimeId "gestor--full" -Module "full" -ConfigFingerprint $configFingerprint
        if ($decision.Action -eq 'reuse') { return }
        if ($decision.Action -eq 'wait') {
            $decision = Wait-CrmPersonaCurrent -Persona Gestor -TargetCommit $TargetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin -RuntimeId "gestor--full" -Module "full" -ConfigFingerprint $configFingerprint
            if ($decision.Action -eq 'reuse') { return }
        }
        if ($decision.Action -eq 'restart') { Stop-CrmPersonaRuntime -Persona Gestor }
        Start-CrmGestorBackgroundUpdate -TargetCommit $TargetCommit
        $ready = Wait-CrmPersonaCurrent -Persona Gestor -TargetCommit $TargetCommit -SourceFingerprint $snapshot.Fingerprint -SourceOrigin $sourceOrigin -RuntimeId "gestor--full" -Module "full" -ConfigFingerprint $configFingerprint -TimeoutSeconds 600
        if ($ready.Action -ne 'reuse') {
            throw "O Gestor não ficou pronto no commit $TargetCommit. Consulte '$logRoot\crm-local-gestor-action.err.log'."
        }
    } finally {
        Remove-CrmLocalSourceSnapshot -Snapshot $snapshot
    }
}

function Get-CrmLocalModuleCatalog {
    param([string]$SourceRoot = "")
    $catalogScript = if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
        Join-Path $scriptRoot "crm-local-module-catalog.mjs"
    } else {
        Join-Path $SourceRoot "scripts\crm-local-module-catalog.mjs"
    }
    if (-not (Test-Path -LiteralPath $catalogScript)) {
        throw "Catálogo modular do CRM Local não encontrado: '$catalogScript'."
    }
    $catalogProjectRoot = if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
        Split-Path -Parent $scriptRoot
    } else {
        $SourceRoot
    }
    $catalogScriptWsl = Convert-WindowsPathToWsl -Path $catalogScript
    $raw = Invoke-ShortcutWsl `
        -WorkingProjectRoot $catalogProjectRoot `
        -Executable node `
        -ArgumentList @($catalogScriptWsl, "--json") `
        -SkipBootstrapCheck
    if ($LASTEXITCODE -ne 0) {
        throw "Não foi possível descobrir os módulos locais pela fonte canônica."
    }
    try {
        return ($raw -join "`n") | ConvertFrom-Json
    } catch {
        throw "O catálogo modular do CRM Local retornou JSON inválido: $($_.Exception.Message)"
    }
}

function Get-CrmPersonaRuntimeConfigFingerprint {
    param([ValidateSet("Gestor", "Consultor")][string]$Persona)
    $catalog = Get-CrmLocalModuleCatalog
    if ($Persona -eq "Gestor") {
        if ([string]::IsNullOrWhiteSpace([string]$catalog.fullRuntime.configFingerprint)) {
            throw "O catálogo modular não publicou a configuração determinística do CRM completo."
        }
        return [string]$catalog.fullRuntime.configFingerprint
    }
    return "legacy-consultor-v3:$([string]$catalog.launcherContractFingerprint)"
}

function Assert-CrmLocalLauncherContract {
    param([Parameter(Mandatory = $true)][string]$SourceRoot)
    $callerCatalog = Get-CrmLocalModuleCatalog
    $sourceCatalog = Get-CrmLocalModuleCatalog -SourceRoot $SourceRoot
    if ([int]$callerCatalog.launcherContractVersion -ne [int]$sourceCatalog.launcherContractVersion -or
        [string]$callerCatalog.launcherContractFingerprint -ne [string]$sourceCatalog.launcherContractFingerprint) {
        throw "O contrato do launcher que recebeu a ação diverge da fonte materializada em '$SourceRoot'. Atualize/reinstale os atalhos antes de iniciar o CRM; revisões diferentes não serão misturadas."
    }
}

function Resolve-CrmLocalModuleSpec {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("Gestor", "Consultor")]
        [string]$Role,
        [Parameter(Mandatory = $true)]
        [string]$Module,
        [string]$SourceRoot = ""
    )
    $catalog = Get-CrmLocalModuleCatalog -SourceRoot $SourceRoot
    $matches = @($catalog.combinations | Where-Object {
        [string]$_.role -ieq $Role -and [string]$_.module -ceq $Module
    })
    if ($matches.Count -ne 1) {
        throw "A combinação CRM '$Role / $Module' não é liberada pela fonte canônica. Use a ação CRM – Módulos para ver somente combinações permitidas."
    }
    return $matches[0]
}

function Test-CrmSameWindowsPath {
    param(
        [Parameter(Mandatory = $true)][string]$Left,
        [Parameter(Mandatory = $true)][string]$Right
    )

    $leftPath = [IO.Path]::GetFullPath($Left).TrimEnd([char]'\', [char]'/')
    $rightPath = [IO.Path]::GetFullPath($Right).TrimEnd([char]'\', [char]'/')
    return $leftPath.Equals($rightPath, [StringComparison]::OrdinalIgnoreCase)
}

function Resolve-CrmThreadPreviewSourceCheckout {
    param([string]$SourceRoot = $ProjectRoot)

    if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
        throw 'CRM – Prévia da Thread exige o worktree da thread atual.'
    }
    $resolvedSource = (Resolve-Path -LiteralPath $SourceRoot).Path
    if (Test-CrmSameWindowsPath -Left $resolvedSource -Right $crmCanonicalProjectRoot) {
        throw 'CRM – Prévia da Thread não pode usar o clone compartilhado. Abra o worktree da thread no Codex App e execute a ação nele.'
    }
    $gitRootRaw = @(& git -C $resolvedSource rev-parse --show-toplevel 2>$null)
    $gitExit = $LASTEXITCODE
    $gitRoot = [string]($gitRootRaw | Select-Object -First 1)
    if ($gitExit -ne 0 -or [string]::IsNullOrWhiteSpace($gitRoot) -or
        -not (Test-CrmSameWindowsPath -Left ([string]$gitRoot).Trim() -Right $resolvedSource)) {
        throw "A prévia deve partir da raiz de um worktree Git: '$resolvedSource'."
    }

    $registeredWorktreeRaw = @(& git -C $crmCanonicalProjectRoot worktree list --porcelain 2>$null)
    $registeredExit = $LASTEXITCODE
    $registeredWorktrees = @($registeredWorktreeRaw |
        Where-Object { $_ -like 'worktree *' } |
        ForEach-Object { $_.Substring('worktree '.Length).Trim() })
    if ($registeredExit -ne 0 -or -not ($registeredWorktrees | Where-Object {
        Test-CrmSameWindowsPath -Left ([string]$_) -Right $resolvedSource
    })) {
        throw "A prévia deve partir de um worktree registrado do SKINCOS: '$resolvedSource'."
    }
    return $resolvedSource
}

function Get-CrmThreadPreviewTargetCommit {
    param([Parameter(Mandatory = $true)][string]$SourceCheckout)

    $targetCommitRaw = @(& git -C $SourceCheckout rev-parse --verify 'HEAD^{commit}' 2>$null)
    $targetExit = $LASTEXITCODE
    $targetCommit = ([string]($targetCommitRaw | Select-Object -First 1)).Trim().ToLowerInvariant()
    if ($targetExit -ne 0 -or $targetCommit -notmatch '^[0-9a-f]{40}$') {
        throw "Não foi possível resolver o HEAD da thread para a prévia: '$SourceCheckout'."
    }
    return $targetCommit
}

function Get-CrmThreadPreviewSpec {
    param(
        [Parameter(Mandatory = $true)][object]$BaseSpec,
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$SourceCheckout
    )

    $catalog = Get-CrmLocalModuleCatalog -SourceRoot $SourceRoot
    $catalogIndex = 0
    $found = $false
    foreach ($candidate in @($catalog.combinations)) {
        if ([string]$candidate.runtimeId -eq [string]$BaseSpec.runtimeId) {
            $found = $true
            break
        }
        $catalogIndex += 1
    }
    if (-not $found) {
        throw "A combinação de prévia '$([string]$BaseSpec.role) / $([string]$BaseSpec.module)' não existe no catálogo materializado."
    }

    $stride = [int]$catalog.portPlan.stride
    $offsets = $catalog.portPlan.offsets
    # These are only the preferred starting bundle. The isolated launcher
    # atomically selects the first complete free bundle at runtime and records
    # the actual ports in current.json.
    $portBase = $crmThreadPreviewPreferredPortBase + ($catalogIndex * $stride)
    $ports = [ordered]@{
        pages = $portBase + [int]$offsets.pages
        vite = $portBase + [int]$offsets.vite
        insumos = if ([bool]$BaseSpec.dependencies.insumos) { $portBase + [int]$offsets.insumos } else { $null }
        timekeeping = if ([bool]$BaseSpec.dependencies.timekeeping) { $portBase + [int]$offsets.timekeeping } else { $null }
        whatsapp = if ([bool]$BaseSpec.dependencies.whatsapp) { $portBase + [int]$offsets.whatsapp } else { $null }
    }
    if (@($ports.Values | Where-Object { $null -ne $_ -and ([int]$_ -lt 1 -or [int]$_ -gt 65535) }).Count -gt 0) {
        throw "O plano de portas da prévia excede a faixa permitida para '$([string]$BaseSpec.module)'."
    }

    $runtimeId = 'crm-thread-preview--{0}--{1}' -f ([string]$BaseSpec.module), ([string]$BaseSpec.roleKey).ToLowerInvariant()
    $configPayload = "thread-preview-v1`n$([string]$BaseSpec.configFingerprint)`n$runtimeId`n$($ports | ConvertTo-Json -Compress)"
    $properties = [ordered]@{}
    foreach ($property in $BaseSpec.PSObject.Properties) {
        $properties[$property.Name] = $property.Value
    }
    $properties.runtimeId = $runtimeId
    $properties.ports = [pscustomobject]$ports
    $properties.configFingerprint = 'sha256:' + (Get-CrmLocalSnapshotHash -Value $configPayload)
    $properties.threadPreview = $true
    $properties.previewSourceCheckout = $SourceCheckout
    return [pscustomobject]$properties
}

function Test-CrmThreadPreviewSpec {
    param([Parameter(Mandatory = $true)][object]$Spec)
    return $null -ne $Spec.PSObject.Properties['threadPreview'] -and [bool]$Spec.threadPreview
}

function Get-CrmInstanceRuntimeRoot {
    param([Parameter(Mandatory = $true)][object]$Spec)
    $roleSegment = ([string]$Spec.role).Trim().ToLowerInvariant()
    $moduleSegment = ([string]$Spec.module).Trim().ToLowerInvariant()
    if (Test-CrmThreadPreviewSpec -Spec $Spec) {
        return Join-Path $crmThreadPreviewInstanceRoot (Join-Path $roleSegment $moduleSegment)
    }
    return Join-Path $crmInstanceRoot (Join-Path $roleSegment $moduleSegment)
}

function Get-CrmThreadPreviewPriorReadyPath {
    param([Parameter(Mandatory = $true)][object]$Spec)
    return Join-Path (Get-CrmInstanceRuntimeRoot -Spec $Spec) 'previous-ready.json'
}

function Save-CrmThreadPreviewPriorReadyManifest {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][object]$Manifest
    )

    if ([string]$Manifest.state -ne 'ready') { return }
    $path = Get-CrmThreadPreviewPriorReadyPath -Spec $Spec
    $directory = Split-Path -Parent $path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporary = Join-Path $directory ('.previous-ready.{0}.tmp' -f ([guid]::NewGuid().ToString('N')))
    try {
        [IO.File]::WriteAllText($temporary, ($Manifest | ConvertTo-Json -Depth 16), [Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            [IO.File]::Replace($temporary, $path, $null)
        } else {
            [IO.File]::Move($temporary, $path)
        }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
    }
}

function Get-CrmThreadPreviewPriorReadyManifest {
    param([Parameter(Mandatory = $true)][object]$Spec)
    $path = Get-CrmThreadPreviewPriorReadyPath -Spec $Spec
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    try {
        $manifest = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        if ([string]$manifest.state -eq 'ready') { return $manifest }
    } catch {
        Write-Warning "[crm-thread-preview] O checkpoint de rollback de $([string]$Spec.runtimeId) não pôde ser lido; ele será ignorado."
    }
    return $null
}

function Get-CrmThreadPreviewDescriptorPath {
    param([Parameter(Mandatory = $true)][object]$Spec)
    return Join-Path (Get-CrmInstanceRuntimeRoot -Spec $Spec) 'thread-preview.json'
}

function Get-CrmThreadPreviewDescriptor {
    param([Parameter(Mandatory = $true)][object]$Spec)
    $path = Get-CrmThreadPreviewDescriptorPath -Spec $Spec
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try { return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { return $null }
}

function Write-CrmThreadPreviewDescriptor {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][string]$SourceCheckout,
        [Parameter(Mandatory = $true)][string]$MaterializedSourceRoot,
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [Parameter(Mandatory = $true)][string]$SourceFingerprint,
        [string]$PublicHost = 'localhost',
        [string]$OperationId = '',
        [Nullable[int]]$OperationPid = $null,
        [string]$OperationStartedAt = '',
        # The lifecycle state lives in the runtime's current.json. This
        # descriptor is provenance/ownership metadata written before the
        # detached launcher can finish, so "requested" remains truthful even
        # while the process transitions to ready or failed.
        [ValidateSet('requested', 'stopped')][string]$State = 'requested'
    )

    $runtimeRoot = Get-CrmInstanceRuntimeRoot -Spec $Spec
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $branch = (& git -C $SourceCheckout branch --show-current 2>$null | Select-Object -First 1).Trim()
    if ([string]::IsNullOrWhiteSpace($branch)) { $branch = '(detached)' }
    [ordered]@{
        version = 1
        kind = 'crm-thread-preview'
        state = $State
        sourceCheckout = $SourceCheckout
        sourceBranch = $branch
        materializedSource = $MaterializedSourceRoot
        targetCommit = $TargetCommit
        sourceFingerprint = $SourceFingerprint
        runtimeId = [string]$Spec.runtimeId
        role = [string]$Spec.role
        module = [string]$Spec.module
        # The actual bundle is allocated by the detached runtime. Do not
        # advertise a potentially occupied preferred URL before current.json
        # records state=ready and the Windows reachability check passes.
        preferredPorts = $Spec.ports
        requestedHost = $PublicHost
        url = $null
        runtimeManifest = 'current.json'
        operationId = $OperationId
        operationPid = $OperationPid
        operationStartedAt = $OperationStartedAt
        updatedAt = (Get-Date).ToString('o')
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Get-CrmThreadPreviewDescriptorPath -Spec $Spec) -Encoding utf8
}

function Assert-CrmThreadPreviewOwnership {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][string]$SourceCheckout
    )

    $descriptor = Get-CrmThreadPreviewDescriptor -Spec $Spec
    $manifest = Get-CrmInstanceManifest -Spec $Spec
    if ($null -eq $descriptor -and $null -ne $manifest) {
        throw "A prévia '$([string]$Spec.runtimeId)' possui um manifesto sem proveniência da thread; ela não será substituída automaticamente."
    }
    if ($null -ne $descriptor) {
        if (-not (Test-CrmSameWindowsPath -Left ([string]$descriptor.sourceCheckout) -Right $SourceCheckout)) {
            # A clean stop must release the shared role/module port for the
            # next thread. The descriptor alone is never enough: accept that
            # handoff only when both records say stopped and the recorded
            # launcher identity is no longer alive.
            $manifestStopped = $null -eq $manifest -or [string]$manifest.state -eq 'stopped'
            $launcherAlive = $false
            if ($null -ne $manifest) {
                $launcherAlive = Test-CrmManifestLauncherIdentity -Manifest $manifest
            }
            if ([string]$descriptor.state -eq 'stopped' -and $manifestStopped -and -not $launcherAlive) {
                return $null
            }
            throw "A prévia '$([string]$Spec.runtimeId)' pertence a outra thread em '$([string]$descriptor.sourceCheckout)'. Encerre-a no worktree proprietário antes de abrir esta."
        }
        if ([string]$descriptor.runtimeId -ne [string]$Spec.runtimeId -or
            [string]$descriptor.role -ne [string]$Spec.role -or
            [string]$descriptor.module -ne [string]$Spec.module) {
            throw "A proveniência da prévia '$([string]$Spec.runtimeId)' está inconsistente; ela não será reutilizada."
        }
    }
    return $descriptor
}

function Test-CrmThreadPreviewOperationInFlight {
    param(
        [object]$Descriptor,
        [object]$Manifest,
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [Parameter(Mandatory = $true)][string]$SourceFingerprint
    )

    if ($null -eq $Descriptor -or [string]$Descriptor.state -ne 'requested' -or
        [string]::IsNullOrWhiteSpace([string]$Descriptor.operationId)) {
        return $false
    }
    $readyForRequestedSnapshot = $null -ne $Manifest -and
        [string]$Manifest.state -eq 'ready' -and
        [string]$Manifest.targetCommit -eq $TargetCommit -and
        [string]$Manifest.sourceFingerprint -eq $SourceFingerprint
    if ($readyForRequestedSnapshot) { return $false }

    $pidValue = 0
    if ($null -ne $Descriptor.operationPid) {
        [void][int]::TryParse([string]$Descriptor.operationPid, [ref]$pidValue)
    }
    if ($pidValue -gt 0) {
        try {
            $process = Get-Process -Id $pidValue -ErrorAction Stop
            $expectedStart = [string]$Descriptor.operationStartedAt
            if ([string]::IsNullOrWhiteSpace($expectedStart) -or
                $process.StartTime.ToUniversalTime().ToString('o') -eq $expectedStart) {
                return $true
            }
        } catch {
            # A stale process id must never block a recovery action.
        }
    }

    try {
        $requestedAt = [DateTimeOffset]::Parse([string]$Descriptor.updatedAt)
        return (([DateTimeOffset]::UtcNow - $requestedAt.ToUniversalTime()).TotalSeconds -lt 30)
    } catch {
        return $false
    }
}

function Invoke-CrmThreadPreviewStartLock {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][scriptblock]$Operation
    )

    $mutexName = 'Local\SkincosCrmThreadPreview-{0}-{1}' -f `
        ([string]$Spec.roleKey).ToLowerInvariant(), ([string]$Spec.module).ToLowerInvariant()
    $mutex = [Threading.Mutex]::new($false, $mutexName)
    $lockHeld = $false
    try {
        try {
            $lockHeld = $mutex.WaitOne([TimeSpan]::FromSeconds(30))
        } catch [Threading.AbandonedMutexException] {
            $lockHeld = $true
            Write-Host "[crm-thread-preview] Recuperando gate abandonado de $([string]$Spec.runtimeId)."
        }
        if (-not $lockHeld) {
            throw "Tempo limite no gate da prévia '$([string]$Spec.runtimeId)'."
        }
        $result = & $Operation
        return $result
    } finally {
        if ($lockHeld) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Assert-CrmThreadPreviewMaterializedSource {
    param(
        [Parameter(Mandatory = $true)][string]$MaterializedSourceRoot,
        [Parameter(Mandatory = $true)][string]$SourceCheckout,
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [Parameter(Mandatory = $true)][string]$SourceFingerprint
    )

    $resolvedSource = (Resolve-Path -LiteralPath $MaterializedSourceRoot).Path
    $immutableRoot = Join-Path $operatorRuntimeRoot 'source\crm-local\immutable'
    if (-not (Test-WindowsPathWithinRoot -Path $resolvedSource -Root $immutableRoot)) {
        throw "A prévia da thread deve executar somente uma fonte privada imutável: '$resolvedSource'."
    }
    $actualCommitRaw = @(& git -C $resolvedSource rev-parse --verify 'HEAD^{commit}' 2>$null)
    $actualExit = $LASTEXITCODE
    $actualCommit = ([string]($actualCommitRaw | Select-Object -First 1)).Trim().ToLowerInvariant()
    if ($actualExit -ne 0 -or $actualCommit -ne $TargetCommit) {
        throw "A fonte privada da prévia não corresponde ao commit solicitado: '$resolvedSource'."
    }
    $sourceKey = (Get-CrmLocalSnapshotHash -Value $SourceFingerprint).Substring(0, 24)
    $metadataPath = Join-Path $operatorRuntimeRoot ("source\crm-local\metadata\{0}.json" -f $sourceKey)
    if (-not (Test-Path -LiteralPath $metadataPath)) {
        throw "A fonte privada da prévia não possui metadados de proveniência: '$resolvedSource'."
    }
    $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    if ([string]$metadata.fingerprint -ne $SourceFingerprint -or [string]$metadata.targetCommit -ne $TargetCommit -or
        -not (Test-CrmSameWindowsPath -Left ([string]$metadata.sourceCheckout) -Right $SourceCheckout)) {
        throw "Os metadados da prévia divergem da thread solicitada: '$resolvedSource'."
    }
    return $resolvedSource
}

function Get-CrmInstanceManifest {
    param([Parameter(Mandatory = $true)][object]$Spec)
    $path = Join-Path (Get-CrmInstanceRuntimeRoot -Spec $Spec) "current.json"
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try { return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { return $null }
}

function Get-CrmInstanceBuildPaths {
    param(
        [Parameter(Mandatory = $true)][string]$SourceFingerprint,
        [Parameter(Mandatory = $true)][string]$SourceRoot
    )
    $sourceKey = (Get-CrmLocalSnapshotHash -Value $SourceFingerprint).Substring(0, 24)
    $cacheRoot = Join-Path $crmBuildCacheRoot $sourceKey
    return [pscustomobject]@{
        Root = $cacheRoot
        State = Join-Path $cacheRoot "build-state.json"
        Lock = Join-Path $cacheRoot "build.lock"
        SourceRoot = $SourceRoot
    }
}

function Get-CrmInstanceBuildDescriptor {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$StatePath
    )
    $helper = Join-Path $SourceRoot "scripts\crm-local-build-state.mjs"
    if (-not (Test-Path -LiteralPath $helper)) {
        throw "Controle determinístico de build não encontrado: '$helper'."
    }
    $helperWsl = Convert-WindowsPathToWsl -Path $helper
    $sourceWsl = Convert-WindowsPathToWsl -Path $SourceRoot
    $stateWsl = Convert-WindowsPathToWsl -Path $StatePath
    # Several module actions can reach this calculation at once. The helper
    # streams files, but a process per module can still exhaust the WSL VM while
    # all of them traverse the same source and dist trees. Serialize only the
    # descriptor calculation; the actual build remains protected by its
    # cross-shell build lock.
    $descriptorKey = (Get-CrmLocalSnapshotHash -Value $StatePath).Substring(0, 24)
    $mutex = [Threading.Mutex]::new($false, "Local\SkincosCrmBuildDescriptor-$descriptorKey")
    $lockHeld = $false
    try {
        try {
            $lockHeld = $mutex.WaitOne([TimeSpan]::FromMinutes(10))
        } catch [Threading.AbandonedMutexException] {
            $lockHeld = $true
            Write-Host "[crm-local] Recuperando mutex abandonado da impressão de build $descriptorKey."
        }
        if (-not $lockHeld) {
            throw "Tempo limite ao calcular a impressão compartilhada do build em '$SourceRoot'."
        }
        $raw = Invoke-ShortcutWsl `
            -WorkingProjectRoot $SourceRoot `
            -Executable node `
            -ArgumentList @($helperWsl, "inspect", "--root", $sourceWsl, "--state", $stateWsl) `
            -SkipBootstrapCheck
        if ($LASTEXITCODE -ne 0) {
            throw "Não foi possível calcular a impressão do build em '$SourceRoot'."
        }
        try {
            return ($raw | Select-Object -Last 1) | ConvertFrom-Json
        } catch {
            throw "O controle de build retornou JSON inválido: $($_.Exception.Message)"
        }
    } finally {
        if ($lockHeld) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Test-CrmWslPidIdentity {
    param(
        [object]$PidValue,
        [object]$StartTicks
    )
    $pidText = [string]$PidValue
    $ticksText = [string]$StartTicks
    if ($pidText -notmatch '^[0-9]+$' -or $ticksText -notmatch '^[0-9]+$') { return $false }
    $actualTicks = Get-CrmWslPidStartTicks -PidValue $pidText
    return $null -ne $actualTicks -and [string]$actualTicks -eq $ticksText
}

function Test-CrmInstanceHealth {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][object]$Manifest,
        [Parameter(Mandatory = $true)][object]$BuildDescriptor
    )
    if (-not [bool]$BuildDescriptor.stateValid) { return $false }
    if ([string]$Manifest.build.inputFingerprint -ne [string]$BuildDescriptor.inputFingerprint) { return $false }
    if ([string]$Manifest.build.lockfileFingerprint -ne [string]$BuildDescriptor.lockfileFingerprint) { return $false }
    if ([string]$Manifest.build.artifactFingerprint -ne [string]$BuildDescriptor.artifactFingerprint) { return $false }

    if (Test-CrmThreadPreviewSpec -Spec $Spec) {
        $runtimeUri = Get-CrmManifestPublicUri -Manifest $Manifest
        $pagesPort = Get-CrmManifestPort -Manifest $Manifest -Name 'pages'
        $publicHost = Resolve-CrmRuntimePublicHost -WorkingProjectRoot $ProjectRoot
        if ($null -eq $runtimeUri -or $null -eq $pagesPort -or
            $runtimeUri.Port -ne $pagesPort -or
            ($runtimeUri.Host -notin @('localhost', '127.0.0.1', '::1') -and $runtimeUri.Host -ne $publicHost)) {
            return $false
        }
        if (-not (Test-CrmHttpEndpoint -Url (New-CrmRuntimeEndpointUrl -Uri $runtimeUri -Port $pagesPort -Path '/api/auth/me') -Role ([string]$Spec.roleKey))) {
            return $false
        }
        if (-not (Test-CrmHttpEndpoint -Url ([string]$runtimeUri.AbsoluteUri))) {
            return $false
        }
        if ([bool]$Spec.dependencies.insumos) {
            $insumosPort = Get-CrmManifestPort -Manifest $Manifest -Name 'insumos'
            if ($null -eq $insumosPort -or
                -not (Test-CrmHttpEndpoint -Url (New-CrmRuntimeEndpointUrl -Uri $runtimeUri -Port $insumosPort -Path '/insumos/health'))) {
                return $false
            }
        }
        if ([bool]$Spec.dependencies.timekeeping) {
            $timekeepingPort = Get-CrmManifestPort -Manifest $Manifest -Name 'timekeeping'
            if ($null -eq $timekeepingPort -or
                -not (Test-CrmTimekeepingReadinessEndpoint `
                    -Url (New-CrmRuntimeEndpointUrl -Uri $runtimeUri -Port $timekeepingPort -Path '/api/ponto/readiness') `
                    -TargetCommit ([string]$Manifest.targetCommit))) {
                return $false
            }
        }
        if ([bool]$Spec.dependencies.whatsapp) {
            $whatsappPort = Get-CrmManifestPort -Manifest $Manifest -Name 'whatsapp'
            if ($null -eq $whatsappPort -or
                -not (Test-CrmHttpEndpoint -Url (New-CrmRuntimeEndpointUrl -Uri $runtimeUri -Port $whatsappPort -Path '/health'))) {
                return $false
            }
        }
    } else {
        $pagesPort = [int]$Spec.ports.pages
        if (-not (Test-CrmHttpEndpoint -Url "http://127.0.0.1:$pagesPort/api/auth/me" -Role ([string]$Spec.roleKey))) {
            return $false
        }
        if (-not (Test-CrmHttpEndpoint -Url "http://127.0.0.1:$pagesPort/?module=$([string]$Spec.module)")) {
            return $false
        }
        if ([bool]$Spec.dependencies.insumos -and
            -not (Test-CrmHttpEndpoint -Url "http://127.0.0.1:$([int]$Spec.ports.insumos)/insumos/health")) {
            return $false
        }
        if ([bool]$Spec.dependencies.timekeeping -and
            -not (Test-CrmTimekeepingReadinessEndpoint `
                -Url "http://127.0.0.1:$([int]$Spec.ports.timekeeping)/api/ponto/readiness" `
                -TargetCommit ([string]$Manifest.targetCommit))) {
            return $false
        }
        if ([bool]$Spec.dependencies.whatsapp -and
            -not (Test-CrmHttpEndpoint -Url "http://127.0.0.1:$([int]$Spec.ports.whatsapp)/health")) {
            return $false
        }
    }
    return $true
}

function Get-CrmInstanceDecision {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [Parameter(Mandatory = $true)][string]$SourceFingerprint,
        [Parameter(Mandatory = $true)][string]$SourceOrigin,
        [Parameter(Mandatory = $true)][object]$BuildDescriptor,
        [Parameter(Mandatory = $true)][string]$BuildStatePath,
        [Parameter(Mandatory = $true)][string]$SourceRoot
    )
    $manifest = Get-CrmInstanceManifest -Spec $Spec
    $pidAlive = $false
    if ($null -ne $manifest) {
        $pidAlive = Test-CrmWslPidIdentity -PidValue $manifest.pids.launcher -StartTicks $manifest.pidStartTicks.launcher
    }
    $healthy = $false
    if ($pidAlive) {
        $healthy = Test-CrmInstanceHealth -Spec $Spec -Manifest $manifest -BuildDescriptor $BuildDescriptor
    }

    $runtimeRoot = Get-CrmInstanceRuntimeRoot -Spec $Spec
    $policyPath = Join-Path $SourceRoot "scripts\crm-local-runtime-policy.mjs"
    if (-not (Test-Path -LiteralPath $policyPath)) {
        throw "Política do runtime modular não encontrada na fonte executada: '$policyPath'."
    }
    $policyWsl = Convert-WindowsPathToWsl -Path $policyPath
    $manifestWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "current.json")
    $buildStateWsl = Convert-WindowsPathToWsl -Path $BuildStatePath
    $artifactFingerprint = [string]$BuildDescriptor.artifactFingerprint
    $policyArguments = @(
        $policyWsl,
        "--manifest", $manifestWsl,
        "--build-state", $buildStateWsl,
        "--target", $TargetCommit,
        "--source-fingerprint", $SourceFingerprint,
        "--source-origin", (Convert-CrmSourceOriginToWsl -SourceOrigin $SourceOrigin),
        "--persona", ([string]$Spec.roleKey),
        "--runtime-id", ([string]$Spec.runtimeId),
        "--module", ([string]$Spec.module),
        "--config-fingerprint", ([string]$Spec.configFingerprint),
        "--build-input-fingerprint", ([string]$BuildDescriptor.inputFingerprint),
        "--lockfile-fingerprint", ([string]$BuildDescriptor.lockfileFingerprint),
        "--artifact-fingerprint", $artifactFingerprint,
        "--pid-alive", $pidAlive.ToString().ToLowerInvariant(),
        "--healthy", $healthy.ToString().ToLowerInvariant()
    )
    $decisionRaw = Invoke-ShortcutWsl `
        -WorkingProjectRoot $SourceRoot `
        -Executable node `
        -ArgumentList $policyArguments `
        -SkipBootstrapCheck
    if ($LASTEXITCODE -ne 0) {
        throw "Não foi possível avaliar o runtime '$([string]$Spec.runtimeId)'."
    }
    $decision = $decisionRaw | Select-Object -Last 1 | ConvertFrom-Json
    return [pscustomobject]@{
        Action = [string]$decision.action
        Reason = [string]$decision.reason
        Manifest = $manifest
    }
}

function Open-CrmInstanceUrl {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][object]$Manifest
    )
    $runtimeRoot = Get-CrmInstanceRuntimeRoot -Spec $Spec
    $expectedProfile = Join-Path $runtimeRoot "browser\profile"
    $fallbackHost = Resolve-CrmRuntimePublicHost -WorkingProjectRoot $ProjectRoot
    $manifestPagesPort = Get-CrmManifestPort -Manifest $Manifest -Name 'pages'
    if ((Test-CrmThreadPreviewSpec -Spec $Spec) -and $null -eq $manifestPagesPort) {
        throw "O manifesto da prévia '$([string]$Spec.runtimeId)' não possui a porta Pages efetivamente alocada."
    }
    $expectedPagesPort = if ($null -ne $manifestPagesPort) { $manifestPagesPort } else { [int]$Spec.ports.pages }
    $fallbackUrl = "http://${fallbackHost}:$expectedPagesPort/?module=$([string]$Spec.module)"
    $url = if (-not [string]::IsNullOrWhiteSpace([string]$Manifest.url)) { [string]$Manifest.url } else { $fallbackUrl }
    $uri = Get-CrmManifestPublicUri -Manifest ([pscustomobject]@{ url = $url })
    if ($null -eq $uri) {
        throw "URL inválida no manifesto '$([string]$Spec.runtimeId)': '$url'."
    }
    $publicHost = Resolve-CrmRuntimePublicHost -WorkingProjectRoot $ProjectRoot
    if ($uri.Scheme -ne "http" -or
        ($uri.Host -notin @("localhost", "127.0.0.1") -and $uri.Host -ne $publicHost) -or
        $uri.Port -ne $expectedPagesPort) {
        throw "URL inválida no manifesto '$([string]$Spec.runtimeId)': '$url'."
    }
    $sourceRoot = Convert-WslPathToWindows -Path ([string]$Manifest.worktree)
    $allowedSourceRoot = Join-Path $operatorRuntimeRoot "source\crm-local\immutable"
    $resolvedSource = if (Test-Path -LiteralPath $sourceRoot) { (Resolve-Path -LiteralPath $sourceRoot).Path } else { $null }
    if ($null -eq $resolvedSource -or -not (Test-WindowsPathWithinRoot -Path $resolvedSource -Root $allowedSourceRoot)) {
        throw "O runtime '$([string]$Spec.runtimeId)' aponta para uma fonte não autorizada: '$sourceRoot'."
    }
    & (Join-Path $resolvedSource "scripts\open-crm-local-browser.ps1") -Url $url -ProfilePath $expectedProfile
    Write-Host "[crm-local] $([string]$Spec.role) / $([string]$Spec.label) reutilizado sem rebuild em $url."
}

function Stop-CrmInstanceRuntime {
    param([Parameter(Mandatory = $true)][object]$Spec)
    $runtimeRoot = Get-CrmInstanceRuntimeRoot -Spec $Spec
    $manifest = Get-CrmInstanceManifest -Spec $Spec
    if ($null -eq $manifest) {
        Write-Host "[crm-local] Não há manifesto para $([string]$Spec.role) / $([string]$Spec.label); nenhum processo será encerrado por aproximação."
        return
    }
    if (Test-CrmThreadPreviewSpec -Spec $Spec) {
        Save-CrmThreadPreviewPriorReadyManifest -Spec $Spec -Manifest $manifest
    }
    $sourceRoot = Convert-WslPathToWindows -Path ([string]$manifest.worktree
    )
    $allowedSourceRoot = Join-Path $operatorRuntimeRoot "source\crm-local\immutable"
    $resolvedSource = if (Test-Path -LiteralPath $sourceRoot) { (Resolve-Path -LiteralPath $sourceRoot).Path } else { $null }
    if ($null -eq $resolvedSource -or -not (Test-WindowsPathWithinRoot -Path $resolvedSource -Root $allowedSourceRoot)) {
        throw "O runtime '$([string]$Spec.runtimeId)' aponta para uma fonte não autorizada: '$sourceRoot'."
    }

    $runtimeRootWsl = Convert-WindowsPathToWsl -Path $runtimeRoot
    $pidWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "supervisor.pid")
    $logWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "logs\runtime.log")
    $stopEnv = @(
        "CRM_RUNTIME_ID=$([string]$Spec.runtimeId)",
        "CRM_RUNTIME_MODULE=$([string]$Spec.module)",
        "CRM_PERSONA=$([string]$Spec.roleKey)",
        "CRM_RUNTIME_ROOT=$runtimeRootWsl",
        "CRM_VITE_PORT=$([int]$Spec.ports.vite)",
        "CRM_PAGES_PORT=$([int]$Spec.ports.pages)",
        "CRM_WITH_INSUMOS=$(if ([bool]$Spec.dependencies.insumos) { 1 } else { 0 })",
        "CRM_INSUMOS_PORT=$([int]$Spec.ports.insumos)",
        "CRM_WITH_TIMEKEEPING=$(if ([bool]$Spec.dependencies.timekeeping) { 1 } else { 0 })",
        "CRM_TIMEKEEPING_PORT=$([int]$Spec.ports.timekeeping)",
        "CRM_WITH_WHATSAPP=$(if ([bool]$Spec.dependencies.whatsapp) { 1 } else { 0 })",
        "CRM_WA_ORCHESTRATOR_PORT=$([int]$Spec.ports.whatsapp)",
        "CRM_PID_FILE=$pidWsl",
        "CRM_LOG_FILE=$logWsl"
    )
    Invoke-ShortcutWsl `
        -WorkingProjectRoot $resolvedSource `
        -ScriptPath "./scripts/run-local-crm.sh" `
        -ArgumentList @("--stop") `
        -EnvVar $stopEnv `
        -SkipBootstrapCheck
}

function Export-CrmThreadPreviewInsumosSnapshot {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][string]$SourceRoot
    )
    $runtimeRoot = Get-CrmInstanceRuntimeRoot -Spec $Spec
    $snapshotRoot = Join-Path $runtimeRoot "snapshots"
    # A click may overlap the previous action for a few milliseconds before its
    # local runner publishes the runtime lock. Each export therefore owns an
    # immutable request path; only the selected path is handed to that runner.
    $snapshotPath = Join-Path $snapshotRoot ("insumos-d1-preview-{0}.json" -f ([guid]::NewGuid().ToString('N')))
    $dependencyRoot = Join-Path $runtimeRoot "dependencies\insumos"
    New-Item -ItemType Directory -Path $snapshotRoot -Force | Out-Null
    $snapshotRootWsl = Convert-WindowsPathToWsl -Path $snapshotRoot
    $snapshotPathWsl = Convert-WindowsPathToWsl -Path $snapshotPath
    $dependencyRootWsl = Convert-WindowsPathToWsl -Path $dependencyRoot
    $snapshotEnv = @(
        "INSUMOS_PREVIEW_SNAPSHOT_MODE=1",
        "INSUMOS_PREVIEW_SNAPSHOT_ROOT=$snapshotRootWsl",
        "CRM_INSUMOS_DEPENDENCY_STATE_FILE=$dependencyRootWsl/dependency-key.sha256",
        "CRM_INSUMOS_DEPENDENCY_LOCK_FILE=$dependencyRootWsl/install.lock",
        "CRM_INSUMOS_DEPENDENCY_CACHE_ROOT=$dependencyRootWsl/cache"
    )
    Write-Host "[crm-thread-preview] Atualizando snapshot D1 de Insumos antes da troca da prévia."
    Invoke-ShortcutWsl `
        -WorkingProjectRoot $SourceRoot `
        -ScriptPath "./backend/scripts/insumos.sh" `
        -ArgumentList @("snapshot-export", $snapshotPathWsl) `
        -EnvVar $snapshotEnv `
        -SkipBootstrapCheck
    if (-not (Test-Path -LiteralPath $snapshotPath -PathType Leaf)) {
        throw 'O exportador de Insumos terminou sem publicar o snapshot privado.'
    }
    $snapshotId = [string](Invoke-ShortcutWsl `
        -WorkingProjectRoot $SourceRoot `
        -Executable "node" `
        -ArgumentList @("./backend/scripts/insumos-d1-export.cjs", "--inspect", $snapshotPathWsl, "--field", "snapshotId") `
        -SkipBootstrapCheck)
    $snapshotId = $snapshotId.Trim()
    if ($snapshotId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
        throw 'O snapshot de Insumos publicado não passou na verificação de integridade.'
    }
    return [pscustomobject]@{ Path = $snapshotPath; SnapshotId = $snapshotId }
}

function Start-CrmInstanceRuntime {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [Parameter(Mandatory = $true)][string]$SourceFingerprint,
        [Parameter(Mandatory = $true)][string]$SourceOrigin,
        [Parameter(Mandatory = $true)][object]$BuildPaths,
        [string]$InsumosSnapshotPath = '',
        # Used only to restore a previously healthy local preview after the
        # replacement has already failed. Normal Insumos starts always require
        # a newly exported, verified snapshot.
        [switch]$RollbackInsumosState
    )
    $runtimeRoot = Get-CrmInstanceRuntimeRoot -Spec $Spec
    $runtimeRootWsl = Convert-WindowsPathToWsl -Path $runtimeRoot
    $portBundleLockWsl = Convert-WindowsPathToWsl -Path $crmThreadPreviewPortBundleLockPath
    $buildStateWsl = Convert-WindowsPathToWsl -Path $BuildPaths.State
    $buildLockWsl = Convert-WindowsPathToWsl -Path $BuildPaths.Lock
    $playwrightCacheWsl = Convert-WindowsPathToWsl -Path $crmPlaywrightCacheRoot
    $browserProfileWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "browser\profile")
    $browserScriptWsl = Convert-WindowsPathToWsl -Path (Join-Path $SourceRoot "scripts\open-crm-local-browser.ps1")
    $pidWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "supervisor.pid")
    $logWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "logs\runtime.log")
    $pagesStateWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "state\pages")
    $insumosStateWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "state\insumos")
    # Snapshot export, local migrations and seed must share one private,
    # source-specific dependency cache. Otherwise the immutable source link
    # can point at the already verified cache while the runner calculates a
    # different default below its build directory.
    $insumosDependencyRootWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "dependencies\insumos")
    $timekeepingStateWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "state\timekeeping")
    $whatsappStateWsl = Convert-WindowsPathToWsl -Path (Join-Path $runtimeRoot "state\whatsapp")
    $gateModules = [string]$Spec.module
    $roleKey = [string]$Spec.roleKey
    $roleLower = $roleKey.ToLowerInvariant()
    $module = [string]$Spec.module
    $localAuthAdmin = if ([bool]$Spec.auth.testUserAdmin) { "true" } else { "false" }
    $allowedModules = @($Spec.auth.allowedModules) -join ","
    $allowedUnits = @($Spec.auth.allowedUnits) -join ","
    # Gestor previews need both synthetic units for the team flow and Insumos
    # needs the same scope when its catalog does not declare explicit units.
    # These are loopback-only grants and never affect production identities.
    if ([string]::IsNullOrWhiteSpace($allowedUnits) -and ($roleKey -eq 'GESTOR' -or $module -eq 'insumos')) {
        $allowedUnits = 'novo-hamburgo,barra-shopping-sul'
    }
    $withInsumos = if ([bool]$Spec.dependencies.insumos) { 1 } else { 0 }
    $withTimekeeping = if ([bool]$Spec.dependencies.timekeeping) { 1 } else { 0 }
    $withWhatsapp = if ([bool]$Spec.dependencies.whatsapp) { 1 } else { 0 }
    $dynamicPortBundle = if (Test-CrmThreadPreviewSpec -Spec $Spec) { 1 } else { 0 }
    $refreshInsumosSnapshot = $dynamicPortBundle -eq 1 -and $module -eq 'insumos' -and -not $RollbackInsumosState
    $openBrowser = if ($CrmRuntimeSuppressBrowser) { 0 } else { 1 }
    $username = "$roleLower-$module-local"
    $email = "$roleLower.$module@local.test"
    $displayName = "$([string]$Spec.role) Local - $([string]$Spec.label)"
    $localScenario = [string]$Spec.localScenario
    $nativeSourceKey = (Get-CrmLocalSnapshotHash -Value $SourceFingerprint).Substring(0, 16)
    $whatsappSourceWsl = "/home/admin/.cache/skincos/crm-local/$([string]$Spec.runtimeId)/whatsapp-$nativeSourceKey"

    New-Item -ItemType Directory -Path (Join-Path $runtimeRoot "logs") -Force | Out-Null
    New-Item -ItemType Directory -Path $BuildPaths.Root -Force | Out-Null
    New-Item -ItemType Directory -Path $crmPlaywrightCacheRoot -Force | Out-Null

    $publicHost = Resolve-CrmRuntimePublicHost -WorkingProjectRoot $SourceRoot
    $runtimeEnv = @(
        "CRM_RUNTIME_ID=$([string]$Spec.runtimeId)",
        "CRM_RUNTIME_MODULE=$module",
        "CRM_PERSONA=$roleKey",
        "CRM_TARGET_COMMIT=$TargetCommit",
        "CRM_SOURCE_FINGERPRINT=$SourceFingerprint",
        "CRM_SOURCE_ORIGIN=$SourceOrigin",
        "CRM_RUNTIME_CONFIG_FINGERPRINT=$([string]$Spec.configFingerprint)",
        "CRM_RUNTIME_ROOT=$runtimeRootWsl",
        "CRM_BUILD_STATE_FILE=$buildStateWsl",
        "CRM_BUILD_LOCK_DIR=$buildLockWsl",
        "PLAYWRIGHT_BROWSERS_PATH=$playwrightCacheWsl",
        "CRM_BROWSER_PROFILE_DIR=$browserProfileWsl",
        "CRM_BROWSER_SCRIPT=$browserScriptWsl",
        "LOCAL_AUTH_BYPASS=true",
        "LOCAL_AUTH_TEST_USER_ADMIN=$localAuthAdmin",
        "LOCAL_AUTH_ROLE=$roleKey",
        "LOCAL_AUTH_USERNAME=$username",
        "LOCAL_AUTH_EMAIL=$email",
        "LOCAL_AUTH_NAME=$displayName",
        "LOCAL_AUTH_ALLOWED_MODULES=$allowedModules",
        "LOCAL_AUTH_ALLOWED_UNITS=$allowedUnits",
        "DEV_AUTH_ALLOWED_MODULES=$allowedModules",
        "DEV_AUTH_ALLOWED_UNITS=$allowedUnits",
        "LOCAL_AUTH_ALLOWED_HOSTS=$publicHost",
        "CRM_VITE_PORT=$([int]$Spec.ports.vite)",
        "CRM_PAGES_PORT=$([int]$Spec.ports.pages)",
        "CRM_DYNAMIC_PORT_BUNDLE=$dynamicPortBundle",
        "CRM_PORT_BUNDLE_STRIDE=10",
        "CRM_PORT_BUNDLE_MAX_ATTEMPTS=200",
        "CRM_PORT_BUNDLE_LOCK_FILE=$portBundleLockWsl",
        "CRM_HOST=$publicHost",
        "CRM_PUBLIC_HOST=$publicHost",
        "CRM_BIND_HOST=0.0.0.0",
        "CRM_WITH_INSUMOS=$withInsumos",
        "CRM_INSUMOS_PORT=$([int]$Spec.ports.insumos)",
        "CRM_INSUMOS_PERSIST_DIR=$insumosStateWsl",
        "CRM_INSUMOS_DEPENDENCY_STATE_FILE=$insumosDependencyRootWsl/dependency-key.sha256",
        "CRM_INSUMOS_DEPENDENCY_LOCK_FILE=$insumosDependencyRootWsl/install.lock",
        "CRM_INSUMOS_DEPENDENCY_CACHE_ROOT=$insumosDependencyRootWsl/cache",
        "CRM_WITH_TIMEKEEPING=$withTimekeeping",
        "CRM_TIMEKEEPING_PRIVATE_ROOT=$crmTimekeepingPrivateRootWsl",
        "CRM_TIMEKEEPING_PORT=$([int]$Spec.ports.timekeeping)",
        "CRM_TIMEKEEPING_PERSIST_DIR=$timekeepingStateWsl",
        "CRM_WITH_WHATSAPP=$withWhatsapp",
        "CRM_WA_ORCHESTRATOR_PORT=$([int]$Spec.ports.whatsapp)",
        "CRM_LOCAL_WA_RUNTIME_HOME=$whatsappStateWsl",
        "CRM_LOCAL_WA_SOURCE_HOME=$whatsappSourceWsl",
        "R2_PERSIST_DIR=$pagesStateWsl",
        "CRM_ISOLATED_RUNTIME=1",
        "CRM_LOCAL_ISOLATED=1",
        "CRM_BUILD_BEFORE_START=auto",
        "CRM_GATE_STRICT=1",
        "CRM_GATE_MODULES=$gateModules",
        "CRM_OPEN_BROWSER=$openBrowser",
        "CRM_PID_FILE=$pidWsl",
        "CRM_LOG_FILE=$logWsl"
    )
    $runtimeEnv += @(
        "LOCAL_ESCALA_MOCK=true",
        "LOCAL_ESCALA_SHADOW_WRITES=false",
        "INTEGRATIONS_ENCRYPTION_SECRET=skincos-$([string]$Spec.runtimeId)-local-integrations",
        "REQUIRE_INTEGRATIONS_ENCRYPTION_SECRET=true"
    )
    if (-not [string]::IsNullOrWhiteSpace($localScenario)) {
        $runtimeEnv += "CRM_META_ADS_SCENARIO=$localScenario"
    }
    if ($refreshInsumosSnapshot) {
        if ([string]::IsNullOrWhiteSpace($InsumosSnapshotPath) -or
            -not (Test-Path -LiteralPath $InsumosSnapshotPath -PathType Leaf)) {
            throw 'A prévia de Insumos exige um snapshot D1 privado e validado antes de iniciar.'
        }
        # The snapshot is exported before the previous preview is stopped. The
        # runner verifies it again and always uses a fresh private D1 state.
        $snapshotRoot = Join-Path $runtimeRoot "snapshots"
        $snapshotRootWsl = Convert-WindowsPathToWsl -Path $snapshotRoot
        $snapshotPathWsl = Convert-WindowsPathToWsl -Path $InsumosSnapshotPath
        $runtimeEnv += @(
            "CRM_REFRESH_INSUMOS_SNAPSHOT=0",
            "CRM_INSUMOS_SNAPSHOT=$snapshotPathWsl",
            "CRM_INSUMOS_PREVIEW_SNAPSHOT=1",
            "CRM_INSUMOS_PREVIEW_SNAPSHOT_ROOT=$snapshotRootWsl"
        )
    }
    if ($module -eq 'users') {
        # The Users preview is the local integration sandbox for the unified
        # team flow. Keep the flag and seed scoped to this loopback module.
        $runtimeEnv += "UNIFIED_TEAM_ENABLED=1"
        $runtimeEnv += "LOCAL_CRM_TEAM_SEED=1"
    }
    if ($withWhatsapp -eq 1) {
        # The local CRM adapter also owns the isolated /api/crm admin stubs.
        # Point Pages at this loopback target so a preview never falls through
        # to the hosted API while exercising a worktree-only module.
        $localCrmApiTarget = "http://127.0.0.1:$([int]$Spec.ports.whatsapp)"
        $runtimeEnv += "CRM_API_TARGET=$localCrmApiTarget"
        $runtimeEnv += "INSUMOS_API_TARGET=$localCrmApiTarget"
        $runtimeEnv += "UNIT_MONITOR_API_TARGET=http://127.0.0.1:$([int]$Spec.ports.whatsapp)"
    }
    Invoke-ShortcutWsl `
        -WorkingProjectRoot $SourceRoot `
        -ScriptPath "./scripts/run-local-crm.sh" `
        -ArgumentList @("--module", $module) `
        -EnvVar $runtimeEnv `
        -SkipBootstrapCheck `
        -AcceptedExitCode @(0, 130, 143)
}

function Restore-CrmThreadPreviewPriorRuntime {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][object]$PriorManifest,
        [Parameter(Mandatory = $true)][string]$SourceCheckout
    )

    if ([string]$PriorManifest.state -ne 'ready') {
        throw 'A prévia anterior não estava pronta; não há rollback automático seguro.'
    }
    $priorSource = Convert-WslPathToWindows -Path ([string]$PriorManifest.worktree)
    $allowedSourceRoot = Join-Path $operatorRuntimeRoot 'source\crm-local\immutable'
    $resolvedPriorSource = if (Test-Path -LiteralPath $priorSource) { (Resolve-Path -LiteralPath $priorSource).Path } else { $null }
    if ($null -eq $resolvedPriorSource -or -not (Test-WindowsPathWithinRoot -Path $resolvedPriorSource -Root $allowedSourceRoot)) {
        throw 'A fonte da prévia anterior não está mais disponível no runtime privado.'
    }
    $priorTargetCommit = [string]$PriorManifest.targetCommit
    $priorFingerprint = [string]$PriorManifest.sourceFingerprint
    if ($priorTargetCommit -notmatch '^[0-9a-f]{40}$' -or [string]::IsNullOrWhiteSpace($priorFingerprint)) {
        throw 'A proveniência da prévia anterior está incompleta; rollback automático recusado.'
    }

    Assert-CrmLocalLauncherContract -SourceRoot $resolvedPriorSource
    $priorBaseSpec = Resolve-CrmLocalModuleSpec -Role ([string]$Spec.role) -Module ([string]$Spec.module) -SourceRoot $resolvedPriorSource
    $priorSpec = Get-CrmThreadPreviewSpec -BaseSpec $priorBaseSpec -SourceRoot $resolvedPriorSource -SourceCheckout $SourceCheckout
    if ([string]$priorSpec.runtimeId -ne [string]$Spec.runtimeId) {
        throw 'A combinação da prévia anterior não corresponde ao runtime que precisa ser restaurado.'
    }
    $priorBuildPaths = Get-CrmInstanceBuildPaths -SourceFingerprint $priorFingerprint -SourceRoot $resolvedPriorSource
    $priorSourceOrigin = [string]$PriorManifest.sourceOrigin
    if ([string]::IsNullOrWhiteSpace($priorSourceOrigin)) {
        $priorSourceOrigin = '{0}__{1}' -f (Convert-WindowsPathToWsl -Path $resolvedPriorSource), ([string]$priorSpec.runtimeId)
    }

    Write-Warning "[crm-thread-preview] A nova prévia falhou; restaurando a versão anterior de $([string]$Spec.runtimeId)."
    Start-CrmInstanceRuntime `
        -Spec $priorSpec `
        -SourceRoot $resolvedPriorSource `
        -TargetCommit $priorTargetCommit `
        -SourceFingerprint $priorFingerprint `
        -SourceOrigin $priorSourceOrigin `
        -BuildPaths $priorBuildPaths `
        -RollbackInsumosState
}

function Test-CrmThreadPreviewPriorRuntimeStillReady {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][object]$PriorManifest
    )

    $current = Get-CrmInstanceManifest -Spec $Spec
    if ($null -eq $current -or [string]$current.state -ne 'ready') { return $false }
    if ([string]$current.targetCommit -ne [string]$PriorManifest.targetCommit -or
        [string]$current.sourceFingerprint -ne [string]$PriorManifest.sourceFingerprint) {
        return $false
    }
    return Test-CrmManifestLauncherIdentity -Manifest $current
}

function Wait-CrmInstanceCurrent {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [Parameter(Mandatory = $true)][string]$SourceFingerprint,
        [Parameter(Mandatory = $true)][string]$SourceOrigin,
        [Parameter(Mandatory = $true)][object]$BuildPaths,
        [int]$TimeoutSeconds = 900
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $descriptor = Get-CrmInstanceBuildDescriptor -SourceRoot $BuildPaths.SourceRoot -StatePath $BuildPaths.State
        $decision = Get-CrmInstanceDecision -Spec $Spec -TargetCommit $TargetCommit -SourceFingerprint $SourceFingerprint -SourceOrigin $SourceOrigin -BuildDescriptor $descriptor -BuildStatePath $BuildPaths.State -SourceRoot $BuildPaths.SourceRoot
        if ($decision.Action -eq "reuse") { return $decision }
        if ($decision.Action -ne "wait") { return $decision }
        Start-Sleep -Seconds 2
    }
    return [pscustomobject]@{ Action = "restart"; Reason = "startup_timeout"; Manifest = (Get-CrmInstanceManifest -Spec $Spec) }
}

function Start-CrmInstanceBackgroundUpdate {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][string]$TargetCommit
    )
    $runtimeRoot = Get-CrmInstanceRuntimeRoot -Spec $Spec
    New-Item -ItemType Directory -Path (Join-Path $runtimeRoot "logs") -Force | Out-Null
    $outLog = Join-Path $runtimeRoot "logs\action.out.log"
    $errLog = Join-Path $runtimeRoot "logs\action.err.log"
    $arguments = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath,
        "-Action", "CrmModule", "-ProjectRoot", $ProjectRoot,
        "-CrmRole", [string]$Spec.role, "-CrmModule", [string]$Spec.module,
        "-CrmRuntimeDetachedStart"
    )
    if ($CrmRuntimeSuppressBrowser) {
        $arguments += "-CrmRuntimeSuppressBrowser"
    }
    $previousReviewRef = $env:CRM_LOCAL_REVIEW_REF
    try {
        $env:CRM_LOCAL_REVIEW_REF = $TargetCommit
        Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden `
            -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null
    } finally {
        $env:CRM_LOCAL_REVIEW_REF = $previousReviewRef
    }
    if ($CrmRuntimeSuppressBrowser) {
        Write-Host "[crm-local] $([string]$Spec.role) / $([string]$Spec.label) iniciou em segundo plano; navegador suprimido pela validação interna."
    } else {
        Write-Host "[crm-local] $([string]$Spec.role) / $([string]$Spec.label) iniciou em segundo plano; o navegador abrirá após o gate."
    }
}

function Invoke-CrmModuleAction {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("Gestor", "Consultor")]
        [string]$Role,
        [Parameter(Mandatory = $true)]
        [string]$Module
    )
    $spec = Resolve-CrmLocalModuleSpec -Role $Role -Module $Module
    $targetCommit = Get-CrmLocalTargetCommit
    if (-not $CrmRuntimeDetachedStart) {
        Start-CrmInstanceBackgroundUpdate -Spec $spec -TargetCommit $targetCommit
        return
    }

    $snapshot = Get-CrmLocalSourceSnapshot -TargetCommit $targetCommit
    $sourceFingerprint = [string]$snapshot.Fingerprint
    try {
        $sourceRoot = Sync-CrmLocalImmutableSourceRoot -TargetCommit $targetCommit -Snapshot $snapshot
        $sourceSpec = Resolve-CrmLocalModuleSpec -Role $Role -Module $Module -SourceRoot $sourceRoot
        if ([string]$sourceSpec.runtimeId -ne [string]$spec.runtimeId -or
            [string]$sourceSpec.configFingerprint -ne [string]$spec.configFingerprint) {
            throw "O catálogo do launcher diverge da fonte materializada para '$Role / $Module'; a instância não será iniciada com contratos misturados."
        }
        $spec = $sourceSpec
        $sourceOrigin = "{0}__{1}" -f $sourceRoot, ([string]$spec.runtimeId)
        $buildPaths = Get-CrmInstanceBuildPaths -SourceFingerprint ([string]$snapshot.Fingerprint) -SourceRoot $sourceRoot
        New-Item -ItemType Directory -Path $buildPaths.Root -Force | Out-Null
        $descriptor = Get-CrmInstanceBuildDescriptor -SourceRoot $sourceRoot -StatePath $buildPaths.State
        $decision = Get-CrmInstanceDecision -Spec $spec -TargetCommit $targetCommit -SourceFingerprint ([string]$snapshot.Fingerprint) -SourceOrigin $sourceOrigin -BuildDescriptor $descriptor -BuildStatePath $buildPaths.State -SourceRoot $sourceRoot
        if ($decision.Action -eq "reuse") {
            if ($CrmRuntimeSuppressBrowser) {
                Write-Host "[crm-local] $([string]$spec.role) / $([string]$spec.label) reutilizado sem rebuild; navegador suprimido pela validação interna."
            } else {
                Open-CrmInstanceUrl -Spec $spec -Manifest $decision.Manifest
            }
            return
        }
        if ($decision.Action -eq "wait") {
            $ready = Wait-CrmInstanceCurrent -Spec $spec -TargetCommit $targetCommit -SourceFingerprint ([string]$snapshot.Fingerprint) -SourceOrigin $sourceOrigin -BuildPaths $buildPaths
            if ($ready.Action -eq "reuse") {
                if ($CrmRuntimeSuppressBrowser) {
                    Write-Host "[crm-local] $([string]$spec.role) / $([string]$spec.label) ficou pronto; navegador suprimido pela validação interna."
                } else {
                    Open-CrmInstanceUrl -Spec $spec -Manifest $ready.Manifest
                }
                return
            }
            $decision = $ready
        }
        if ($decision.Action -eq "restart") {
            Write-Host "[crm-local] Atualizando somente $([string]$spec.runtimeId): $($decision.Reason)."
            Stop-CrmInstanceRuntime -Spec $spec
        }
        Remove-CrmLocalSourceSnapshot -Snapshot $snapshot
        $snapshot = $null
        Start-CrmInstanceRuntime -Spec $spec -SourceRoot $sourceRoot -TargetCommit $targetCommit -SourceFingerprint $sourceFingerprint -SourceOrigin $sourceOrigin -BuildPaths $buildPaths
    } finally {
        Remove-CrmLocalSourceSnapshot -Snapshot $snapshot
    }
}

function Show-CrmModulesMenu {
    $catalog = Get-CrmLocalModuleCatalog
    while ($true) {
        $roleOptions = @($catalog.roles | ForEach-Object {
            New-MenuOption -Label ([string]$_.role) -Action ([string]$_.role)
        })
        $roleSelection = Read-MenuSelection -Title "CRM – Módulos" -Options $roleOptions -CancelLabel "Sair"
        if ($null -eq $roleSelection) { return }
        $selectedRole = [string]$roleSelection.Action
        $moduleOptions = @($catalog.combinations | Where-Object { [string]$_.role -eq $selectedRole } | ForEach-Object {
            New-MenuOption -Label ([string]$_.label) -Action ([string]$_.module)
        })
        $moduleSelection = Read-MenuSelection -Title "CRM – $selectedRole" -Options $moduleOptions
        if ($null -eq $moduleSelection) { continue }
        Invoke-CrmModuleAction -Role $selectedRole -Module ([string]$moduleSelection.Action)
    }
}

function Start-CrmThreadPreviewBackgroundUpdate {
    param(
        [Parameter(Mandatory = $true)][object]$Spec,
        [Parameter(Mandatory = $true)][string]$SourceCheckout,
        [Parameter(Mandatory = $true)][string]$MaterializedSourceRoot,
        [Parameter(Mandatory = $true)][string]$TargetCommit,
        [Parameter(Mandatory = $true)][string]$SourceFingerprint,
        [Parameter(Mandatory = $true)][string]$OperationId,
        [string]$PublicHost = 'localhost'
    )

    $runtimeRoot = Get-CrmInstanceRuntimeRoot -Spec $Spec
    New-Item -ItemType Directory -Path (Join-Path $runtimeRoot 'logs') -Force | Out-Null
    $outLog = Join-Path $runtimeRoot 'logs\action.out.log'
    $errLog = Join-Path $runtimeRoot 'logs\action.err.log'
    $arguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
        '-Action', 'CrmThreadPreview', '-ProjectRoot', $SourceCheckout,
        '-CrmRole', [string]$Spec.role, '-CrmModule', [string]$Spec.module,
        '-CrmThreadPreviewSourceRoot', $SourceCheckout,
        '-CrmThreadPreviewMaterializedSourceRoot', $MaterializedSourceRoot,
        '-CrmThreadPreviewTargetCommit', $TargetCommit,
        '-CrmThreadPreviewSourceFingerprint', $SourceFingerprint,
        '-CrmThreadPreviewDetachedStart'
    )
    if ($CrmRuntimeSuppressBrowser) {
        $arguments += '-CrmRuntimeSuppressBrowser'
    }
    $process = Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    $operationStartedAt = $process.StartTime.ToUniversalTime().ToString('o')
    Write-CrmThreadPreviewDescriptor `
        -Spec $Spec `
        -SourceCheckout $SourceCheckout `
        -MaterializedSourceRoot $MaterializedSourceRoot `
        -TargetCommit $TargetCommit `
        -SourceFingerprint $SourceFingerprint `
        -PublicHost $PublicHost `
        -OperationId $OperationId `
        -OperationPid $process.Id `
        -OperationStartedAt $operationStartedAt
    Write-Host "[crm-thread-preview] $([string]$Spec.role) / $([string]$Spec.label) está preparando a prévia em segundo plano; a URL só será publicada após o gate de prontidão."
}

function Invoke-CrmThreadPreviewAction {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Gestor', 'Consultor')][string]$Role,
        [Parameter(Mandatory = $true)][string]$Module,
        [string]$SourceRoot = $ProjectRoot
    )

    $sourceCheckout = Resolve-CrmThreadPreviewSourceCheckout -SourceRoot $SourceRoot
    if ($CrmThreadPreviewDetachedStart) {
        foreach ($required in @(
            $CrmThreadPreviewMaterializedSourceRoot,
            $CrmThreadPreviewTargetCommit,
            $CrmThreadPreviewSourceFingerprint
        )) {
            if ([string]::IsNullOrWhiteSpace([string]$required)) {
                throw 'A inicialização destacada da prévia perdeu a proveniência da thread; ela foi recusada.'
            }
        }
        $materializedSource = Assert-CrmThreadPreviewMaterializedSource `
            -MaterializedSourceRoot $CrmThreadPreviewMaterializedSourceRoot `
            -SourceCheckout $sourceCheckout `
            -TargetCommit $CrmThreadPreviewTargetCommit `
            -SourceFingerprint $CrmThreadPreviewSourceFingerprint
        Assert-CrmLocalLauncherContract -SourceRoot $materializedSource
        $baseSpec = Resolve-CrmLocalModuleSpec -Role $Role -Module $Module -SourceRoot $materializedSource
        $spec = Get-CrmThreadPreviewSpec -BaseSpec $baseSpec -SourceRoot $materializedSource -SourceCheckout $sourceCheckout
        $null = Assert-CrmThreadPreviewOwnership -Spec $spec -SourceCheckout $sourceCheckout
        $sourceOrigin = '{0}__{1}' -f $materializedSource, ([string]$spec.runtimeId)
        $buildPaths = Get-CrmInstanceBuildPaths -SourceFingerprint $CrmThreadPreviewSourceFingerprint -SourceRoot $materializedSource
        New-Item -ItemType Directory -Path $buildPaths.Root -Force | Out-Null
        $descriptor = Get-CrmInstanceBuildDescriptor -SourceRoot $materializedSource -StatePath $buildPaths.State
        $decision = Get-CrmInstanceDecision `
            -Spec $spec `
            -TargetCommit $CrmThreadPreviewTargetCommit `
            -SourceFingerprint $CrmThreadPreviewSourceFingerprint `
            -SourceOrigin $sourceOrigin `
            -BuildDescriptor $descriptor `
            -BuildStatePath $buildPaths.State `
            -SourceRoot $materializedSource
        $refreshInsumosSnapshot = (Test-CrmThreadPreviewSpec -Spec $spec) -and ([string]$spec.module -eq 'insumos')
        if ($refreshInsumosSnapshot -and $decision.Action -eq 'reuse') {
            # A ready process proves its code and health, not that its D1 data
            # is current. A direct Insumos action therefore starts a new
            # private snapshot; concurrent actions still coalesce in wait.
            $decision = [pscustomobject]@{
                Action = 'restart'
                Reason = 'insumos_snapshot_refresh_required'
                Manifest = $decision.Manifest
            }
        }
        if ($decision.Action -eq 'reuse') {
            if ($CrmRuntimeSuppressBrowser) {
                Write-Host "[crm-thread-preview] $([string]$spec.runtimeId) já está pronto para este snapshot."
            } else {
                Open-CrmInstanceUrl -Spec $spec -Manifest $decision.Manifest
            }
            return
        }
        if ($decision.Action -eq 'wait') {
            $ready = Wait-CrmInstanceCurrent `
                -Spec $spec `
                -TargetCommit $CrmThreadPreviewTargetCommit `
                -SourceFingerprint $CrmThreadPreviewSourceFingerprint `
                -SourceOrigin $sourceOrigin `
                -BuildPaths $buildPaths
            if ($ready.Action -eq 'reuse') {
                if ($CrmRuntimeSuppressBrowser) {
                    Write-Host "[crm-thread-preview] $([string]$spec.runtimeId) ficou pronto para este snapshot."
                } else {
                    Open-CrmInstanceUrl -Spec $spec -Manifest $ready.Manifest
                }
                return
            }
            $decision = $ready
        }
        $insumosSnapshot = $null
        $priorManifest = if ($decision.Action -eq 'restart') { Get-CrmInstanceManifest -Spec $spec } else { $null }
        if ($decision.Action -eq 'restart' -and ($null -eq $priorManifest -or [string]$priorManifest.state -ne 'ready')) {
            # A cross-worktree handoff arrives with a stopped current.json.
            # Its last verified ready manifest is retained privately by the
            # owner that performed the clean stop and is the only fallback
            # accepted for automatic recovery.
            $priorManifest = Get-CrmThreadPreviewPriorReadyManifest -Spec $spec
        }
        try {
            if ($refreshInsumosSnapshot) {
                # Export and integrity failure normally happen before the
                # prior preview is stopped. A handoff may already be stopped,
                # in which case the saved ready manifest below restores it.
                $insumosSnapshot = Export-CrmThreadPreviewInsumosSnapshot -Spec $spec -SourceRoot $materializedSource
            }
            if ($decision.Action -eq 'restart') {
                Write-Host "[crm-thread-preview] Atualizando $([string]$spec.runtimeId): $($decision.Reason)."
                Stop-CrmInstanceRuntime -Spec $spec
            }
            Start-CrmInstanceRuntime `
                -Spec $spec `
                -SourceRoot $materializedSource `
                -TargetCommit $CrmThreadPreviewTargetCommit `
                -SourceFingerprint $CrmThreadPreviewSourceFingerprint `
                -SourceOrigin $sourceOrigin `
                -BuildPaths $buildPaths `
                -InsumosSnapshotPath ([string]$insumosSnapshot.Path)
        } catch {
            $replacementError = $_
            if ($null -eq $priorManifest -or [string]$priorManifest.state -ne 'ready') {
                throw
            }
            if (Test-CrmThreadPreviewPriorRuntimeStillReady -Spec $spec -PriorManifest $priorManifest) {
                throw "A nova prévia falhou antes da troca; a versão anterior permanece pronta: $($replacementError.Exception.Message)"
            }
            try {
                # A partially started replacement must be stopped before the
                # known-good runtime reclaims its dynamic port bundle.
                Stop-CrmInstanceRuntime -Spec $spec
                Restore-CrmThreadPreviewPriorRuntime `
                    -Spec $spec `
                    -PriorManifest $priorManifest `
                    -SourceCheckout $sourceCheckout
            } catch {
                throw "A nova prévia falhou: $($replacementError.Exception.Message). O rollback automático também falhou: $($_.Exception.Message)"
            }
            throw "A nova prévia falhou, mas a versão anterior foi restaurada: $($replacementError.Exception.Message)"
        }
        return
    }

    $targetCommit = Get-CrmThreadPreviewTargetCommit -SourceCheckout $sourceCheckout
    $snapshot = Get-CrmLocalSourceSnapshot `
        -TargetCommit $targetCommit `
        -SourceRoot $sourceCheckout `
        -IncludeWorkingChanges
    try {
        $materializedSource = Sync-CrmLocalImmutableSourceRoot -TargetCommit $targetCommit -Snapshot $snapshot
        Assert-CrmLocalLauncherContract -SourceRoot $materializedSource
        $baseSpec = Resolve-CrmLocalModuleSpec -Role $Role -Module $Module -SourceRoot $materializedSource
        $spec = Get-CrmThreadPreviewSpec -BaseSpec $baseSpec -SourceRoot $materializedSource -SourceCheckout $sourceCheckout
        $publicHost = Resolve-CrmRuntimePublicHost -WorkingProjectRoot $sourceCheckout
        $started = Invoke-CrmThreadPreviewStartLock -Spec $spec -Operation {
            $ownedDescriptor = Assert-CrmThreadPreviewOwnership -Spec $spec -SourceCheckout $sourceCheckout
            $currentManifest = Get-CrmInstanceManifest -Spec $spec
            if (Test-CrmThreadPreviewOperationInFlight `
                -Descriptor $ownedDescriptor `
                -Manifest $currentManifest `
                -TargetCommit $targetCommit `
                -SourceFingerprint ([string]$snapshot.Fingerprint)) {
                Write-Host "[crm-thread-preview] $([string]$spec.runtimeId) já possui uma atualização em andamento; a solicitação foi agrupada."
                return $false
            }
            $operationId = [guid]::NewGuid().ToString()
            Write-CrmThreadPreviewDescriptor `
                -Spec $spec `
                -SourceCheckout $sourceCheckout `
                -MaterializedSourceRoot $materializedSource `
                -TargetCommit $targetCommit `
                -SourceFingerprint ([string]$snapshot.Fingerprint) `
                -PublicHost $publicHost `
                -OperationId $operationId
            Start-CrmThreadPreviewBackgroundUpdate `
                -Spec $spec `
                -SourceCheckout $sourceCheckout `
                -MaterializedSourceRoot $materializedSource `
                -TargetCommit $targetCommit `
                -SourceFingerprint ([string]$snapshot.Fingerprint) `
                -OperationId $operationId `
                -PublicHost $publicHost
            return $true
        }
        if (-not $started) { return }
        Write-Host "[crm-thread-preview] Fonte: $sourceCheckout"
        Write-Host "[crm-thread-preview] Commit: $targetCommit | Snapshot: $([string]$snapshot.Fingerprint)"
        Write-Host "[crm-thread-preview] Acompanhe o manifesto em $(Join-Path (Get-CrmInstanceRuntimeRoot -Spec $spec) 'current.json'); use somente a URL registrada quando state=ready."
    } finally {
        Remove-CrmLocalSourceSnapshot -Snapshot $snapshot
    }
}

function Stop-CrmThreadPreviewAction {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Gestor', 'Consultor')][string]$Role,
        [Parameter(Mandatory = $true)][string]$Module,
        [string]$SourceRoot = $ProjectRoot
    )

    $sourceCheckout = Resolve-CrmThreadPreviewSourceCheckout -SourceRoot $SourceRoot
    $baseSpec = Resolve-CrmLocalModuleSpec -Role $Role -Module $Module -SourceRoot $sourceCheckout
    $spec = Get-CrmThreadPreviewSpec -BaseSpec $baseSpec -SourceRoot $sourceCheckout -SourceCheckout $sourceCheckout
    $descriptor = Assert-CrmThreadPreviewOwnership -Spec $spec -SourceCheckout $sourceCheckout
    if ($null -eq $descriptor) {
        Write-Host "[crm-thread-preview] Não há prévia registrada para $([string]$spec.role) / $([string]$spec.label)."
        return
    }
    Stop-CrmInstanceRuntime -Spec $spec
    Write-CrmThreadPreviewDescriptor `
        -Spec $spec `
        -SourceCheckout $sourceCheckout `
        -MaterializedSourceRoot ([string]$descriptor.materializedSource) `
        -TargetCommit ([string]$descriptor.targetCommit) `
        -SourceFingerprint ([string]$descriptor.sourceFingerprint) `
        -State stopped
    Write-Host "[crm-thread-preview] Prévia encerrada: $([string]$spec.runtimeId)."
}

function Show-CrmThreadPreviewMenu {
    $sourceCheckout = Resolve-CrmThreadPreviewSourceCheckout -SourceRoot $ProjectRoot
    $catalog = Get-CrmLocalModuleCatalog -SourceRoot $sourceCheckout
    while ($true) {
        $operation = Read-MenuSelection -Title "CRM – Prévia da Thread ($([IO.Path]::GetFileName($sourceCheckout)))" -Options @(
            (New-MenuOption -Label 'Abrir ou atualizar prévia isolada' -Action 'start'),
            (New-MenuOption -Label 'Encerrar prévia desta thread' -Action 'stop')
        ) -CancelLabel 'Sair'
        if ($null -eq $operation) { return }
        $roleOptions = @($catalog.roles | ForEach-Object {
            New-MenuOption -Label ([string]$_.role) -Action ([string]$_.role)
        })
        $roleSelection = Read-MenuSelection -Title 'Prévia — papel' -Options $roleOptions -CancelLabel 'Voltar'
        if ($null -eq $roleSelection) { continue }
        $selectedRole = [string]$roleSelection.Action
        $moduleOptions = @($catalog.combinations | Where-Object { [string]$_.role -eq $selectedRole } | ForEach-Object {
            New-MenuOption -Label ([string]$_.label) -Action ([string]$_.module)
        })
        $moduleSelection = Read-MenuSelection -Title "Prévia — $selectedRole" -Options $moduleOptions -CancelLabel 'Voltar'
        if ($null -eq $moduleSelection) { continue }
        if ([string]$operation.Action -eq 'start') {
            Invoke-CrmThreadPreviewAction -Role $selectedRole -Module ([string]$moduleSelection.Action) -SourceRoot $sourceCheckout
        } else {
            Stop-CrmThreadPreviewAction -Role $selectedRole -Module ([string]$moduleSelection.Action) -SourceRoot $sourceCheckout
        }
    }
}

foreach ($path in @(
    $efAppStateRoot,
    $efAppOutputRoot,
    $efAppClientRegistrationRunRoot,
    $efAppDebugRoot,
    $efAppLogRoot,
    $efAppChromeProfileRoot
)) {
    if (-not (Test-Path -LiteralPath $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

$efAppEnvVars = @(
    "EF_OUTPUT_DIR=$(Convert-WindowsPathToWsl -Path $efAppOutputRoot)",
    "EF_DEBUG_DIR=$(Convert-WindowsPathToWsl -Path $efAppDebugRoot)",
    "EF_LOG_DIR=$(Convert-WindowsPathToWsl -Path $efAppLogRoot)",
    "EF_CHROME_USER_DATA_DIR=$(Convert-WindowsPathToWsl -Path $efAppChromeProfileRoot)",
    "EF_BOOKING_ENV_FILE=$(Convert-WindowsPathToWsl -Path $efAppBookingEnvFile)",
    "EF_AGENDA_SYNC_ENV_FILE=$(Convert-WindowsPathToWsl -Path $efAppAgendaSyncEnvFile)",
    "EF_LOGIN_ENV_FILE=$(Convert-WindowsPathToWsl -Path $efAppLoginEnvFile)"
)

function Protect-EfAppLoginEnvFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Path /setowner "*$sid" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha ao definir o proprietário do arquivo privado de login do EF App." }
    & icacls.exe $Path /grant:r "*$($sid):F" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha ao restringir a DACL do arquivo privado de login do EF App." }
    & icacls.exe $Path /inheritance:r /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha ao remover a herança da DACL do arquivo privado de login do EF App." }
}

function Test-EfAppLoginEnvFile {
    if (-not (Test-Path -LiteralPath $efAppLoginEnvFile -PathType Leaf)) {
        return $false
    }

    $present = @{
        EF_LOGIN_EMAIL = $false
        EF_LOGIN_PASSWORD = $false
    }
    try {
        foreach ($line in Get-Content -LiteralPath $efAppLoginEnvFile) {
            $trimmed = $line.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#')) { continue }
            if ($trimmed -notmatch '^(?:export\s+)?(?<key>EF_LOGIN_EMAIL|EF_LOGIN_PASSWORD)\s*=(?<value>.*)$') { continue }
            $value = $Matches.value.Trim().Trim('"').Trim("'")
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                $present[$Matches.key] = $true
            }
        }
    } catch {
        return $false
    }
    return [bool]($present.EF_LOGIN_EMAIL -and $present.EF_LOGIN_PASSWORD)
}

function Save-EfAppLoginCredentials {
    param(
        [Parameter(Mandatory = $true)][string]$Email,
        [Parameter(Mandatory = $true)][Security.SecureString]$Password
    )

    if ([string]::IsNullOrWhiteSpace($Email) -or $Password.Length -eq 0) {
        return $false
    }
    if ($Email.IndexOfAny([char[]]"`r`n$([char]0)") -ge 0) {
        throw "O email não pode conter quebras de linha."
    }

    $passwordBstr = [IntPtr]::Zero
    $temporaryPath = $null
    try {
        $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
        $passwordValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
        if ([string]::IsNullOrWhiteSpace($passwordValue)) {
            return $false
        }
        if ($passwordValue.IndexOfAny([char[]]"`r`n$([char]0)") -ge 0) {
            throw "A senha não pode conter quebras de linha."
        }

        $parent = Split-Path -Parent $efAppLoginEnvFile
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        $temporaryPath = Join-Path $parent (".login-{0}.tmp" -f [Guid]::NewGuid().ToString('N'))
        $contents = "EF_LOGIN_EMAIL=$($Email.Trim())`nEF_LOGIN_PASSWORD=$passwordValue`n"
        [IO.File]::WriteAllText($temporaryPath, $contents, [Text.UTF8Encoding]::new($false))
        Protect-EfAppLoginEnvFile -Path $temporaryPath
        Move-Item -LiteralPath $temporaryPath -Destination $efAppLoginEnvFile -Force
        $temporaryPath = $null
        Protect-EfAppLoginEnvFile -Path $efAppLoginEnvFile
        return $true
    } finally {
        if ($passwordBstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
        }
        if ($null -ne $temporaryPath -and (Test-Path -LiteralPath $temporaryPath)) {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Ensure-EfAppLoginCredentials {
    if (Test-EfAppLoginEnvFile) {
        Protect-EfAppLoginEnvFile -Path $efAppLoginEnvFile
        return $true
    }

    Write-Host "[ef-app] Credenciais de login não encontradas no armazenamento privado." -ForegroundColor Yellow
    $email = (Read-Host "Email do app Espaço Facial").Trim()
    if ([string]::IsNullOrWhiteSpace($email)) {
        Write-Host "Credenciais não informadas; ação cancelada." -ForegroundColor Yellow
        return $false
    }
    $password = Read-Host "Senha do app Espaço Facial" -AsSecureString
    try {
        if (-not (Save-EfAppLoginCredentials -Email $email -Password $password)) {
            Write-Host "Credenciais não informadas; ação cancelada." -ForegroundColor Yellow
            return $false
        }
    } finally {
        $password.Dispose()
    }
    Write-Host "[ef-app] Credenciais salvas no armazenamento privado do operador."
    return $true
}

function New-EfAppClientRegistrationOutputDirectory {
    <#
    Client Registration uses a checkpoint CSV.  A shared report directory can
    silently make a first run look like a resume, so ordinary menu launches
    always receive their own operator-private directory.  Resume remains
    possible only with an explicit private directory selected by the operator.
    #>
    $resumeOutputDirectory = ([string]$env:EF_CLIENT_REGISTRATION_RESUME_OUTPUT_DIR).Trim()
    $runRoot = (Resolve-Path -LiteralPath $efAppClientRegistrationRunRoot).Path.TrimEnd([char]'\', [char]'/')
    if (-not [string]::IsNullOrWhiteSpace($resumeOutputDirectory)) {
        if (-not (Test-Path -LiteralPath $resumeOutputDirectory -PathType Container)) {
            throw "O diretório de retomada do cadastro de clientes não existe: '$resumeOutputDirectory'."
        }
        $resolvedResumeDirectory = (Resolve-Path -LiteralPath $resumeOutputDirectory).Path.TrimEnd([char]'\', [char]'/')
        if (-not (Test-WindowsPathWithinRoot -Path $resolvedResumeDirectory -Root $runRoot) -or
            $resolvedResumeDirectory.Equals($runRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "O diretório de retomada do cadastro de clientes deve ser uma execução privada abaixo de '$runRoot'."
        }
        $runId = [IO.Path]::GetFileName($resolvedResumeDirectory)
        if ([string]::IsNullOrWhiteSpace($runId)) {
            throw "O diretório de retomada do cadastro de clientes não possui um identificador de execução válido."
        }
        return [pscustomobject]@{
            OutputDirectory = $resolvedResumeDirectory
            RunId = $runId
            LaunchMode = 'explicit_resume'
        }
    }

    $runId = "{0}-{1}" -f `
        (Get-Date).ToUniversalTime().ToString("yyyyMMdd'T'HHmmssfff'Z'"), `
        ([Guid]::NewGuid().ToString('N').Substring(0, 12))
    $outputDirectory = Join-Path $runRoot $runId
    New-Item -ItemType Directory -Path $outputDirectory -ErrorAction Stop | Out-Null
    return [pscustomobject]@{
        OutputDirectory = $outputDirectory
        RunId = $runId
        LaunchMode = 'fresh'
    }
}

function Get-EfAppUnitOptions {
    $configuredOptions = [string]$env:EF_UNIT_OPTIONS
    if ([string]::IsNullOrWhiteSpace($configuredOptions)) {
        $configuredOptions = [string]$env:EF_UNITS
    }
    if ([string]::IsNullOrWhiteSpace($configuredOptions)) {
        return @("BarraShoppingSul", "Novo Hamburgo")
    }

    return @(
        $configuredOptions -split ',' |
            ForEach-Object { $_.Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Select-Object -Unique
    )
}

function Select-EfAppUnitName {
    param([Parameter(Mandatory = $true)][string]$Mode)

    $configuredUnit = [string]$env:EF_UNIT_NAME
    if (-not [string]::IsNullOrWhiteSpace($configuredUnit)) {
        return $configuredUnit.Trim()
    }

    $options = @(Get-EfAppUnitOptions)
    if ($options.Count -eq 0) {
        throw "Nenhuma unidade do EF App está configurada. Defina EF_UNIT_OPTIONS ou EF_UNITS."
    }
    if ($options.Count -eq 1) {
        return [string]$options[0]
    }

    $menuOptions = @($options | ForEach-Object {
        New-MenuOption -Label ([string]$_) -Action ([string]$_)
    })
    $selection = Read-MenuSelection `
        -Title ("EF App > {0} > Unidade" -f $Mode) `
        -Options $menuOptions `
        -CancelLabel "Cancelar"
    if ($null -eq $selection) {
        Write-Host "Unidade não selecionada." -ForegroundColor Yellow
        return $null
    }
    return [string]$selection.Action
}

function Read-EfAppCashDateRange {
    $today = (Get-Date).Date
    $defaultStart = $today.AddDays(-7)
    $defaultEnd = $today

    while ($true) {
        $startRaw = Read-Host ("Data inicial (DD/MM/AAAA; ENTER p/ padrão: {0})" -f $defaultStart.ToString('dd/MM/yyyy'))
        $endRaw = Read-Host ("Data final (DD/MM/AAAA; ENTER p/ padrão: {0})" -f $defaultEnd.ToString('dd/MM/yyyy'))
        $startValue = if ([string]::IsNullOrWhiteSpace($startRaw)) { $defaultStart } else { $null }
        $endValue = if ([string]::IsNullOrWhiteSpace($endRaw)) { $defaultEnd } else { $null }

        if ($null -eq $startValue) {
            [datetime]$parsedStart = [datetime]::MinValue
            if (-not [datetime]::TryParseExact($startRaw.Trim(), 'dd/MM/yyyy', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsedStart)) {
                Write-Host "Data inicial inválida. Use DD/MM/AAAA." -ForegroundColor Yellow
                continue
            }
            $startValue = $parsedStart.Date
        }
        if ($null -eq $endValue) {
            [datetime]$parsedEnd = [datetime]::MinValue
            if (-not [datetime]::TryParseExact($endRaw.Trim(), 'dd/MM/yyyy', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsedEnd)) {
                Write-Host "Data final inválida. Use DD/MM/AAAA." -ForegroundColor Yellow
                continue
            }
            $endValue = $parsedEnd.Date
        }
        if ($endValue -lt $startValue) {
            Write-Host "A data final não pode ser menor que a inicial." -ForegroundColor Yellow
            continue
        }

        return [pscustomobject]@{
            Start = $startValue.ToString('dd/MM/yyyy')
            End = $endValue.ToString('dd/MM/yyyy')
        }
    }
}

function Invoke-EfAppPythonMode {
    param(
        [string]$Mode,
        [string[]]$ExtraEnvVar = @(),
        [switch]$Headed
    )

    $normalizedMode = $Mode.Trim().ToLowerInvariant()
    $headlessValue = if ($Headed) { "HEADLESS=0" } else { "HEADLESS=1" }
    $modeEnvVars = @("EF_MODE=$Mode", $headlessValue)
    if ($normalizedMode -in @("caixa", "cash", "agenda_delta")) {
        $unitName = Select-EfAppUnitName -Mode $Mode
        if ([string]::IsNullOrWhiteSpace($unitName)) {
            return
        }
        $modeEnvVars += "EF_UNIT_NAME=$unitName"
    }
    if ($normalizedMode -in @("caixa", "cash")) {
        $dateRange = Read-EfAppCashDateRange
        $modeEnvVars += @(
            "EF_CASH_START_DATE=$($dateRange.Start)",
            "EF_CASH_END_DATE=$($dateRange.End)"
        )
    }
    if (-not (Ensure-EfAppLoginCredentials)) {
        return
    }
    $modeSpecificEnvVars = @()
    $launcherEnvVars = $efAppEnvVars
    if ($normalizedMode -eq "client_registration") {
        if ($ExtraEnvVar | Where-Object { $_ -like "EF_OUTPUT_DIR=*" }) {
            throw "EF_OUTPUT_DIR não pode sobrescrever a execução isolada de Client Registration. Use EF_CLIENT_REGISTRATION_RESUME_OUTPUT_DIR para uma retomada explícita."
        }
        $clientRegistrationRun = New-EfAppClientRegistrationOutputDirectory
        $launcherEnvVars = @($efAppEnvVars | Where-Object { $_ -notlike "EF_OUTPUT_DIR=*" })
        $modeSpecificEnvVars = @(
            "EF_OUTPUT_DIR=$(Convert-WindowsPathToWsl -Path $clientRegistrationRun.OutputDirectory)",
            "EF_CLIENT_REGISTRATION_RUN_ID=$($clientRegistrationRun.RunId)",
            "EF_CLIENT_REGISTRATION_LAUNCH_MODE=$($clientRegistrationRun.LaunchMode)"
        )
        Write-Host "[ef-app] Client Registration: saída privada $($clientRegistrationRun.LaunchMode) em $($clientRegistrationRun.OutputDirectory)"
    }
    Invoke-ShortcutWsl `
        -ScriptPath "integration/ef/scripts/run-local-python.sh" `
        -ArgumentList @("run_scraper.py") `
        -EnvVar ($launcherEnvVars + $modeEnvVars + $modeSpecificEnvVars + $ExtraEnvVar) `
        -SkipNodeCheck `
        -SkipNpmCheck
}

function Invoke-ShortcutActionInternal {
    param([string]$SelectedAction)

    if ($SelectedAction -like 'Crm*' -and $SelectedAction -notin @('CrmThreadPreview', 'CrmUsersThreadPreview')) {
        Use-CrmLaunchSource
    }

    switch ($SelectedAction) {
        "SharedSetup" { Invoke-RepoPowerShellScript -ScriptName "setup-shared-codex-workspace.ps1" }
        "SharedValidate" { Invoke-RepoPowerShellScript -ScriptName "validate-shared-codex-workspace.ps1" }
        "RuntimeSetup" { & (Join-Path $scriptRoot "setup-shared-runtime.ps1") }
        "RuntimeValidate" { & (Join-Path $scriptRoot "validate-shared-runtime.ps1") }
        "WslAccountBootstrap" {
            Invoke-ShortcutWsl `
                -ScriptPath "orb/engine/scripts/bootstrap-imported-wsl-account.sh" `
                -SkipBootstrapCheck
        }
        "GitHubAuthLoginWsl" {
            Invoke-ShortcutWsl `
                -Executable gh `
                -ArgumentList @("auth", "login", "--web", "--git-protocol", "https", "--hostname", "github.com") `
                -SkipBootstrapCheck `
                -SkipNodeCheck `
                -SkipNpmCheck `
                -SkipGitCheck
            Invoke-ShortcutWsl `
                -Executable gh `
                -ArgumentList @("auth", "status") `
                -SkipBootstrapCheck `
                -SkipNodeCheck `
                -SkipNpmCheck `
                -SkipGitCheck
        }
        "GitHubAuthStatus" {
            & (Join-Path $scriptRoot "show-github-auth-status.ps1") -ProjectRoot $ProjectRoot
        }
        "SharedStatus" { Invoke-RepoPowerShellScript -ScriptName "show-shared-codex-status.ps1" }
        "CodexContext" { Invoke-ShortcutWsl -ScriptPath "./scripts/codex-context.sh" }
        "CodexContextOnline" {
            Invoke-ShortcutWsl -ScriptPath "./scripts/codex-context.sh" -ArgumentList @("--online")
        }
        "ThreadBootstrap" { & (Join-Path $scriptRoot "print-codex-thread-bootstrap.ps1") -Interactive }
        "NewWorktree" { & (Join-Path $scriptRoot "new-shared-worktree.ps1") -Fetch }
        "WebsiteLocalStart" {
            $websiteSourceWsl = Convert-WindowsPathToWsl -Path $websiteSourceRoot
            Invoke-ShortcutWsl `
                -ScriptPath "./scripts/prepare-local-website-source.sh" `
                -ArgumentList @($websiteSourceWsl, "/home/admin/.cache/skincos-local-root")
            Invoke-ShortcutWsl `
                -ScriptPath "./scripts/run-local-website.sh" `
                -EnvVar @(
                    "WEBSITE_SOURCE_ROOT=/home/admin/.cache/skincos-local-root",
                    "WEBSITE_SKIP_WORKERD_CHECK=0",
                    "WEBSITE_STATE_DIR=$tmpRootWsl",
                    "WEBSITE_PID_FILE=$websitePidWsl",
                    "WEBSITE_LOG_FILE=$websiteLogWsl",
                    "WEBSITE_PORT_FILE=$websitePortWsl",
                    "WEBSITE_DETACH=1",
                    "OPEN_BROWSER=0"
                )
        }
        "WebsiteLocalStop" {
            Invoke-ShortcutWsl `
                -ScriptPath "./scripts/run-local-website.sh" `
                -ArgumentList @("--stop") `
                -EnvVar @(
                    "WEBSITE_SOURCE_ROOT=/home/admin/.cache/skincos-local-root",
                    "WEBSITE_STATE_DIR=$tmpRootWsl",
                    "WEBSITE_PID_FILE=$websitePidWsl",
                    "WEBSITE_PORT_FILE=$websitePortWsl"
                )
        }
        "WebsiteSiteCheck" { Invoke-ShortcutWsl -NpmScript "codex:site:check" }
        "WebsiteReleaseCheck" { Invoke-ShortcutWsl -NpmScript "codex:site:release-check" }
        "CrmLocal" {
            # run-local-crm keeps the process group alive while it supervises
            # Pages and its dependencies.  The user-facing shortcut must hand
            # that group to a hidden PowerShell child; otherwise closing the
            # invoking terminal tears down a healthy Gestor preview.
            if (-not $CrmLocalDetachedStart) {
                $targetCommit = Get-CrmLocalTargetCommit
                Start-CrmGestorBackgroundUpdate -TargetCommit $targetCommit
                return
            }
            Stop-LegacyCrmRuntimeIfNeeded
            Stop-LegacyCrmPersonaRuntimeIfNeeded
            $targetCommit = Get-CrmLocalTargetCommit
            Invoke-CrmPersonaAction -Persona Gestor -TargetCommit $targetCommit
        }
        "CrmModules" {
            Show-CrmModulesMenu
        }
        "CrmThreadPreview" {
            $threadPreviewSource = if ([string]::IsNullOrWhiteSpace($CrmThreadPreviewSourceRoot)) {
                $ProjectRoot
            } else {
                $CrmThreadPreviewSourceRoot
            }
            if ($CrmThreadPreviewDetachedStart) {
                if ([string]::IsNullOrWhiteSpace($CrmRole) -or [string]::IsNullOrWhiteSpace($CrmModule)) {
                    throw 'A inicialização destacada da prévia exige -CrmRole e -CrmModule.'
                }
                Invoke-CrmThreadPreviewAction -Role $CrmRole -Module $CrmModule -SourceRoot $threadPreviewSource
                return
            }
            if ($CrmThreadPreviewStop) {
                if ([string]::IsNullOrWhiteSpace($CrmRole) -or [string]::IsNullOrWhiteSpace($CrmModule)) {
                    throw 'O encerramento da prévia exige -CrmRole e -CrmModule.'
                }
                Stop-CrmThreadPreviewAction -Role $CrmRole -Module $CrmModule -SourceRoot $threadPreviewSource
                return
            }
            if ([string]::IsNullOrWhiteSpace($CrmRole) -and [string]::IsNullOrWhiteSpace($CrmModule)) {
                Show-CrmThreadPreviewMenu
                return
            }
            if ([string]::IsNullOrWhiteSpace($CrmRole) -or [string]::IsNullOrWhiteSpace($CrmModule)) {
                throw 'CRM – Prévia da Thread exige -CrmRole e -CrmModule juntos, ou nenhum para abrir o menu.'
            }
            Invoke-CrmThreadPreviewAction -Role $CrmRole -Module $CrmModule -SourceRoot $threadPreviewSource
        }
        "CrmUsersThreadPreview" {
            $threadPreviewSource = if ([string]::IsNullOrWhiteSpace($CrmThreadPreviewSourceRoot)) {
                $ProjectRoot
            } else {
                $CrmThreadPreviewSourceRoot
            }
            Invoke-CrmThreadPreviewAction -Role Gestor -Module "users" -SourceRoot $threadPreviewSource
        }
        "CrmModule" {
            if ([string]::IsNullOrWhiteSpace($CrmRole) -or [string]::IsNullOrWhiteSpace($CrmModule)) {
                throw "CrmModule exige -CrmRole Gestor|Consultor e -CrmModule <módulo>."
            }
            Invoke-CrmModuleAction -Role $CrmRole -Module $CrmModule
        }
        "CrmModuleStop" {
            if ([string]::IsNullOrWhiteSpace($CrmRole) -or [string]::IsNullOrWhiteSpace($CrmModule)) {
                throw "CrmModuleStop exige -CrmRole Gestor|Consultor e -CrmModule <módulo>."
            }
            $spec = Resolve-CrmLocalModuleSpec -Role $CrmRole -Module $CrmModule
            Stop-CrmInstanceRuntime -Spec $spec
        }
        "CrmConsultor" {
            Invoke-CrmModuleAction -Role Consultor -Module "ponto"
        }
        "CrmConsultorStop" {
            $spec = Resolve-CrmLocalModuleSpec -Role Consultor -Module "ponto"
            Stop-CrmInstanceRuntime -Spec $spec
        }
        "CrmSiteEf" {
            Invoke-CrmModuleAction -Role Gestor -Module "site-tracking"
        }
        "CrmMetaAds" {
            Invoke-CrmModuleAction -Role Gestor -Module "meta-ads"
        }
        "CrmFinance" {
            Invoke-ShortcutWsl -NpmScript "crm:local:finance" -AcceptedExitCode @(0, 130, 143)
        }
        "CrmAtendimento" {
            Invoke-CrmModuleAction -Role Gestor -Module "atendimento"
        }
        "CrmAtendimentoMirrorPreflight" {
            Invoke-ShortcutWsl -NpmScript "codex:crm:atendimento-mirror-preflight"
        }
        "CrmAtendimentoMirrorStatus" {
            Invoke-ShortcutWsl -NpmScript "codex:crm:atendimento-mirror-status"
        }
        "CrmAtendimentoMirrorSync" {
            Invoke-ShortcutWsl -NpmScript "codex:crm:atendimento-mirror-sync" -ArgumentList @("--apply")
        }
        "CrmLocalStop" {
            Invoke-ShortcutWsl -NpmScript "crm:local:finance:stop"
            Stop-CrmPersonaRuntime -Persona Gestor
            Stop-LegacyCrmRuntimeIfNeeded
        }
        "CrmMemory" { Invoke-ShortcutWsl -ScriptPath "./scripts/codex-memory-crm.sh" }
        "CrmSiteSmoke" { Invoke-ShortcutWsl -NpmScript "codex:crm:site-smoke" }
        "CrmMetaAdsSmoke" { Invoke-ShortcutWsl -NpmScript "codex:crm:meta-ads-smoke" }
        "CrmFinanceSmoke" { Invoke-ShortcutWsl -NpmScript "codex:crm:finance-smoke" }
        "CrmAtendimentoSmoke" { Invoke-ShortcutWsl -NpmScript "codex:crm:atendimento-smoke" }
        "PlatformLocalStart" {
            Invoke-ShortcutWsl `
                -ScriptPath "./backend/scripts/dev.sh" `
                -ArgumentList @("watch") `
                -EnvVar @("OPEN_BROWSER=0")
        }
        "EfAppSetup" {
            Invoke-ShortcutWsl `
                -ScriptPath "integration/ef/scripts/setup-local-venv.sh" `
                -EnvVar $efAppEnvVars `
                -SkipNodeCheck `
                -SkipNpmCheck
        }
        "EfAppSelftest" {
            Invoke-ShortcutWsl `
                -ScriptPath "integration/ef/scripts/run-local-python.sh" `
                -ArgumentList @("selftest.py") `
                -EnvVar ($efAppEnvVars + @("HEADLESS=1")) `
                -SkipNodeCheck `
                -SkipNpmCheck
        }
        "EfAppCaixa" { Invoke-EfAppPythonMode -Mode "caixa" }
        "EfAppAgendaDelta" { Invoke-EfAppPythonMode -Mode "agenda_delta" }
        "EfAppAgendaFullSync" {
            if (-not (Ensure-EfAppLoginCredentials)) { return }
            Invoke-ShortcutWsl `
                -ScriptPath "integration/ef/run_agenda_full_sync_all_units.sh" `
                -EnvVar ($efAppEnvVars + @(
                    "HEADLESS=1",
                    "EF_OUTPUT_BASE_DIR=$(Convert-WindowsPathToWsl -Path $efAppOutputRoot)"
                )) `
                -SkipNodeCheck `
                -SkipNpmCheck
        }
        "EfAppBookingApi" { Invoke-EfAppPythonMode -Mode "booking_api" }
        "EfAppProcedures" { Invoke-EfAppPythonMode -Mode "procedures" }
        "EfAppClientRegistration" { Invoke-EfAppPythonMode -Mode "client_registration" }
        "EfAppRecorder" { Invoke-EfAppPythonMode -Mode "recorder" -Headed }
        "EfAppRotateAgendaSyncToken" {
            Invoke-ShortcutWsl `
                -ScriptPath "integration/ef/scripts/rotate_agenda_sync_token.sh" `
                -ArgumentList @("--website-dir", "website") `
                -EnvVar $efAppEnvVars `
                -SkipNodeCheck `
                -SkipNpmCheck
        }
        "OrbStatus" {
            Invoke-ShortcutWsl -ScriptPath "scripts/runtime/manage-native-runtime.sh" -ArgumentList @("status")
        }
        "OrbRestart" {
            Invoke-ShortcutWsl -ScriptPath "scripts/runtime/manage-native-runtime.sh" -ArgumentList @("restart")
        }
        "OrbRepair" {
            Invoke-ShortcutWsl -ScriptPath "scripts/runtime/prepare-lifecycle-layout.sh" -ArgumentList @("--apply")
            Invoke-ShortcutWsl -ScriptPath "scripts/runtime/install-lifecycle-units.sh" -ArgumentList @("--apply")
            Invoke-ShortcutWsl -ScriptPath "scripts/runtime/manage-native-runtime.sh" -ArgumentList @("restart")
            Invoke-ShortcutWsl -ScriptPath "scripts/runtime/manage-native-runtime.sh" -ArgumentList @("validate")
        }
        "OrbLogs" {
            Invoke-ShortcutWsl -ScriptPath "scripts/runtime/manage-native-runtime.sh" -ArgumentList @("logs", "200")
        }
        "MetaAdsPublishPreflight" {
            Invoke-ShortcutWsl -ScriptPath "orb/engine/scripts/validate-meta-ads-publish-preflight.sh"
        }
        "OrbValidate" {
            Invoke-ShortcutWsl -ScriptPath "scripts/runtime/manage-native-runtime.sh" -ArgumentList @("validate")
        }
        "OrbBusinessValidate" {
            Invoke-ShortcutWsl -ScriptPath "orb/engine/scripts/validate-mini-pc-business-readiness.sh"
        }
        "OrbAudit" {
            Invoke-ShortcutWsl -ScriptPath "orb/engine/scripts/audit-mini-pc-service-footprint.sh"
        }
        "OrbSupportServicesApply" {
            Invoke-ShortcutWsl -ScriptPath "./scripts/runtime/install-lifecycle-units.sh" -ArgumentList @("--apply")
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
            $importArguments = @()
            if ($importChoice.Action -eq "Apply") {
                $importArguments += "--apply"
            }
            if (-not [string]::IsNullOrWhiteSpace($projectId)) {
                $importArguments += @("--project-id", $projectId)
            }

            Invoke-ShortcutWsl `
                -ScriptPath "orb/engine/scripts/import-clinic-workflows-live.sh" `
                -ArgumentList $importArguments
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
                (New-MenuOption -Label "CRM – Local" -Action "CrmLocal"),
                (New-MenuOption -Label "CRM – Módulos" -Action "CrmModules"),
                (New-MenuOption -Label "Encerrar CRM – Local" -Action "CrmLocalStop")
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
