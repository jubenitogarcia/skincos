param(
    [string]$Distro = 'Ubuntu-24.04'
)

$ErrorActionPreference = 'Stop'
$checks = @(
    'systemctl is-active orb orb-proxy cloudflare-orb skincos-orb-mcp-readonly',
    'systemctl is-enabled skincos-orb-mcp-readonly',
    'test -f /opt/skincos/current/source/orb/engine/mcp-readonly-gateway/server.mjs',
    'test "$(readlink -f /proc/$(systemctl show --value -p MainPID skincos-orb-mcp-readonly.service)/cwd)" = /opt/skincos/current/source/orb/engine/mcp-readonly-gateway',
    'curl --fail --silent http://127.0.0.1:8766/.well-known/oauth-protected-resource/mcp >/dev/null',
    'test "$(curl --silent --output /dev/null --write-out "%{http_code}" https://orb.skincos.com.br/mcp-server/http)" = 404'
)
foreach ($check in $checks) {
    & wsl.exe -d $Distro -u admin -- bash -lc $check
    if ($LASTEXITCODE -ne 0) { throw "Persistence check failed: $check" }
}
$config = Join-Path $env:USERPROFILE '.codex\config.toml'
if (-not (Test-Path -LiteralPath $config)) { throw "Codex config is unavailable: $config" }
$configText = Get-Content -Raw -LiteralPath $config
if ($configText -notmatch '(?m)^\[mcp_servers\.skincos_orb_readonly\]') { throw 'skincos_orb_readonly is missing from Codex config.' }
if ($configText -match '(?m)execute_workflow') { throw 'Forbidden execute_workflow was found in Codex config.' }
Write-Output 'Post-WSL-shutdown MCP persistence checks passed. Reopen Codex and confirm the existing OAuth session reconnects without a new consent prompt; this script never requests consent.'
