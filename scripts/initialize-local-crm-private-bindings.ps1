[CmdletBinding()]
param(
    [string]$OutputRoot = "C:\CodexRuntime\operator\admin\skincos\runtime\crm-local\ponto-private"
)

$ErrorActionPreference = "Stop"

$allowedRuntimeRoot = [IO.Path]::GetFullPath("C:\CodexRuntime\operator\admin\skincos").TrimEnd([char]'\')
$resolvedOutputRoot = [IO.Path]::GetFullPath($OutputRoot).TrimEnd([char]'\')
if (-not $resolvedOutputRoot.StartsWith(
    $allowedRuntimeRoot + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Os bindings locais devem permanecer no runtime privado '$allowedRuntimeRoot'."
}

$workerBindings = @(
    "PONTO_ACTOR_HMAC_KEY",
    "PONTO_IDEMPOTENCY_KEY",
    "PONTO_TEMPLATES_KEY",
    "PONTO_PROFILE_DATA_KEY",
    "PONTO_NETWORK_CONTEXT_KEY",
    "IDENTITY_WORKFORCE_HMAC_KEY"
)
$pagesBindings = @(
    "PONTO_ACTOR_HMAC_KEY",
    "PONTO_NETWORK_CONTEXT_KEY",
    "PONTO_RELEASE_PROBE_HMAC_KEY"
)
$inventoryBindings = @(
    "IDENTITY_WORKFORCE_HMAC_KEY",
    "INSUMOS_SEED_TOKEN",
    "SESSION_SECRET"
)
$workerPath = Join-Path $resolvedOutputRoot "timekeeping.worker.env"
$pagesPath = Join-Path $resolvedOutputRoot "ponto.pages.env"
$inventoryPath = Join-Path $resolvedOutputRoot "inventory.identity.env"
$bindingPaths = @($workerPath, $pagesPath, $inventoryPath)

function New-LocalBindingValue {
    $bytes = [byte[]]::new(32)
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Convert-ToBase64Url {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)
    return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-ReleaseProbeKey {
    param([Parameter(Mandatory = $true)][string]$IdempotencyKey)
    $hmac = [Security.Cryptography.HMACSHA256]::new(
        [Text.Encoding]::UTF8.GetBytes($IdempotencyKey)
    )
    try {
        return Convert-ToBase64Url -Bytes (
            $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("skincos/ponto/release-probe/v1"))
        )
    } finally {
        $hmac.Dispose()
    }
}

function Protect-OperatorOnlyPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$Directory
    )
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Path /setowner "*$sid" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha ao definir o proprietário de '$Path'." }
    $grant = if ($Directory) { "*$($sid):(OI)(CI)F" } else { "*$($sid):F" }
    & icacls.exe $Path /grant:r $grant /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha ao restringir a DACL de '$Path'." }
    & icacls.exe $Path /inheritance:r /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha ao remover herança DACL de '$Path'." }
}

function Read-PrivateBindings {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Allowed
    )
    $values = @{}
    $lineNumber = 0
    foreach ($line in Get-Content -LiteralPath $Path) {
        $lineNumber++
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#")) { continue }
        if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
            throw "'$Path' contém sintaxe inválida na linha $lineNumber."
        }
        $name = $Matches[1]
        $value = $Matches[2].Trim()
        if ($name -notin $Allowed) { throw "'$Path' contém binding não autorizado: $name." }
        if ($values.ContainsKey($name)) { throw "'$Path' repete o binding $name." }
        if ($value -notmatch '^[A-Za-z0-9_-]{16,}$' -or $value -match '^(?:__.*__|changeme|password|secret|test|test-.*|.*not-secret.*)$') {
            throw "'$Path' contém valor curto ou placeholder em $name."
        }
        $values[$name] = $value
    }
    return $values
}

function Assert-BindingsPresent {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Values,
        [Parameter(Mandatory = $true)][string[]]$Required,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $missing = @($Required | Where-Object { -not $Values.ContainsKey($_) })
    if ($missing.Count -gt 0) {
        throw "$Label não contém: $($missing -join ', ')."
    }
}

function Convert-BindingsToText {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Values,
        [Parameter(Mandatory = $true)][string[]]$Order
    )
    return (($Order | ForEach-Object { "$_=$($Values[$_])" }) -join "`n") + "`n"
}

function Write-PrivateBindings {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )
    $temporary = Join-Path $resolvedOutputRoot (
        ".{0}.{1}.tmp" -f (Split-Path -Leaf $Path), [Guid]::NewGuid().ToString("N")
    )
    try {
        [IO.File]::WriteAllText($temporary, $Content, [Text.UTF8Encoding]::new($false))
        Protect-OperatorOnlyPath -Path $temporary
        Move-Item -LiteralPath $temporary -Destination $Path -Force
        Protect-OperatorOnlyPath -Path $Path
    } finally {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
}

New-Item -ItemType Directory -Path $resolvedOutputRoot -Force | Out-Null
Protect-OperatorOnlyPath -Path $resolvedOutputRoot -Directory

# Recover only abandoned atomic-write candidates created by this initializer.
foreach ($candidate in Get-ChildItem -LiteralPath $resolvedOutputRoot -Force -File -Filter ".*.tmp") {
    $candidatePath = [IO.Path]::GetFullPath($candidate.FullName)
    if (-not $candidatePath.StartsWith(
        $resolvedOutputRoot + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase
    ) -or $candidate.Name -notmatch '^\.(?:timekeeping\.worker|ponto\.pages|inventory\.identity)\.env\.[0-9a-f]{32}\.tmp$') {
        throw "Candidato temporário inesperado no runtime privado: '$candidatePath'."
    }
    Protect-OperatorOnlyPath -Path $candidatePath
    Remove-Item -LiteralPath $candidatePath -Force
}

$existing = @($bindingPaths | Where-Object { Test-Path -LiteralPath $_ })
if ($existing.Count -gt 0 -and $existing.Count -lt $bindingPaths.Count) {
    throw "O conjunto privado está parcial em '$resolvedOutputRoot'. Preserve os arquivos existentes e restaure os ausentes; a inicialização não rotaciona chaves."
}

if ($existing.Count -eq 0) {
    $worker = @{
        PONTO_ACTOR_HMAC_KEY = New-LocalBindingValue
        PONTO_IDEMPOTENCY_KEY = New-LocalBindingValue
        PONTO_TEMPLATES_KEY = New-LocalBindingValue
        PONTO_PROFILE_DATA_KEY = New-LocalBindingValue
        PONTO_NETWORK_CONTEXT_KEY = New-LocalBindingValue
        IDENTITY_WORKFORCE_HMAC_KEY = New-LocalBindingValue
    }
    $pages = @{
        PONTO_ACTOR_HMAC_KEY = $worker.PONTO_ACTOR_HMAC_KEY
        PONTO_NETWORK_CONTEXT_KEY = $worker.PONTO_NETWORK_CONTEXT_KEY
        PONTO_RELEASE_PROBE_HMAC_KEY = Get-ReleaseProbeKey -IdempotencyKey $worker.PONTO_IDEMPOTENCY_KEY
    }
    $inventory = @{
        IDENTITY_WORKFORCE_HMAC_KEY = $worker.IDENTITY_WORKFORCE_HMAC_KEY
        INSUMOS_SEED_TOKEN = New-LocalBindingValue
        SESSION_SECRET = New-LocalBindingValue
    }
    $created = [Collections.Generic.List[string]]::new()
    try {
        foreach ($binding in @(
            @{ Path = $workerPath; Values = $worker; Order = $workerBindings },
            @{ Path = $pagesPath; Values = $pages; Order = $pagesBindings },
            @{ Path = $inventoryPath; Values = $inventory; Order = $inventoryBindings }
        )) {
            Write-PrivateBindings -Path $binding.Path -Content (
                Convert-BindingsToText -Values $binding.Values -Order $binding.Order
            )
            $created.Add($binding.Path)
        }
    } catch {
        foreach ($path in $created) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
        throw
    }
    Write-Host "[crm-local] Três arquivos de bindings sintéticos locais foram provisionados com DACL exclusiva do operador."
    Write-Host "[crm-local] Os valores não foram exibidos e não serão rotacionados automaticamente."
    exit 0
}

$worker = Read-PrivateBindings -Path $workerPath -Allowed $workerBindings
$pages = Read-PrivateBindings -Path $pagesPath -Allowed $pagesBindings
$inventory = Read-PrivateBindings -Path $inventoryPath -Allowed $inventoryBindings
Assert-BindingsPresent -Values $worker -Required $workerBindings -Label "timekeeping.worker.env"
Assert-BindingsPresent -Values $pages -Required @("PONTO_ACTOR_HMAC_KEY", "PONTO_NETWORK_CONTEXT_KEY") -Label "ponto.pages.env"
Assert-BindingsPresent -Values $inventory -Required @("IDENTITY_WORKFORCE_HMAC_KEY") -Label "inventory.identity.env"

if ($pages.PONTO_ACTOR_HMAC_KEY -ne $worker.PONTO_ACTOR_HMAC_KEY -or
    $pages.PONTO_NETWORK_CONTEXT_KEY -ne $worker.PONTO_NETWORK_CONTEXT_KEY) {
    throw "Actor e network devem coincidir entre timekeeping.worker.env e ponto.pages.env."
}
if ($inventory.IDENTITY_WORKFORCE_HMAC_KEY -ne $worker.IDENTITY_WORKFORCE_HMAC_KEY) {
    throw "A chave de identidade deve coincidir entre timekeeping.worker.env e inventory.identity.env."
}

$expectedReleaseProbeKey = Get-ReleaseProbeKey -IdempotencyKey $worker.PONTO_IDEMPOTENCY_KEY
if ($pages.ContainsKey("PONTO_RELEASE_PROBE_HMAC_KEY") -and
    $pages.PONTO_RELEASE_PROBE_HMAC_KEY -ne $expectedReleaseProbeKey) {
    throw "PONTO_RELEASE_PROBE_HMAC_KEY existente não corresponde à derivação obrigatória; nenhuma chave foi alterada."
}

$migrated = $false
if (-not $pages.ContainsKey("PONTO_RELEASE_PROBE_HMAC_KEY")) {
    $pages.PONTO_RELEASE_PROBE_HMAC_KEY = $expectedReleaseProbeKey
    $migrated = $true
}
foreach ($name in @("INSUMOS_SEED_TOKEN", "SESSION_SECRET")) {
    if (-not $inventory.ContainsKey($name)) {
        $inventory[$name] = New-LocalBindingValue
        $migrated = $true
    }
}

if ($migrated) {
    Write-PrivateBindings -Path $pagesPath -Content (
        Convert-BindingsToText -Values $pages -Order $pagesBindings
    )
    Write-PrivateBindings -Path $inventoryPath -Content (
        Convert-BindingsToText -Values $inventory -Order $inventoryBindings
    )
    Write-Host "[crm-local] O conjunto privado legado foi ampliado sem rotacionar nenhum binding existente."
} else {
    foreach ($path in $bindingPaths) { Protect-OperatorOnlyPath -Path $path }
    Write-Host "[crm-local] Bindings sintéticos privados já provisionados em '$resolvedOutputRoot'; nenhuma chave foi alterada."
}
