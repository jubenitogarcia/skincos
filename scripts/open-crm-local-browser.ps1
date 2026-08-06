[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Url,

    [Parameter(Mandatory = $true)]
    [string]$ProfilePath,

    [string]$BrowserPath,

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$uri = $null
if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri)) {
    throw 'A URL do CRM deve ser uma URI absoluta.'
}

$loopbackHost = $uri.DnsSafeHost.Trim('[', ']').ToLowerInvariant()
$privateIpv4 = $false
$parsedAddress = $null
if ([Net.IPAddress]::TryParse($loopbackHost, [ref]$parsedAddress) -and
    $parsedAddress.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork) {
    $bytes = $parsedAddress.GetAddressBytes()
    $privateIpv4 =
        $bytes[0] -eq 10 -or
        ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
        ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
}
if (
    $uri.Scheme -ne 'http' -or
    ($loopbackHost -notin @('localhost', '127.0.0.1', '::1') -and -not $privateIpv4) -or
    -not [string]::IsNullOrEmpty($uri.UserInfo) -or
    $uri.Port -lt 1 -or
    $uri.Port -gt 65535
) {
    throw 'A URL do CRM deve usar HTTP, um host loopback explícito e uma porta válida, sem credenciais.'
}

$privateRuntimeRoot = [IO.Path]::GetFullPath('C:\CodexRuntime\operator\admin\skincos')
if (-not [IO.Path]::IsPathRooted($ProfilePath)) {
    throw 'O perfil do navegador deve usar um caminho Windows absoluto.'
}

$profileFullPath = [IO.Path]::GetFullPath($ProfilePath)
$privateRuntimePrefix = $privateRuntimeRoot.TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
) + [IO.Path]::DirectorySeparatorChar
if (-not $profileFullPath.StartsWith($privateRuntimePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "O perfil do navegador deve ficar no runtime privado: $privateRuntimeRoot"
}

function Resolve-CrmLocalBrowser {
    param([string]$RequestedPath)

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        $resolvedRequestedPath = [IO.Path]::GetFullPath($RequestedPath)
        if (-not (Test-Path -LiteralPath $resolvedRequestedPath -PathType Leaf)) {
            throw "Navegador não encontrado: $resolvedRequestedPath"
        }
        if ([IO.Path]::GetFileName($resolvedRequestedPath).ToLowerInvariant() -notin @('msedge.exe', 'chrome.exe')) {
            throw 'BrowserPath deve apontar para msedge.exe ou chrome.exe.'
        }
        return $resolvedRequestedPath
    }

    $programFiles = [Environment]::GetEnvironmentVariable('ProgramFiles')
    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $localAppData = [Environment]::GetEnvironmentVariable('LOCALAPPDATA')
    $candidates = @(
        $(if ($programFiles) { Join-Path $programFiles 'Microsoft\Edge\Application\msedge.exe' }),
        $(if ($programFilesX86) { Join-Path $programFilesX86 'Microsoft\Edge\Application\msedge.exe' }),
        $(if ($localAppData) { Join-Path $localAppData 'Microsoft\Edge\Application\msedge.exe' }),
        $(if ($programFiles) { Join-Path $programFiles 'Google\Chrome\Application\chrome.exe' }),
        $(if ($programFilesX86) { Join-Path $programFilesX86 'Google\Chrome\Application\chrome.exe' }),
        $(if ($localAppData) { Join-Path $localAppData 'Google\Chrome\Application\chrome.exe' })
    ) | Where-Object { $_ }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [IO.Path]::GetFullPath($candidate)
        }
    }

    throw 'Microsoft Edge ou Google Chrome não foi encontrado neste host.'
}

$resolvedBrowserPath = Resolve-CrmLocalBrowser -RequestedPath $BrowserPath
$browserArguments = @(
    "--user-data-dir=`"$profileFullPath`""
    '--new-window'
    '--no-first-run'
    $uri.AbsoluteUri
)

if ($DryRun) {
    [pscustomobject]@{
        BrowserPath = $resolvedBrowserPath
        ProfilePath = $profileFullPath
        Url = $uri.AbsoluteUri
        Arguments = $browserArguments
    }
    return
}

New-Item -ItemType Directory -Path $profileFullPath -Force | Out-Null
Start-Process -FilePath $resolvedBrowserPath -ArgumentList $browserArguments | Out-Null
