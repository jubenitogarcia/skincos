[CmdletBinding()]
param(
    [ValidateSet('status', 'install-candidate', 'activate-stable', 'deactivate')]
    [string]$Action = 'status',
    [string]$ProjectRoot,
    [string]$ActivationCheckout,
    [string]$RuntimeRoot = 'C:\CodexRuntime\operator\admin\skincos\thread-routing-bridge',
    [string]$GlobalHooksPath = 'C:\Users\admin\.codex\hooks.json',
    [string]$RuntimeRegistryRoot = 'C:\CodexRuntime\operator\admin\skincos\worktree-registry',
    [string]$WorktreeRoot = 'C:\CodexShared\Worktrees\skincos',
    [string]$CodexManagedWorktreeRoot = 'C:\CodexShared\Worktrees\skincos\admin\managed',
    [int]$CandidateTtlSeconds = 900,
    [string]$ActivationNonce,
    [string]$Repository = 'jubenitogarcia/skincos',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Normalize-PathString {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ''
    }
    try {
        return ([IO.Path]::GetFullPath($Path)).Replace('/', '\').TrimEnd([char[]]'\').ToLowerInvariant()
    }
    catch {
        return $Path.Replace('/', '\').TrimEnd([char[]]'\').ToLowerInvariant()
    }
}

function Test-PathEqual {
    param([string]$Left, [string]$Right)
    return (Normalize-PathString -Path $Left) -eq (Normalize-PathString -Path $Right)
}

function Test-PathWithinRoot {
    param([string]$Path, [string]$Root)

    $normalizedPath = Normalize-PathString -Path $Path
    $normalizedRoot = Normalize-PathString -Path $Root
    return -not [string]::IsNullOrWhiteSpace($normalizedPath) -and
        -not [string]::IsNullOrWhiteSpace($normalizedRoot) -and
        ($normalizedPath -eq $normalizedRoot -or $normalizedPath.StartsWith("$normalizedRoot\"))
}

function Get-Sha256File {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
}

function Get-Sha256Text {
    param([Parameter(Mandatory = $true)][string]$Value)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $algorithm.Dispose()
    }
}

function Read-JsonOrNull {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }
    try {
        return (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop)
    }
    catch {
        return $null
    }
}

function Write-JsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )

    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporary = Join-Path $directory ('.{0}.{1}.tmp' -f ([IO.Path]::GetFileName($Path)), [guid]::NewGuid().ToString('N'))
    try {
        [IO.File]::WriteAllText($temporary, (($Value | ConvertTo-Json -Depth 32) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    }
    finally {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
}

function Get-GitValue {
    param([string]$Root, [string[]]$Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& git -C $Root @Arguments 2>$null | ForEach-Object { [string]$_ })
        if ($LASTEXITCODE -ne 0) {
            return $null
        }
        return ($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Resolve-GitCheckout {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$RequireClean
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Checkout inexistente: '$Path'."
    }
    $root = Get-GitValue -Root $Path -Arguments @('rev-parse', '--show-toplevel')
    $head = Get-GitValue -Root $Path -Arguments @('rev-parse', '--verify', 'HEAD^{commit}')
    if ([string]::IsNullOrWhiteSpace($root) -or [string]::IsNullOrWhiteSpace($head)) {
        throw "O caminho não é um checkout Git registrado com HEAD: '$Path'."
    }
    $origin = Get-GitValue -Root $root -Arguments @('remote', 'get-url', 'origin')
    if ([string]::IsNullOrWhiteSpace($origin)) {
        throw "O checkout não possui origin verificável: '$root'."
    }
    $normalizedOrigin = $origin.Trim().Replace('\', '/')
    $normalizedOrigin = $normalizedOrigin -replace '^(?i:https?://github\.com/)', ''
    $normalizedOrigin = $normalizedOrigin -replace '^(?i:ssh://git@github\.com/)', ''
    $normalizedOrigin = $normalizedOrigin -replace '^(?i:git@github\.com:)', ''
    $normalizedOrigin = $normalizedOrigin.TrimEnd('/')
    if ($normalizedOrigin.EndsWith('.git', [StringComparison]::OrdinalIgnoreCase)) {
        $normalizedOrigin = $normalizedOrigin.Substring(0, $normalizedOrigin.Length - 4)
    }
    if (-not $normalizedOrigin.Equals($Repository, [StringComparison]::OrdinalIgnoreCase)) {
        throw "O checkout não corresponde ao repositório permitido '$Repository'."
    }
    if ($RequireClean) {
        $status = @(& git -C $root status --porcelain 2>$null | ForEach-Object { [string]$_ })
        if ($LASTEXITCODE -ne 0 -or $status.Count -gt 0) {
            throw "O bundle privado exige source limpo; preserve ou faça commit das alterações antes de materializá-lo: '$root'."
        }
    }
    return [pscustomobject]@{
        checkout = (Resolve-Path -LiteralPath $root -ErrorAction Stop).Path
        head = $head.ToLowerInvariant()
        origin = $origin
    }
}

function Get-VerifiedCheckoutRecord {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$RequireClean
    )

    $records = @(if ($RequireClean) {
            Resolve-GitCheckout -Path $Path -RequireClean
        }
        else {
            Resolve-GitCheckout -Path $Path
        })
    $valid = @($records | Where-Object { $null -ne $_ -and $null -ne $_.PSObject.Properties['checkout'] })
    if ($records.Count -ne 1 -or $valid.Count -ne 1) {
        $types = @($records | ForEach-Object { if ($null -eq $_) { 'null' } else { $_.GetType().FullName } }) -join ','
        throw "A resolução do checkout emitiu um contrato inválido: '$types'."
    }
    return $valid[0]
}

function Get-RequiredBundleFiles {
    return @(
        '.codex\hooks\invoke-codex-thread-routing.ps1',
        '.codex\hooks\invoke-codex-thread-routing-guard.ps1',
        'scripts\resolve-codex-thread-worktree.ps1',
        'scripts\codex-thread-routing-state.ps1',
        'ops\codex\worktree-topology.json'
    )
}

function Get-BridgeLoaderSourcePath {
    param([string]$SourceRoot)
    return Join-Path $SourceRoot 'scripts\invoke-codex-thread-routing-bridge.ps1'
}

function Assert-SourceImplementation {
    param([string]$SourceRoot)

    foreach ($relative in @(Get-RequiredBundleFiles) + @('scripts\invoke-codex-thread-routing-bridge.ps1')) {
        $path = Join-Path $SourceRoot $relative
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Implementação de roteamento ausente no source limpo: '$relative'."
        }
    }
}

function New-Bundle {
    param([Parameter(Mandatory = $true)][object]$Source)

    Assert-SourceImplementation -SourceRoot $Source.checkout
    $entries = @()
    foreach ($relative in Get-RequiredBundleFiles) {
        $sourcePath = Join-Path $Source.checkout $relative
        $entries += [ordered]@{
            relativePath = $relative
            sha256 = Get-Sha256File -Path $sourcePath
        }
    }
    $fingerprint = Get-Sha256Text -Value (($entries | ForEach-Object { "$($_.relativePath):$($_.sha256)" }) -join "`n")
    $bundleKey = '{0}-{1}' -f $Source.head.Substring(0, 12), $fingerprint.Substring(0, 16)
    $bundlePath = Join-Path (Join-Path $RuntimeRoot 'bundles') $bundleKey
    $manifestPath = Join-Path $bundlePath 'manifest.json'
    $existingManifest = Read-JsonOrNull -Path $manifestPath
    if ($null -ne $existingManifest) {
        if ([int]$existingManifest.schemaVersion -ne 1 -or [string]$existingManifest.kind -ne 'skincos-thread-routing-bundle' -or
            [string]$existingManifest.bundleKey -ne $bundleKey -or [string]$existingManifest.sourceCommit -ne $Source.head) {
            throw "Colisão de identidade no bundle privado '$bundleKey'; o conteúdo existente foi preservado."
        }
        foreach ($entry in $entries) {
            $existingEntry = @($existingManifest.files | Where-Object { [string]$_.relativePath -eq $entry.relativePath })
            $existingPath = Join-Path $bundlePath $entry.relativePath
            if ($existingEntry.Count -ne 1 -or -not (Test-Path -LiteralPath $existingPath -PathType Leaf) -or
                [string]$existingEntry[0].sha256 -ne $entry.sha256 -or (Get-Sha256File -Path $existingPath) -ne $entry.sha256) {
                throw "Bundle privado existente '$bundleKey' diverge do source verificado; ele foi preservado."
            }
        }
        return [pscustomobject]@{ key = $bundleKey; path = $bundlePath; manifest = $existingManifest }
    }
    if (Test-Path -LiteralPath $bundlePath -PathType Container) {
        $unexpected = @(Get-ChildItem -LiteralPath $bundlePath -Force -ErrorAction Stop)
        if ($unexpected.Count -gt 0) {
            throw "Diretório de bundle privado sem manifesto: '$bundlePath'. Ele foi preservado."
        }
    }
    foreach ($entry in $entries) {
        $destination = Join-Path $bundlePath $entry.relativePath
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $Source.checkout $entry.relativePath) -Destination $destination -Force
        if ((Get-Sha256File -Path $destination) -ne $entry.sha256) {
            throw "Hash do bundle não confere para '$($entry.relativePath)'."
        }
    }
    $manifest = [ordered]@{
        schemaVersion = 1
        kind = 'skincos-thread-routing-bundle'
        bundleKey = $bundleKey
        sourceCheckout = $Source.checkout
        sourceCommit = $Source.head
        sourceOrigin = $Source.origin
        createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        fingerprint = $fingerprint
        files = @($entries)
    }
    Write-JsonAtomic -Path $manifestPath -Value $manifest
    return [pscustomobject]@{ key = $bundleKey; path = $bundlePath; manifest = $manifest }
}

function Get-GlobalHooksConfig {
    if (-not (Test-Path -LiteralPath $GlobalHooksPath -PathType Leaf)) {
        return [pscustomobject]@{ hooks = [pscustomobject]@{} }
    }
    $config = Read-JsonOrNull -Path $GlobalHooksPath
    if ($null -eq $config) {
        throw "O arquivo global de hooks não é JSON válido: '$GlobalHooksPath'."
    }
    if ($null -eq $config.PSObject.Properties['hooks'] -or $null -eq $config.hooks) {
        $config | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    return $config
}

function Test-BridgeHandler {
    param([object]$Handler)

    if ($null -eq $Handler) { return $false }
    $command = ''
    if ($null -ne $Handler.PSObject.Properties['command']) { $command += [string]$Handler.command }
    if ($null -ne $Handler.PSObject.Properties['commandWindows']) { $command += [string]$Handler.commandWindows }
    $status = if ($null -ne $Handler.PSObject.Properties['statusMessage']) { [string]$Handler.statusMessage } else { '' }
    return $command -match '(?i)invoke-codex-thread-routing-bridge\.ps1' -or $status -eq 'SKINCOS global thread routing'
}

function Remove-BridgeHandlers {
    param([object]$Config, [string]$EventName)

    $property = $Config.hooks.PSObject.Properties[$EventName]
    if ($null -eq $property) { return }
    $remainingGroups = @()
    foreach ($group in @($property.Value)) {
        $handlers = @($group.hooks | Where-Object { -not (Test-BridgeHandler -Handler $_) })
        if ($handlers.Count -gt 0) {
            $group.hooks = @($handlers)
            $remainingGroups += $group
        }
    }
    if ($remainingGroups.Count -eq 0) {
        $Config.hooks.PSObject.Properties.Remove($EventName)
    }
    else {
        $Config.hooks | Add-Member -NotePropertyName $EventName -NotePropertyValue @($remainingGroups) -Force
    }
}

function New-BridgeHandler {
    param([string]$EventName, [string]$LoaderPath, [string]$LoaderHash)

    $command = 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Event {1} -BridgeRoot "{2}" -ExpectedBridgeHash {3} -RuntimeRegistryRoot "{4}" -WorktreeRoot "{5}" -CodexManagedWorktreeRoot "{6}" -Repository {7}' -f $LoaderPath, $EventName, $RuntimeRoot, $LoaderHash, $RuntimeRegistryRoot, $WorktreeRoot, $CodexManagedWorktreeRoot, $Repository
    $handler = [ordered]@{
        type = 'command'
        command = $command
        commandWindows = $command
        timeout = if ($EventName -eq 'UserPromptSubmit') { 30 } else { 15 }
        statusMessage = 'SKINCOS global thread routing'
    }
    if ($EventName -eq 'UserPromptSubmit') {
        $handler.additionalContextLimit = 1800
    }
    return [pscustomobject]$handler
}

function Install-BridgeHandlers {
    param([string]$LoaderPath, [string]$LoaderHash)

    $config = Get-GlobalHooksConfig
    foreach ($eventName in @('UserPromptSubmit', 'PreToolUse')) {
        Remove-BridgeHandlers -Config $config -EventName $eventName
        $group = [pscustomobject]@{
            hooks = @((New-BridgeHandler -EventName $eventName -LoaderPath $LoaderPath -LoaderHash $LoaderHash))
        }
        if ($eventName -eq 'PreToolUse') {
            $group | Add-Member -NotePropertyName matcher -NotePropertyValue '*' -Force
        }
        $existing = @()
        if ($null -ne $config.hooks.PSObject.Properties[$eventName]) {
            $existing = @($config.hooks.$eventName)
        }
        $config.hooks | Add-Member -NotePropertyName $eventName -NotePropertyValue @($existing + $group) -Force
    }
    $backupRoot = Join-Path $RuntimeRoot 'backups'
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    if (Test-Path -LiteralPath $GlobalHooksPath -PathType Leaf) {
        Copy-Item -LiteralPath $GlobalHooksPath -Destination (Join-Path $backupRoot ('hooks-before-{0}.json' -f (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))) -Force
    }
    Write-JsonAtomic -Path $GlobalHooksPath -Value $config
}

function Remove-InstalledBridgeHandlers {
    $config = Get-GlobalHooksConfig
    foreach ($eventName in @('UserPromptSubmit', 'PreToolUse')) {
        Remove-BridgeHandlers -Config $config -EventName $eventName
    }
    Write-JsonAtomic -Path $GlobalHooksPath -Value $config
}

function Install-BridgeLoader {
    param([string]$SourceRoot, [switch]$AllowReplace)

    $source = Get-BridgeLoaderSourcePath -SourceRoot $SourceRoot
    $destination = Join-Path $RuntimeRoot 'invoke-codex-thread-routing-bridge.ps1'
    New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
    $sourceHash = Get-Sha256File -Path $source
    if ((Test-Path -LiteralPath $destination -PathType Leaf) -and -not $AllowReplace -and (Get-Sha256File -Path $destination) -ne $sourceHash) {
        throw 'O loader privado difere do source integrado; reinstale o candidato e revise o hook antes de ativar uma versão estável.'
    }
    if (-not (Test-Path -LiteralPath $destination -PathType Leaf) -or (Get-Sha256File -Path $destination) -ne $sourceHash) {
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }
    if ((Get-Sha256File -Path $destination) -ne $sourceHash) {
        throw 'Não foi possível verificar o hash do loader privado.'
    }
    return [pscustomobject]@{ path = $destination; sha256 = $sourceHash }
}

function Write-ActiveBridge {
    param([object]$Bundle, [object]$Source, [string]$Mode, [object]$Activation = $null)

    $active = [ordered]@{
        schemaVersion = 1
        kind = 'skincos-thread-routing-bridge'
        mode = $Mode
        bundleKey = $Bundle.key
        bundlePath = $Bundle.path
        sourceCheckout = $Source.checkout
        sourceCommit = $Source.head
        sourceOrigin = $Source.origin
        createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        activation = $Activation
    }
    Write-JsonAtomic -Path (Join-Path $RuntimeRoot 'active.json') -Value $active
    return [pscustomobject]$active
}

function Emit-Result {
    param([object]$Value)
    $Value | ConvertTo-Json -Depth 32
}

try {
    if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
        $ProjectRoot = Split-Path -Parent $PSScriptRoot
    }
    $runtimeFull = [IO.Path]::GetFullPath($RuntimeRoot)
    $RuntimeRoot = $runtimeFull
    if ($Action -ne 'status' -and -not $Apply) {
        throw "A ação '$Action' altera apenas o runtime privado e hooks globais; repita com -Apply após revisar o source e o alvo."
    }

    switch ($Action) {
        'status' {
            $active = Read-JsonOrNull -Path (Join-Path $RuntimeRoot 'active.json')
            $loaderPath = Join-Path $RuntimeRoot 'invoke-codex-thread-routing-bridge.ps1'
            $hooks = if (Test-Path -LiteralPath $GlobalHooksPath -PathType Leaf) { Get-GlobalHooksConfig } else { $null }
            $handlerCount = 0
            if ($null -ne $hooks) {
                foreach ($eventName in @('UserPromptSubmit', 'PreToolUse')) {
                    $eventProperty = $hooks.hooks.PSObject.Properties[$eventName]
                    if ($null -eq $eventProperty) {
                        continue
                    }
                    foreach ($group in @($eventProperty.Value)) {
                        $handlerCount += @($group.hooks | Where-Object { Test-BridgeHandler -Handler $_ }).Count
                    }
                }
            }
            Emit-Result ([pscustomobject]@{
                schemaVersion = 1
                action = $Action
                state = if ($null -ne $active) { 'ready' } else { 'missing' }
                runtimeRoot = $RuntimeRoot
                active = $active
                loaderPath = $loaderPath
                loaderHash = if (Test-Path -LiteralPath $loaderPath -PathType Leaf) { Get-Sha256File -Path $loaderPath } else { $null }
                globalHooksPath = $GlobalHooksPath
                globalBridgeHandlerCount = $handlerCount
            })
            break
        }

        'install-candidate' {
            if ($CandidateTtlSeconds -lt 60 -or $CandidateTtlSeconds -gt 3600) {
                throw 'CandidateTtlSeconds deve estar entre 60 e 3600 segundos.'
            }
            if ([string]::IsNullOrWhiteSpace($ActivationCheckout)) {
                throw 'ActivationCheckout é obrigatório para um bundle candidato.'
            }
            $source = Get-VerifiedCheckoutRecord -Path $ProjectRoot -RequireClean
            $activationRecord = Get-VerifiedCheckoutRecord -Path $ActivationCheckout
            $loader = Install-BridgeLoader -SourceRoot $source.checkout -AllowReplace
            $bundle = New-Bundle -Source $source
            if ([string]::IsNullOrWhiteSpace($ActivationNonce)) {
                $ActivationNonce = [guid]::NewGuid().ToString('N')
            }
            if ($ActivationNonce -notmatch '^[a-f0-9]{32}$') {
                throw 'ActivationNonce deve conter exatamente 32 caracteres hexadecimais.'
            }
            $activation = [ordered]@{
                schemaVersion = 1
                kind = 'skincos-thread-routing-bridge-candidate'
                nonce = $ActivationNonce
                sourceCheckout = $activationRecord.checkout
                sourceCommit = $activationRecord.head
                sourceOrigin = $activationRecord.origin
                expiresAtUtc = (Get-Date).ToUniversalTime().AddSeconds($CandidateTtlSeconds).ToString('o')
                consumedAtUtc = $null
                consumedCheckout = $null
            }
            $active = Write-ActiveBridge -Bundle $bundle -Source $source -Mode 'candidate' -Activation ([pscustomobject]$activation)
            Install-BridgeHandlers -LoaderPath $loader.path -LoaderHash $loader.sha256
            Emit-Result ([pscustomobject]@{
                schemaVersion = 1
                action = $Action
                state = 'ready'
                apply = $true
                mode = 'candidate'
                bundleKey = $bundle.key
                bundlePath = $bundle.path
                bundleSourceCommit = $source.head
                activationCheckout = $activationRecord.checkout
                activationCommit = $activationRecord.head
                activationExpiresAtUtc = $activation.expiresAtUtc
                activationMarker = "[[SKINCOS_BRIDGE_TEST_V1 activation=$ActivationNonce]]"
                loaderPath = $loader.path
                loaderHash = $loader.sha256
                globalHooksPath = $GlobalHooksPath
                active = $active
            })
            break
        }

        'activate-stable' {
            $source = Get-VerifiedCheckoutRecord -Path $ProjectRoot -RequireClean
            $originMain = Get-GitValue -Root $source.checkout -Arguments @('rev-parse', '--verify', 'origin/main^{commit}')
            if ([string]::IsNullOrWhiteSpace($originMain) -or -not $source.head.Equals($originMain, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'A ativação estável exige um checkout limpo exatamente no SHA integrado de origin/main.'
            }
            $loader = Install-BridgeLoader -SourceRoot $source.checkout
            $bundle = New-Bundle -Source $source
            $active = Write-ActiveBridge -Bundle $bundle -Source $source -Mode 'stable'
            Emit-Result ([pscustomobject]@{
                schemaVersion = 1
                action = $Action
                state = 'ready'
                apply = $true
                mode = 'stable'
                bundleKey = $bundle.key
                bundlePath = $bundle.path
                sourceCommit = $source.head
                loaderPath = $loader.path
                loaderHash = $loader.sha256
                globalHooksPath = $GlobalHooksPath
                active = $active
            })
            break
        }

        'deactivate' {
            Remove-InstalledBridgeHandlers
            Emit-Result ([pscustomobject]@{
                schemaVersion = 1
                action = $Action
                state = 'ready'
                apply = $true
                globalHooksPath = $GlobalHooksPath
                reasonCodes = @('global_thread_routing_bridge_handlers_removed')
            })
            break
        }
    }
}
catch {
    Emit-Result ([pscustomobject]@{
        schemaVersion = 1
        action = $Action
        state = 'blocked'
        reasonCodes = @('thread_routing_bridge_error')
        errorType = $_.Exception.GetType().FullName
        errorMessage = $_.Exception.Message
        errorLine = $_.InvocationInfo.ScriptLineNumber
    })
}
