param(
    [string]$RuntimeRoot = "C:\CodexRuntime\n8n"
)

$ErrorActionPreference = "Stop"

function Get-AccessEntry {
    param(
        [System.Security.AccessControl.DirectorySecurity]$Acl,
        [string]$Identity
    )

    return $Acl.Access | Where-Object {
        $_.IdentityReference.Value -eq $Identity -and
        $_.AccessControlType -eq "Allow"
    }
}

function Test-ModifyAccess {
    param([string]$TargetPath)

    $exists = Test-Path -LiteralPath $TargetPath
    if (-not $exists) {
        return [pscustomobject]@{
            path = $TargetPath
            exists = $false
            hasUsersModify = $false
            owner = $null
        }
    }

    $acl = Get-Acl -LiteralPath $TargetPath
    $entry = Get-AccessEntry -Acl $acl -Identity "BUILTIN\Users"
    $hasModify = $false

    if ($entry) {
        foreach ($rule in @($entry)) {
            if ($rule.FileSystemRights.ToString().Contains("Modify")) {
                $hasModify = $true
                break
            }
        }
    }

    [pscustomobject]@{
        path = $TargetPath
        exists = $true
        hasUsersModify = $hasModify
        owner = $acl.Owner
    }
}

$requiredDirs = @(
    $RuntimeRoot,
    (Join-Path $RuntimeRoot "env"),
    (Join-Path $RuntimeRoot "logs"),
    (Join-Path $RuntimeRoot "health"),
    (Join-Path $RuntimeRoot "tmp"),
    (Join-Path $RuntimeRoot "binary-data"),
    (Join-Path $RuntimeRoot "exports"),
    (Join-Path $RuntimeRoot "n8n-home"),
    (Join-Path $RuntimeRoot "cloudflared"),
    (Join-Path $RuntimeRoot "evolution-api")
)

$requiredFiles = @(
    (Join-Path $RuntimeRoot "env\n8n.env"),
    (Join-Path $RuntimeRoot "env\n8n-business.env"),
    (Join-Path $RuntimeRoot "env\evolution-api.env")
)

[pscustomobject]@{
    runtime = (Test-ModifyAccess -TargetPath $RuntimeRoot)
    requiredDirs = @(
        foreach ($dir in $requiredDirs) {
            Test-ModifyAccess -TargetPath $dir
        }
    )
    requiredFiles = @(
        foreach ($file in $requiredFiles) {
            [pscustomobject]@{
                path = $file
                exists = (Test-Path -LiteralPath $file)
            }
        }
    )
} | ConvertTo-Json -Depth 5
