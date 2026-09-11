#!/usr/bin/env bash
set -euo pipefail

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"
TOKEN="${CLOUDFLARE_API_TOKEN:-}"
PROJECT="${CLOUDFLARE_PAGES_PROJECT:-skincos}"
WEBSITE_DB="${CLOUDFLARE_WEBSITE_D1_NAME:-espacofacial-booking}"
WRANGLER_CWD="${WRANGLER_CWD:-website}"
STRICT="${STRICT:-0}"

usage() {
  cat <<'EOF'
Usage: scripts/cloudflare-token-health.sh [--strict]

Checks Cloudflare access without printing secrets:
- CLOUDFLARE_API_TOKEN validity via /user/tokens/verify when the bearer is an
  API token, or via the configured account when the bearer is a Wrangler OAuth
  credential that deliberately does not expose the user-token endpoint.
- Account-scoped API access when CLOUDFLARE_ACCOUNT_ID is present.
- Pages project read access.
- D1 database visibility for espacofacial-booking.
- Local Wrangler OAuth fallback when no API token is present.

Required for CI/automation:
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID

Optional:
  CLOUDFLARE_PAGES_PROJECT       default: skincos
  CLOUDFLARE_WEBSITE_D1_NAME     default: espacofacial-booking
  WRANGLER_CWD                   default: website
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict) STRICT=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

ok() { printf 'OK   %s\n' "$*"; }
warn() { printf 'WARN %s\n' "$*"; }
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }

cf_get() {
  local path="$1"
  curl -fsS \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4${path}"
}

assert_success_json() {
  local label="$1"
  local payload="$2"
  node -e '
    const fs = require("node:fs");
    const label = process.argv[1];
    const payload = fs.readFileSync(0, "utf8");
    let data;
    try { data = JSON.parse(payload); } catch { process.exit(2); }
    if (!data.success) {
      const errors = Array.isArray(data.errors) ? data.errors.map((e) => `${e.code || "unknown"}:${e.message || ""}`).join(", ") : "unknown";
      console.error(`FAIL ${label}: ${errors}`);
      process.exit(1);
    }
  ' "$label" <<<"$payload"
}

json_success() {
  local payload="$1"
  node -e '
    const fs = require("node:fs");
    let data;
    try { data = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(1); }
    process.exit(data && data.success === true ? 0 : 1);
  ' <<<"$payload"
}

if [[ -n "$TOKEN" ]]; then
  token_validation="account-scoped"
  if verify_payload="$(cf_get "/user/tokens/verify" 2>/dev/null)" && json_success "$verify_payload"; then
    token_validation="user-token"
    ok "Cloudflare API token is valid"
  fi

  if [[ -z "$ACCOUNT_ID" ]]; then
    if [[ "$token_validation" == "account-scoped" ]]; then
      fail "CLOUDFLARE_ACCOUNT_ID is required for a bearer that does not support /user/tokens/verify"
    fi
    if [[ "$STRICT" == "1" ]]; then
      fail "CLOUDFLARE_ACCOUNT_ID is required in strict mode"
    fi
    warn "CLOUDFLARE_ACCOUNT_ID is missing; account-scoped checks skipped"
    exit 0
  fi

  account_payload="$(cf_get "/accounts/${ACCOUNT_ID}")" || fail "Cloudflare account read failed"
  assert_success_json "Cloudflare account read failed" "$account_payload"
  if [[ "$token_validation" == "account-scoped" ]]; then
    ok "Cloudflare OAuth bearer is valid for the configured account"
  fi
  ok "Cloudflare account is readable"

  pages_payload="$(cf_get "/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT}")" || fail "Cloudflare Pages project read failed: ${PROJECT}"
  assert_success_json "Cloudflare Pages project read failed" "$pages_payload"
  ok "Cloudflare Pages project is readable: ${PROJECT}"

  d1_payload="$(cf_get "/accounts/${ACCOUNT_ID}/d1/database")" || fail "Cloudflare D1 list failed"
  assert_success_json "Cloudflare D1 list failed" "$d1_payload"
  if node -e '
    const fs = require("node:fs");
    const dbName = process.argv[1];
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const found = Array.isArray(data.result) && data.result.some((db) => db.name === dbName);
    process.exit(found ? 0 : 1);
  ' "$WEBSITE_DB" <<<"$d1_payload"; then
    ok "Cloudflare D1 database is visible: ${WEBSITE_DB}"
  else
    fail "Cloudflare D1 database not visible to token: ${WEBSITE_DB}"
  fi

  exit 0
fi

if [[ -d "$WRANGLER_CWD" ]]; then
  if (cd "$WRANGLER_CWD" && npx --yes wrangler@4 whoami >/tmp/skincos-wrangler-whoami.log 2>&1); then
    ok "Wrangler local OAuth is authenticated"
    sed -n '1,28p' /tmp/skincos-wrangler-whoami.log | sed 's/^/     /'
    if (cd "$WRANGLER_CWD" && npx --yes wrangler@4 d1 execute "$WEBSITE_DB" --remote --command "SELECT 1 AS ok;" >/tmp/skincos-wrangler-d1-smoke.log 2>&1); then
      ok "Wrangler local OAuth can read remote D1: ${WEBSITE_DB}"
    else
      cat /tmp/skincos-wrangler-d1-smoke.log >&2 || true
      if [[ "$STRICT" == "1" ]]; then
        fail "Wrangler local OAuth is authenticated but cannot access remote D1: ${WEBSITE_DB}"
      fi
      warn "Wrangler local OAuth is authenticated but cannot access remote D1: ${WEBSITE_DB}"
    fi
    exit 0
  fi
  cat /tmp/skincos-wrangler-whoami.log >&2 || true
fi

if [[ "$STRICT" == "1" ]]; then
  fail "No valid CLOUDFLARE_API_TOKEN and Wrangler local OAuth is not healthy"
fi

warn "No valid Cloudflare API token found and Wrangler local OAuth is unavailable"
