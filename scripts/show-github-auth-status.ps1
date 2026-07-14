param(
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$RepoSlug = "jubenitogarcia/skincos"
)

$ErrorActionPreference = "Stop"

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

function Convert-ToProcessArgumentString {
    param([string[]]$Arguments)

    $escaped = foreach ($argument in $Arguments) {
        if ($null -eq $argument) {
            '""'
            continue
        }

        if ($argument -notmatch '[\s"]') {
            $argument
            continue
        }

        $quoted = $argument -replace '(\\*)"', '$1$1\"'
        $quoted = $quoted -replace '(\\+)$', '$1$1'
        '"' + $quoted + '"'
    }

    return [string]::Join(' ', $escaped)
}

function Invoke-CapturedCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = Convert-ToProcessArgumentString -Arguments $Arguments
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    $text = ($stdout + [Environment]::NewLine + $stderr).Trim()

    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Output = $text
    }
}

$repoMountPath = Convert-WindowsPathToWsl -Path $ProjectRoot
$windowsGh = Get-Command gh -ErrorAction SilentlyContinue
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue

$windowsHostsFile = Join-Path $env:AppData "GitHub CLI\hosts.yml"
$windowsHostsState = "missing"
if (Test-Path -LiteralPath $windowsHostsFile) {
    $windowsHostsContent = (Get-Content -Raw -LiteralPath $windowsHostsFile).Trim()
    if ([string]::IsNullOrWhiteSpace($windowsHostsContent)) {
        $windowsHostsState = "empty"
    }
    elseif ($windowsHostsContent -eq "{}") {
        $windowsHostsState = "empty-json"
    }
    else {
        $windowsHostsState = "configured"
    }
}

$windowsAuthReady = $false
if ($windowsGh) {
    $windowsAuthProbe = Invoke-CapturedCommand -FilePath $windowsGh.Source -Arguments @("auth", "status")
    $windowsAuthReady = ($windowsAuthProbe.ExitCode -eq 0)
}

$wslGhReady = $false
$wslRepoReady = $false
$wslRepoBranch = $null
$wslFailureHint = $null

if ($wsl) {
    $wslAuthProbe = Invoke-CapturedCommand -FilePath $wsl.Source -Arguments @(
        "bash",
        "-lc",
        "gh auth status >/dev/null 2>&1"
    )
    $wslGhReady = ($wslAuthProbe.ExitCode -eq 0)

    if ($wslGhReady) {
        $repoCommand = "cd " + (Convert-ToBashLiteral -Value $repoMountPath) + " && gh repo view --json nameWithOwner,defaultBranchRef"
        $wslRepoProbe = Invoke-CapturedCommand -FilePath $wsl.Source -Arguments @("bash", "-lc", $repoCommand)
        if ($wslRepoProbe.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($wslRepoProbe.Output)) {
            $repoInfo = $wslRepoProbe.Output | ConvertFrom-Json
            if ($repoInfo.nameWithOwner -eq $RepoSlug) {
                $wslRepoReady = $true
                $wslRepoBranch = $repoInfo.defaultBranchRef.name
            }
        }
    }
    else {
        $wslFailureHint = "WSL GitHub CLI ainda nao esta autenticado."
    }
}
else {
    $wslFailureHint = "wsl.exe nao foi encontrado nesta conta Windows."
}

Write-Host "GitHub auth status for shared Skincos workspace"
Write-Host ""
Write-Host "Canonical flow for this repo: WSL GitHub CLI"
Write-Host "Windows GitHub CLI: optional"
Write-Host ""

if ($wsl) {
    if ($wslGhReady) {
        Write-Host "[OK] WSL gh auth: ready"
    }
    else {
        Write-Host "[FAIL] WSL gh auth: missing"
    }

    if ($wslRepoReady) {
        Write-Host ("[OK] WSL repo access: {0} (default branch: {1})" -f $RepoSlug, $wslRepoBranch)
    }
    else {
        Write-Host ("[WARN] WSL repo access: not confirmed for {0}" -f $RepoSlug)
    }
}
else {
    Write-Host "[FAIL] WSL runtime: unavailable"
}

if ($windowsGh) {
    if ($windowsAuthReady) {
        Write-Host "[OK] Windows gh auth: ready"
    }
    else {
        Write-Host "[WARN] Windows gh auth: not ready"
    }
}
else {
    Write-Host "[WARN] Windows gh auth: gh.exe not found on PATH"
}

switch ($windowsHostsState) {
    "configured" { Write-Host ("[INFO] Windows hosts file: {0}" -f $windowsHostsFile) }
    "empty-json" { Write-Host ("[INFO] Windows hosts file is '{{}}' at {0}" -f $windowsHostsFile) }
    "empty" { Write-Host ("[INFO] Windows hosts file is empty at {0}" -f $windowsHostsFile) }
    default { Write-Host ("[INFO] Windows hosts file is absent at {0}" -f $windowsHostsFile) }
}

Write-Host ""
if ($wslGhReady -and $wslRepoReady) {
    Write-Host "[READY] Skincos GitHub operations are healthy through WSL."
    if (-not $windowsAuthReady) {
        Write-Host "Windows gh can stay logged out; this does not block the shared Skincos flow."
    }
}
else {
    if ($wslFailureHint) {
        Write-Host ("[ACTION] {0}" -f $wslFailureHint)
    }
    Write-Host "Run the shared action: GitHub Auth Login (WSL)"
    Write-Host "Manual fallback:"
    Write-Host "wsl.exe bash -lc 'gh auth login --web --git-protocol https --hostname github.com && gh auth status'"
}
