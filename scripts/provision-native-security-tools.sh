#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux || "$(id -u)" == 0 ]]; then
  echo 'Provision the native security scanners as the unprivileged Ubuntu operator.' >&2
  exit 1
fi

base="${HOME}/.local/share/skincos-native-security-tools"
release="${base}/v2026-09-30"
current="${base}/current"
mkdir -p -- "$base"
if [[ -e "$release" || -L "$release" ]]; then
  if [[ "${1:-}" != '--finalize-existing' || -L "$release" || "$(stat -c %u "$release")" != "$(id -u)" ]]; then
    echo 'Pinned tool release exists; only an owned partial install can be finalized explicitly.' >&2
    exit 1
  fi
else
  [[ "$#" == 0 ]] || { echo 'No partial install exists to finalize.' >&2; exit 1; }
  download="$(mktemp -d "${base}/.download.XXXXXX")"
  cleanup() {
    [[ "$download" == "${base}/.download."* ]] || return 1
    rm -rf -- "$download"
  }
  trap cleanup EXIT

gh release download v8.30.1 -R gitleaks/gitleaks \
  --pattern gitleaks_8.30.1_linux_x64.tar.gz --pattern gitleaks_8.30.1_checksums.txt --dir "$download"
gh release download v0.74.0 -R aquasecurity/trivy \
  --pattern trivy_0.74.0_Linux-64bit.tar.gz --pattern trivy_0.74.0_checksums.txt --dir "$download"
(
  cd "$download"
  printf '%s  %s\n' \
    551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb gitleaks_8.30.1_linux_x64.tar.gz \
    2ae6fe3ee734b7fdf11335663e18c75ea12dccc76062f09f164a3b0f8be4371a trivy_0.74.0_Linux-64bit.tar.gz | sha256sum --check --status
  rg -q '^551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  gitleaks_8.30.1_linux_x64.tar.gz$' gitleaks_8.30.1_checksums.txt
  rg -q '^2ae6fe3ee734b7fdf11335663e18c75ea12dccc76062f09f164a3b0f8be4371a  trivy_0.74.0_Linux-64bit.tar.gz$' trivy_0.74.0_checksums.txt
)

mkdir -m 0755 -p -- "$release/bin" "$release/lib/python3.12/site-packages"
tar -xzf "$download/gitleaks_8.30.1_linux_x64.tar.gz" -C "$release/bin" gitleaks
tar -xzf "$download/trivy_0.74.0_Linux-64bit.tar.gz" -C "$release/bin" trivy
chmod 0755 "$release/bin/gitleaks" "$release/bin/trivy"

python3 -m pip install --disable-pip-version-check --no-cache-dir --target "$release/lib/python3.12/site-packages" \
  'pip-audit==2.10.1' 'bandit==1.9.4' 'semgrep==1.178.0'
fi

printf '%s  %s\n' \
  88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509 "$release/bin/gitleaks" \
  d89bcc6510a267f11b773398cbf1be5520ce39f9e8b6633178c4487f05b7d791 "$release/bin/trivy" | sha256sum --check --status
for scanner in semgrep pysemgrep; do
  target="../lib/python3.12/site-packages/bin/$scanner"
  if [[ ! -L "$release/bin/$scanner" ]]; then ln -s "$target" "$release/bin/$scanner"; fi
  [[ "$(readlink "$release/bin/$scanner")" == "$target" ]] || { echo "Unexpected $scanner launcher." >&2; exit 1; }
done

"$release/bin/gitleaks" version | rg -q '8\.30\.1'
"$release/bin/trivy" --version | rg -q '0\.74\.0'
PYTHONPATH="$release/lib/python3.12/site-packages" python3 -m pip_audit --version | rg -q '2\.10\.1'
PYTHONPATH="$release/lib/python3.12/site-packages" python3 -m bandit --version | rg -q '1\.9\.4'
PATH="$release/bin:$PATH" PYTHONPATH="$release/lib/python3.12/site-packages" "$release/bin/semgrep" --version | rg -q '1\.178\.0'

if [[ -e "$current" || -L "$current" ]]; then
  echo 'Current native security tool pointer already exists; inspect it before changing.' >&2
  exit 1
fi
ln -s "$(basename "$release")" "$current"
echo "Pinned native security scanners ready at $current"
