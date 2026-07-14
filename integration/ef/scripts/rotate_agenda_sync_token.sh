#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/rotate_agenda_sync_token.sh [--website-dir PATH] [--worker-name NAME] [--sync-url URL]

Defaults:
  website dir: $HOME/Automation/skincos/website
  worker name: espacofacial-site
  sync url:    https://espacofacial.com/api/agenda/sync

Behavior:
  1) Generate a strong random token.
  2) Update ~/.config/espacofacial/agenda_sync.env as EF_AGENDA_SYNC_TOKEN.
  3) Update website/.env.local as AGENDA_SYNC_TOKEN.
  4) Push secret AGENDA_SYNC_TOKEN to Cloudflare Worker via wrangler.
  5) Validate auth by calling /api/agenda/sync (expects non-401).
EOF
}

WEBSITE_DIR="${HOME}/Automation/skincos/website"
WORKER_NAME="espacofacial-site"
SYNC_URL="https://espacofacial.com/api/agenda/sync"

while [ $# -gt 0 ]; do
  case "$1" in
    --website-dir)
      WEBSITE_DIR="${2:-}"
      shift 2
      ;;
    --worker-name)
      WORKER_NAME="${2:-}"
      shift 2
      ;;
    --sync-url)
      SYNC_URL="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required to generate token." >&2
  exit 127
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "ERROR: npx is required (for wrangler)." >&2
  exit 127
fi
if [ ! -d "$WEBSITE_DIR" ]; then
  echo "ERROR: website directory not found: $WEBSITE_DIR" >&2
  exit 2
fi
if [ ! -f "$WEBSITE_DIR/wrangler.toml" ]; then
  echo "ERROR: wrangler.toml not found in $WEBSITE_DIR" >&2
  exit 2
fi

token="$(
  python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"

fingerprint="$(
  python3 - "$token" <<'PY'
import hashlib, sys
print(hashlib.sha256(sys.argv[1].encode()).hexdigest()[:12])
PY
)"

sync_env="${EF_AGENDA_SYNC_ENV_FILE:-$HOME/.config/espacofacial/agenda_sync.env}"
mkdir -p "$(dirname "$sync_env")"
if [ -f "$sync_env" ]; then
  awk -v new="$token" '
    BEGIN { updated=0 }
    /^EF_AGENDA_SYNC_TOKEN=/ { print "EF_AGENDA_SYNC_TOKEN='\''" new "'\''"; updated=1; next }
    { print }
    END { if (!updated) print "EF_AGENDA_SYNC_TOKEN='\''" new "'\''" }
  ' "$sync_env" > "${sync_env}.tmp"
  mv "${sync_env}.tmp" "$sync_env"
else
  cat > "$sync_env" <<EOF
EF_AGENDA_SYNC_TOKEN='$token'
EOF
fi

website_env="${WEBSITE_DIR}/.env.local"
if [ -f "$website_env" ]; then
  awk -v new="$token" '
    BEGIN { updated=0 }
    /^AGENDA_SYNC_TOKEN=/ { print "AGENDA_SYNC_TOKEN='\''" new "'\''"; updated=1; next }
    { print }
    END { if (!updated) print "AGENDA_SYNC_TOKEN='\''" new "'\''" }
  ' "$website_env" > "${website_env}.tmp"
  mv "${website_env}.tmp" "$website_env"
else
  cat > "$website_env" <<EOF
AGENDA_SYNC_TOKEN='$token'
EOF
fi

(
  cd "$WEBSITE_DIR"
  printf '%s' "$token" | npx wrangler secret put AGENDA_SYNC_TOKEN --name "$WORKER_NAME" >/tmp/wrangler_secret_put.log
)

auth_status="$(
  curl -sS -o /tmp/agenda_sync_rotate_body.txt -w "%{http_code}" \
    -X POST "$SYNC_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${token}" \
    --data '{"unit":"debug","runId":"token-rotation-check","added":[],"removed":[]}'
)"

if [ "$auth_status" = "401" ] || [ "$auth_status" = "403" ]; then
  echo "ERROR: token rotation failed; endpoint still unauthorized (HTTP $auth_status)." >&2
  echo "Response: $(head -c 300 /tmp/agenda_sync_rotate_body.txt | tr '\n' ' ')" >&2
  exit 1
fi

echo "Rotated AGENDA_SYNC_TOKEN successfully."
echo "Fingerprint (sha256/12): $fingerprint"
echo "Sync endpoint HTTP status after rotation: $auth_status"
