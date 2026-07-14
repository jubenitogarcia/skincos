$ErrorActionPreference = "Stop"

$DistroName = "Ubuntu-24.04"
$PreferredTargetDir = "C:\CodexShared\Backups\wsl"
$FallbackTargetDir = "C:\CodexShared\Projetos\_bootstrap\wsl"

function Initialize-TargetDir {
  param([string]$Path)
  try {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (Initialize-TargetDir $PreferredTargetDir) {
  $TargetDir = $PreferredTargetDir
} elseif (Initialize-TargetDir $FallbackTargetDir) {
  $TargetDir = $FallbackTargetDir
} else {
  throw "Unable to create export directory in either '$PreferredTargetDir' or '$FallbackTargetDir'."
}

$TargetTar = Join-Path $TargetDir "ubuntu-24.04-codex-base.tar"
$TempTar = Join-Path $TargetDir "ubuntu-24.04-codex-base.raw.tar"

$pathsToDelete = @(
  "./home/admin/.cloudflared",
  "./home/admin/.config/.wrangler",
  "./home/admin/.ssh",
  "./home/admin/.bash_history",
  "./home/admin/.n8n",
  "./home/admin/Automation/n8n",
  "./home/admin/.cache",
  "./home/admin/.npm",
  "./home/admin/.config/google-chrome",
  "./root/.ssh",
  "./root/.bash_history"
)

Remove-Item -LiteralPath $TempTar -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $TargetTar -Force -ErrorAction SilentlyContinue

wsl.exe --export $DistroName $TempTar

$archiveUnixPath = ($TempTar -replace '\\', '/').Replace('C:', '/mnt/c')

$deleteScript = @"
set -euo pipefail
archive="$archiveUnixPath"
list=\$(mktemp)
delete_list=\$(mktemp)
tar -tf "\$archive" > "\$list"
python3 - <<'PY' "\$list" "\$delete_list"
from pathlib import Path
import sys
list_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])
prefixes = [
    './home/admin/.cloudflared',
    './home/admin/.config/.wrangler',
    './home/admin/.ssh',
    './home/admin/.bash_history',
    './home/admin/.n8n',
    './home/admin/Automation',
    './home/admin/.cache',
    './home/admin/.npm',
    './home/admin/.config/google-chrome',
    './root/.ssh',
    './root/.bash_history',
    './tmp',
    './var/tmp',
]
seen = set()
with list_path.open('r', encoding='utf-8', errors='ignore') as src, out_path.open('w', encoding='utf-8') as dst:
    for line in src:
        item = line.rstrip('\n')
        if any(item == p or item.startswith(p + '/') for p in prefixes):
            if item not in seen:
                seen.add(item)
                dst.write(item + '\n')
PY
if [ -s "\$delete_list" ]; then
  xargs -d '\n' -a "\$delete_list" tar --delete -f "\$archive"
fi
rm -f "\$list" "\$delete_list"

stage=\$(mktemp -d)
mkdir -p "\$stage/etc"
cat > "\$stage/etc/wsl.conf" <<'EOF'
[boot]
systemd=true

[user]
default=julia
EOF
(
  cd "\$stage"
  tar -rf "\$archive" ./etc/wsl.conf
)
rm -rf "\$stage"
"@

$encodedDeleteScript = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($deleteScript))
wsl.exe -d $DistroName -- bash -lc "echo $encodedDeleteScript | base64 -d | bash"

Move-Item -LiteralPath $TempTar -Destination $TargetTar -Force

Write-Output "WSL base export ready: $TargetTar"
