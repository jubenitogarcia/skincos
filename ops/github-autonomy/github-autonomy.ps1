[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('install','enable','disable','pause','resume','status','logs','drain','test','uninstall','service')][string]$Command,
    [string]$RuntimeRoot,
    [string]$PolicyPath,
    [pscredential]$BrokerCredential,
    [switch]$InstallBrokerService
)

. (Join-Path $PSScriptRoot 'lib.ps1')
$RuntimeRoot=Get-AutonomyRoot $RuntimeRoot
if ([string]::IsNullOrWhiteSpace($PolicyPath)) { $PolicyPath = Join-Path $PSScriptRoot 'gate-policy.json' }
Ensure-AutonomyLayout $RuntimeRoot
$configPath=Join-Path $RuntimeRoot 'config\runtime.config.json'

function Save-Config { param($Config) Write-AutonomyJsonAtomic $configPath $Config }
function Get-ConfigForChange { if (-not (Test-Path -LiteralPath $configPath)) { throw "Run install first: $configPath" }; return Get-AutonomyConfig $RuntimeRoot }

switch ($Command) {
    'install' {
        if (-not (Test-Path -LiteralPath $configPath)) {
            $example=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'runtime.config.example.json') | ConvertFrom-Json
            Save-Config $example
        }
        $config=Get-ConfigForChange
        if (-not (Test-Path -LiteralPath $config.hmac_secret_path)) {
            $bytes=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
            [IO.File]::WriteAllText($config.hmac_secret_path,([Convert]::ToBase64String($bytes)),[Text.UTF8Encoding]::new($false))
        }
        if ($InstallBrokerService) {
            if ($null -eq $BrokerCredential) { throw '-BrokerCredential is required with -InstallBrokerService.' }
            $service='SkincosCodexGitHubBroker'; $binary=('"{0}" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{1}" -Mode Serve -RuntimeRoot "{2}"' -f (Get-Command powershell.exe).Source,(Join-Path $PSScriptRoot 'broker.ps1'),$RuntimeRoot)
            if (Get-Service -Name $service -ErrorAction SilentlyContinue) { throw "Service already exists: $service" }
            New-Service -Name $service -DisplayName 'Skincos Codex GitHub Broker' -BinaryPathName $binary -StartupType Manual -Credential $BrokerCredential | Out-Null
        }
        @{installed=$true; config=$configPath; enabled=$config.enabled; next_steps=@('place GitHub App PKCS#1 PEM in the private runtime','set github_app_id and github_installation_id','register the restricted runner separately','run codex login --device-auth as skincos-codex-broker','add AUTONOMY_INGRESS_HMAC to GitHub Actions secrets')} | ConvertTo-Json -Depth 6
    }
    'enable' { $c=Get-ConfigForChange; $c.enabled=$true; $c.paused=$false; Save-Config $c; @{enabled=$true}|ConvertTo-Json }
    'disable' { $c=Get-ConfigForChange; $c.enabled=$false; Save-Config $c; @{enabled=$false}|ConvertTo-Json }
    'pause' { $c=Get-ConfigForChange; $c.paused=$true; Save-Config $c; @{paused=$true}|ConvertTo-Json }
    'resume' { $c=Get-ConfigForChange; $c.paused=$false; Save-Config $c; @{paused=$false}|ConvertTo-Json }
    'status' { $c=Get-ConfigForChange; @{enabled=$c.enabled;paused=$c.paused;runtime_root=$RuntimeRoot;broker_service=(Get-Service -Name SkincosCodexGitHubBroker -ErrorAction SilentlyContinue | Select-Object Status,Name)} | ConvertTo-Json -Depth 6 }
    'logs' { Get-ChildItem (Join-Path $RuntimeRoot 'logs') -Filter '*.jsonl' | Sort-Object LastWriteTime | ForEach-Object { Get-Content -LiteralPath $_.FullName } }
    'drain' { & (Join-Path $PSScriptRoot 'broker.ps1') -Mode Status -RuntimeRoot $RuntimeRoot -PolicyPath $PolicyPath }
    'test' { & (Join-Path $PSScriptRoot 'tests\run-tests.ps1') -RuntimeRoot $RuntimeRoot }
    'service' { & (Join-Path $PSScriptRoot 'broker.ps1') -Mode Serve -RuntimeRoot $RuntimeRoot -PolicyPath $PolicyPath }
    'uninstall' { $c=Get-ConfigForChange; $c.enabled=$false; Save-Config $c; Stop-Service -Name SkincosCodexGitHubBroker -ErrorAction SilentlyContinue; @{uninstalled=$false;disabled=$true;note='The service and private credentials are intentionally retained for reversible recovery. Remove them only after preserving logs.'}|ConvertTo-Json }
}
