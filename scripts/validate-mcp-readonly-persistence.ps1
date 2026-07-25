param(
    [string]$Distro = 'Ubuntu-24.04',
    [switch]$SkipShutdown
)

$ErrorActionPreference = 'Stop'
$evidenceRoot = Join-Path $env:LOCALAPPDATA 'Codex\skincos'
New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
$evidencePath = Join-Path $evidenceRoot ("mcp-readonly-persistence-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
function Invoke-WslCheck([string]$Command) {
    $output = & wsl.exe -d $Distro -u admin -- bash -lc $Command 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Persistence check failed: $Command`n$($output -join "`n")" }
    return ($output -join "`n")
}
function Invoke-WslProbe([string]$Command) {
    return (& wsl.exe -d $Distro -u admin -- bash -lc $Command 2>&1) -join "`n"
}
$before = @(
    "timestamp=$((Get-Date).ToString('o'))",
    (Invoke-WslProbe 'systemctl is-active orb orb-proxy cloudflare-orb skincos-orb-mcp-readonly'),
    (Invoke-WslProbe 'sudo -n readlink -f /opt/skincos/current/source'),
    (Invoke-WslProbe 'curl -fsS http://127.0.0.1:5678/healthz >/dev/null && echo orb_local=200'),
    (Invoke-WslProbe 'curl -fsS https://orb.skincos.com.br/healthz >/dev/null && echo orb_public=200'),
    (Invoke-WslProbe 'curl -s -o /dev/null -w public_mcp=%{http_code} https://orb.skincos.com.br/mcp-server/http'),
    (Invoke-WslProbe "sudo -n -u postgres psql -d n8n_runtime -Atc 'SELECT count(*) FROM n8n_runtime.workflow_entity'"),
    (Get-Content -Raw -LiteralPath (Join-Path $env:USERPROFILE '.codex\config.toml') | Select-String -Pattern '(?m)^\[mcp_servers\.skincos_orb_readonly\].*$' -AllMatches).Line
)
$before | Set-Content -LiteralPath $evidencePath -Encoding utf8
if (-not $SkipShutdown) {
    & wsl.exe --shutdown
    if ($LASTEXITCODE -ne 0) { throw 'wsl --shutdown failed.' }
    Start-Sleep -Seconds 3
    Start-ScheduledTask -TaskName SkincosWslRuntimeKeepalive
    $recovered = $false
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        if ((Invoke-WslProbe 'systemctl is-active orb skincos-orb-mcp-readonly') -match 'active') { $recovered = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $recovered) { throw 'Official WSL keepalive did not recover Orb and gateway within 60 seconds.' }
}
$checks = @(
    'systemctl is-active orb orb-proxy cloudflare-orb skincos-orb-mcp-readonly',
    'systemctl is-enabled skincos-orb-mcp-readonly',
    'sudo -n test -f /opt/skincos/current/source/orb/engine/mcp-readonly-gateway/server.mjs',
    'sudo -n systemctl show skincos-orb-mcp-readonly.service -p WorkingDirectory -p ExecStart | grep -F /opt/skincos/current/source/orb/engine/mcp-readonly-gateway',
    'curl --fail --silent http://127.0.0.1:8766/.well-known/oauth-protected-resource/mcp >/dev/null',
    'test "$(curl -s -o /dev/null -w %{http_code} https://orb.skincos.com.br/mcp-server/http)" = 404'
)
foreach ($check in $checks) { Invoke-WslCheck $check | Out-Null }
@(
    "recovered_timestamp=$((Get-Date).ToString('o'))",
    (Invoke-WslProbe 'systemctl is-active orb orb-proxy cloudflare-orb skincos-orb-mcp-readonly'),
    (Invoke-WslProbe 'systemctl show skincos-orb-mcp-readonly.service -p WorkingDirectory -p ExecStart | grep -F /opt/skincos/current/source/orb/engine/mcp-readonly-gateway'),
    (Invoke-WslProbe 'curl -fsS http://127.0.0.1:5678/healthz >/dev/null && echo orb_local=200'),
    (Invoke-WslProbe 'curl -fsS https://orb.skincos.com.br/healthz >/dev/null && echo orb_public=200'),
    (Invoke-WslProbe 'curl -fsS https://crm.skincos.com.br/api/health >/dev/null && echo crm=200'),
    (Invoke-WslProbe 'curl -fsS http://127.0.0.1:8765/healthz >/dev/null && echo booking=200'),
    (Invoke-WslProbe 'curl -fsS https://wa.skincos.com.br/health >/dev/null && echo whatsapp=200'),
    (Invoke-WslProbe 'curl -s -o /dev/null -w public_mcp=%{http_code} https://orb.skincos.com.br/mcp-server/http')
) | Add-Content -LiteralPath $evidencePath -Encoding utf8
$config = Join-Path $env:USERPROFILE '.codex\config.toml'
if (-not (Test-Path -LiteralPath $config)) { throw "Codex config is unavailable: $config" }
$configText = Get-Content -Raw -LiteralPath $config
if ($configText -notmatch '(?m)^\[mcp_servers\.skincos_orb_readonly\]') { throw 'skincos_orb_readonly is missing from Codex config.' }
if ($configText -match '(?m)execute_workflow') { throw 'Forbidden execute_workflow was found in Codex config.' }
Write-Output "Post-WSL-shutdown MCP persistence checks passed. Evidence: $evidencePath. Reopen Codex and confirm the existing OAuth session reconnects without a new consent prompt; this script never requests consent."
