#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="${GH_REPO:-jubenitogarcia/skincos}"
STRICT=false
CI_MODE=false
SKIP_HTTP=false
SKIP_CLOUDFLARE=false

usage() {
  cat <<'EOF'
Usage: scripts/codex-preflight.sh [--strict] [--ci] [--skip-http] [--skip-cloudflare]

Checks the operational autonomy prerequisites for Codex:
- GitHub CLI auth and required repo secrets/vars.
- Cloudflare local auth or CLOUDFLARE_API_TOKEN.
- Security exception expiry dates.
- Critical workflow files.
- Production health endpoints.

No secret values are printed.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict) STRICT=true ;;
    --ci) CI_MODE=true ;;
    --skip-http) SKIP_HTTP=true ;;
    --skip-cloudflare) SKIP_CLOUDFLARE=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

cd "$ROOT_DIR"

failures=0
warnings=0

ok() { printf 'OK   %s\n' "$*"; }
warn() { printf 'WARN %s\n' "$*"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL %s\n' "$*"; failures=$((failures + 1)); }

require_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    ok "command available: $1"
  else
    fail "missing command: $1"
  fi
}

check_git() {
  require_cmd git
  [[ $failures -gt 0 ]] && return

  local branch status
  branch="$(git branch --show-current 2>/dev/null || true)"
  status="$(git status --short 2>/dev/null || true)"
  ok "git repository detected on branch ${branch:-detached}"

  if [[ -n "$status" ]]; then
    warn "working tree has local changes; review before commit/deploy"
    printf '%s\n' "$status" | sed 's/^/     /'
  else
    ok "working tree clean"
  fi
}

check_github() {
  require_cmd gh
  [[ $failures -gt 0 ]] && return

  if gh auth status >/tmp/codex-gh-auth.log 2>&1; then
    ok "GitHub CLI authenticated"
  else
    cat /tmp/codex-gh-auth.log >&2 || true
    fail "GitHub CLI is not authenticated"
    return
  fi

  local required_secrets=(
    CLOUDFLARE_API_TOKEN
    CLOUDFLARE_ACCOUNT_ID
    GH_TOKEN
    CRM_API_BASIC_AUTH
    META_ADS_REPORT_WORKER_API_TOKEN
    INTEGRATIONS_ENCRYPTION_SECRET
  )
  local required_vars=(
    CLOUDFLARE_PAGES_PROJECT
    ENABLE_CRM_PAGES_DEPLOY
    ENABLE_CRM_API_DEPLOY
    META_ADS_REPORT_WORKER_BASE_URL
  )

  if gh secret list -R "$REPO" >/tmp/codex-gh-secrets.tsv 2>/tmp/codex-gh-secrets.err; then
    ok "GitHub repo secrets are listable for $REPO"
    local name
    for name in "${required_secrets[@]}"; do
      if awk '{print $1}' /tmp/codex-gh-secrets.tsv | grep -qx "$name"; then
        ok "GitHub secret configured: $name"
      else
        fail "missing GitHub secret: $name"
      fi
    done
  else
    if $CI_MODE; then
      ok "GitHub secrets are not listable with the CI token; checking injected env instead"
      local name
      for name in "${required_secrets[@]}"; do
        if [[ -n "${!name:-}" ]]; then
          ok "GitHub secret injected into job env: $name"
        else
          warn "secret not available in job env: $name"
        fi
      done
    else
      cat /tmp/codex-gh-secrets.err >&2 || true
      fail "cannot list GitHub repo secrets for $REPO"
    fi
  fi

  if gh variable list -R "$REPO" >/tmp/codex-gh-vars.tsv 2>/tmp/codex-gh-vars.err; then
    ok "GitHub repo variables are listable for $REPO"
    local name
    for name in "${required_vars[@]}"; do
      if awk '{print $1}' /tmp/codex-gh-vars.tsv | grep -qx "$name"; then
        ok "GitHub variable configured: $name"
      else
        fail "missing GitHub variable: $name"
      fi
    done
  else
    if $CI_MODE; then
      ok "GitHub variables are not listable with the CI token; checking injected env instead"
      local name
      for name in "${required_vars[@]}"; do
        if [[ -n "${!name:-}" ]]; then
          ok "GitHub variable injected into job env: $name"
        else
          warn "variable not available in job env: $name"
        fi
      done
    else
      cat /tmp/codex-gh-vars.err >&2 || true
      fail "cannot list GitHub repo variables for $REPO"
    fi
  fi
}

check_cloudflare() {
  $SKIP_CLOUDFLARE && { warn "Cloudflare auth check skipped"; return; }

  local strict_arg=()
  if $STRICT || $CI_MODE; then
    strict_arg=(--strict)
  fi

  if [[ -x scripts/cloudflare-token-health.sh ]]; then
    if scripts/cloudflare-token-health.sh "${strict_arg[@]}" >/tmp/codex-cloudflare-token-health.log 2>&1; then
      ok "Cloudflare token health check passed"
      sed -n '1,36p' /tmp/codex-cloudflare-token-health.log | sed 's/^/     /'
    else
      cat /tmp/codex-cloudflare-token-health.log >&2 || true
      fail "Cloudflare token health check failed"
    fi
  else
    fail "scripts/cloudflare-token-health.sh is missing or not executable"
  fi
}

check_security_exception_expiry() {
  local result
  result="$(python3 - <<'PY'
from pathlib import Path
from datetime import date
import csv
today = date.today()
files = [
    Path(".github/security/pip-audit-vuln-exceptions.csv"),
    Path(".github/security/pip-audit-path-exceptions.csv"),
    Path(".github/security/bandit-exceptions.csv"),
]
bad = []
for path in files:
    if not path.exists():
        continue
    with path.open(newline="") as handle:
        reader = csv.reader(row for row in handle if not row.lstrip().startswith("#") and row.strip())
        for row in reader:
            if len(row) < 2:
                continue
            expires = row[1].strip() if "pip-audit" in path.name else (row[2].strip() if len(row) > 2 else "")
            try:
                exp = date.fromisoformat(expires)
            except ValueError:
                bad.append(f"{path}: invalid expiry {expires}")
                continue
            if exp < today:
                bad.append(f"{path}: expired {expires}: {row}")
print("\n".join(bad))
PY
)"
  if [[ -n "$result" ]]; then
    fail "security exception expiry check failed"
    printf '%s\n' "$result" | sed 's/^/     /'
  else
    ok "security exception expiry dates are valid"
  fi
}

check_workflows() {
  local workflows=(
    .github/workflows/codex-automerge.yml
    .github/workflows/dispatch-after-automerge-fallback.yml
    .github/workflows/deploy-crm-pages-after-automerge.yml
    .github/workflows/deploy-crm-api-after-automerge.yml
    .github/workflows/deploy-workers-after-automerge.yml
    .github/workflows/cloudflare-audit.yml
    .github/workflows/security-secrets-audit.yml
  )
  local file
  for file in "${workflows[@]}"; do
    if [[ -f "$file" ]]; then
      ok "workflow present: $file"
    else
      fail "missing workflow: $file"
    fi
  done
}

check_http() {
  $SKIP_HTTP && { warn "HTTP health checks skipped"; return; }

  local checks=(
    "https://crm.skincos.com.br/?module=meta-ads|200|CRM Pages shell"
    "https://crm.skincos.com.br/api/health|200|CRM Pages health"
    "https://crm.skincos.com.br/api/insumos/health|200|Insumos proxy health"
    "https://api.skincos.com.br/health|200|Core worker health"
    "https://skincos-meta-ads-performance-report.skincos.workers.dev/health|200|Meta Ads report worker health"
    "https://crm.skincos.com.br/api/meta-ads/status|200,401|Meta Ads status endpoint"
  )
  local spec url expected label code
  for spec in "${checks[@]}"; do
    IFS='|' read -r url expected label <<<"$spec"
    code="$(curl -sS -o /tmp/codex-http-body -w '%{http_code}' --max-time 15 "$url" || true)"
    if [[ ",$expected," == *",$code,"* ]]; then
      ok "$label responded with HTTP $code"
    else
      if $STRICT; then
        fail "$label unexpected HTTP $code (expected $expected): $url"
      else
        warn "$label unexpected HTTP $code (expected $expected): $url"
      fi
      sed -n '1,6p' /tmp/codex-http-body | sed 's/^/     /' || true
    fi
  done
}

echo "Codex project autonomy preflight"
echo "repo=$REPO strict=$STRICT ci=$CI_MODE"
echo

check_git
check_github
check_cloudflare
check_security_exception_expiry
check_workflows
check_http

echo
echo "Summary: failures=$failures warnings=$warnings"

if [[ "$failures" -gt 0 ]]; then
  exit 1
fi

if $STRICT && [[ "$warnings" -gt 0 ]]; then
  exit 1
fi
