param(
    [string]$RuntimeRoot = "C:\CodexRuntime\n8n",
    [switch]$SkipAclRefresh,
    [switch]$DeepAclRefresh
)

$ErrorActionPreference = "Stop"

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Grant-SharedAcl {
    param(
        [string]$TargetPath,
        [switch]$Recursive
    )

    $args = @($TargetPath, "/grant", "Users:(OI)(CI)M")
    if ($Recursive) {
        $args += @("/T", "/C")
    }

    icacls @args | Out-Null
}

function Ensure-File {
    param(
        [string]$Path,
        [string[]]$Content
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        $dir = Split-Path -Parent $Path
        if ($dir) {
            Ensure-Directory -Path $dir
        }
        Set-Content -LiteralPath $Path -Value $Content -Encoding ASCII
    }
}

$runtimeDirs = @(
    $RuntimeRoot,
    (Join-Path $RuntimeRoot "env"),
    (Join-Path $RuntimeRoot "logs"),
    (Join-Path $RuntimeRoot "health"),
    (Join-Path $RuntimeRoot "tmp"),
    (Join-Path $RuntimeRoot "binary-data"),
    (Join-Path $RuntimeRoot "exports"),
    (Join-Path $RuntimeRoot "backups"),
    (Join-Path $RuntimeRoot "rollback"),
    (Join-Path $RuntimeRoot "n8n-home"),
    (Join-Path $RuntimeRoot "cloudflared"),
    (Join-Path $RuntimeRoot "evolution-api"),
    (Join-Path $RuntimeRoot "evolution-api\instances"),
    (Join-Path $RuntimeRoot "evolution-api\store")
)

foreach ($dir in $runtimeDirs) {
    Ensure-Directory -Path $dir
}

$businessEnv = Join-Path $RuntimeRoot "env\n8n-business.env"
Ensure-File -Path $businessEnv -Content @(
    "# Shared n8n business env contract",
    "# Fill real values outside the repo. Keep runtime base config in n8n.env.",
    "N8N_PUBLIC_BASE_URL=https://orb.skincos.com.br",
    "EVOLUTION_BASE_URL=https://wa.skincos.com.br",
    "EVOLUTION_INSTANCE_NAME=skincos",
    "EVOLUTION_API_KEY=",
    "DATABASE_URL=",
    "N8N_DEFAULT_UNIT_SLUG=",
    "N8N_DEFAULT_UNIT_NAME=",
    "N8N_UNIT_NAME_MAP=",
    "N8N_HANDOFF_NOTIFY_NUMBER=",
    "GOOGLE_CALENDAR_ID=",
    "GOOGLE_CLIENT_ID=",
    "GOOGLE_CLIENT_SECRET=",
    "GOOGLE_REDIRECT_URI=https://orb.skincos.com.br/rest/oauth2-credential/callback",
    "N8N_DEFAULT_TEST_PHONE="
)

if (-not $SkipAclRefresh) {
    Grant-SharedAcl -TargetPath $RuntimeRoot -Recursive:$DeepAclRefresh
}

[pscustomobject]@{
    runtimeRoot = $RuntimeRoot
    runtimeDirs = $runtimeDirs
    businessEnv = $businessEnv
    aclRefreshed = (-not $SkipAclRefresh.IsPresent)
    deepAclRefresh = $DeepAclRefresh.IsPresent
    currentUser = $env:USERNAME
} | ConvertTo-Json -Depth 4
