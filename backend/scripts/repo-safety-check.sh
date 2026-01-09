#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"

echo "[safety] Scanning for obvious secrets and forbidden files (best-effort)..."

fail=0

check_file_exists() {
  local label="$1"
  local path="$2"
  if [[ -f "$path" ]]; then
    echo "[safety] WARN: $label exists: ${path#$ROOT_DIR/}"
  fi
}

# Common secret-bearing files that should stay local/ignored
check_file_exists "backend config" "$BACKEND_DIR/config.json"
check_file_exists "backend env" "$BACKEND_DIR/.env"
check_file_exists "workspace.local.env" "$BACKEND_DIR/config/workspace.local.env"

# Grep patterns in tracked files if git is available
if command -v git >/dev/null 2>&1 && git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[safety] git: scanning tracked files..."
  # Avoid false positives: allow placeholders in templates/tests, but fail on suspicious base64 key blocks.
  if command -v python3 >/dev/null 2>&1; then
    KEY_FINDINGS=$(python3 - <<'PY' 2>/dev/null || true
import os, re, subprocess, sys

ROOT = os.getcwd()

def tracked_files():
  out = subprocess.check_output(["git", "-C", ROOT, "ls-files"], text=True)
  return [l.strip() for l in out.splitlines() if l.strip()]

BEGIN_RE = re.compile(r"-----BEGIN (?:RSA )?PRIVATE KEY-----")
END_RE = re.compile(r"-----END (?:RSA )?PRIVATE KEY-----")
BASE64_LINE_RE = re.compile(r"^[A-Za-z0-9+/=]{50,}$")

def suspicious_private_key_block(text: str) -> bool:
  if "BEGIN PRIVATE KEY" not in text:
    return False
  if not BEGIN_RE.search(text):
    return False
  # Scan between BEGIN/END markers and count base64-like lines.
  for m in BEGIN_RE.finditer(text):
    start = m.end()
    end_m = END_RE.search(text, start)
    end = end_m.start() if end_m else min(len(text), start + 8000)
    block = text[start:end]
    if "YOUR_PRIVATE_KEY" in block or "test-key" in block or "\n...\n" in block:
      continue
    lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
    b64_hits = sum(1 for ln in lines if BASE64_LINE_RE.match(ln))
    if b64_hits >= 2:
      return True
    if any(ln.startswith("MII") and len(ln) > 60 for ln in lines):
      return True
  return False

ignore_prefixes = (
  "backend/var/",
  "backend/config/templates/modules/",
  "backend/config/templates/examples/",
  "backend/tests/",
  "backend/archive/tools/semgrep/",
)

findings = []
for path in tracked_files():
  if path.startswith(ignore_prefixes):
    continue
  try:
    with open(path, "rb") as f:
      data = f.read()
  except OSError:
    continue
  if b"BEGIN PRIVATE KEY" not in data:
    continue
  text = data.decode("utf-8", "ignore")
  if suspicious_private_key_block(text):
    findings.append(path)

for p in findings[:50]:
  print(p)
PY
)
    if [[ -n "${KEY_FINDINGS:-}" ]]; then
      echo "[safety] ERROR: Suspicious private key blocks found in tracked files:"
      echo "$KEY_FINDINGS" | sed -n '1,50p'
      fail=1
    fi
  else
    if git -C "$ROOT_DIR" grep -n "BEGIN PRIVATE KEY" -- ':!backend/var' >/dev/null 2>&1; then
      echo "[safety] ERROR: Found 'BEGIN PRIVATE KEY' in tracked files"
      git -C "$ROOT_DIR" grep -n "BEGIN PRIVATE KEY" -- ':!backend/var' | sed -n '1,50p'
      fail=1
    fi
  fi
  if git -C "$ROOT_DIR" ls-files | rg -n "\\.local\\.(env|json)$" >/dev/null 2>&1; then
    echo "[safety] ERROR: Tracked *.local.env/json files (should be ignored)"
    git -C "$ROOT_DIR" ls-files | rg -n "\\.local\\.(env|json)$" | sed -n '1,50p'
    fail=1
  fi
else
  echo "[safety] git not available; skipping tracked-file checks."
fi

if [[ "$fail" -ne 0 ]]; then
  echo "[safety] FAILED"
  exit 2
fi

echo "[safety] OK"
