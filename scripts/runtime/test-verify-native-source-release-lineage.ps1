$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptPath = Join-Path $PSScriptRoot 'verify-native-source-release-lineage.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("skincos-lineage-test-" + [guid]::NewGuid().ToString('N'))
$remoteRoot = "$testRoot-remote.git"
$output = "$testRoot-lineage.json"

try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    & git init --initial-branch=main $testRoot | Out-Null
    & git -C $testRoot config user.email 'lineage-test@invalid.example'
    & git -C $testRoot config user.name 'SKINCOS lineage test'
    Set-Content -LiteralPath (Join-Path $testRoot 'fixture.txt') -Value 'parent' -NoNewline
    & git -C $testRoot add fixture.txt
    & git -C $testRoot commit -m 'parent' | Out-Null
    $parent = (& git -C $testRoot rev-parse HEAD).Trim()
    Set-Content -LiteralPath (Join-Path $testRoot 'fixture.txt') -Value 'release' -NoNewline
    & git -C $testRoot commit -am 'release' | Out-Null
    $release = (& git -C $testRoot rev-parse HEAD).Trim()
    & git init --bare $remoteRoot | Out-Null
    & git -C $testRoot remote add origin $remoteRoot
    & git -C $testRoot push -u origin main | Out-Null

    $result = & $scriptPath -ReleaseSha $release -ParentReleaseSha $parent -RepositoryRoot $testRoot -OutputPath $output | ConvertFrom-Json
    $lineage = Get-Content -Raw -LiteralPath $output | ConvertFrom-Json
    if ($lineage.releaseId -ne $release -or $lineage.parentReleaseId -ne $parent -or $lineage.verifiedAncestor -ne $true) {
        throw 'Generated lineage did not preserve verified release ancestry.'
    }
    if (-not $result.Sha256 -or $result.OutputPath -ne [IO.Path]::GetFullPath($output)) {
        throw 'Generated lineage evidence did not include output integrity metadata.'
    }
    $bytes = [IO.File]::ReadAllBytes($output)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        throw 'Generated lineage must be UTF-8 without a BOM for the native JSON verifier.'
    }
    Write-Output 'native_release_lineage_tests=pass'
}
finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
    if (Test-Path -LiteralPath $remoteRoot) { Remove-Item -LiteralPath $remoteRoot -Recurse -Force }
    if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }
}
